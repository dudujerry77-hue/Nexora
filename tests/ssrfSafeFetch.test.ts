import { describe, it, expect } from 'vitest';
import {
  resolveSafeOutboundTarget,
  classifyAddress,
  BlockedDestinationError,
  type LookupFn,
} from '@/lib/ssrfSafeFetch';

// These tests exercise the SSRF guard's own decision logic directly (no
// network needed for the range-classification cases — they're pure
// arithmetic over IP literals) plus its DNS-resolution path via an
// injectable lookup function, exactly the way tests/productSync.test.ts
// already injects a fake upsert/remove to simulate conditions real
// infrastructure can't reproduce on demand.

async function withNodeEnvAsync<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    env.NODE_ENV = original;
  }
}

describe('SSRF guard — address classification (pure, no network)', () => {
  it('classifies 127.0.0.1 and the whole loopback range as loopback', () => {
    expect(classifyAddress('127.0.0.1', 4)).toBe('loopback');
    expect(classifyAddress('127.255.255.255', 4)).toBe('loopback');
  });

  it('classifies private IPv4 ranges as private', () => {
    expect(classifyAddress('10.0.0.5', 4)).toBe('private');
    expect(classifyAddress('172.16.0.1', 4)).toBe('private');
    expect(classifyAddress('192.168.1.1', 4)).toBe('private');
  });

  it('classifies the cloud metadata address 169.254.169.254 as link-local', () => {
    expect(classifyAddress('169.254.169.254', 4)).toBe('link-local');
  });

  it('classifies ::1 as loopback', () => {
    expect(classifyAddress('::1', 6)).toBe('loopback');
  });

  it('classifies IPv6 private (unique local) and link-local ranges correctly', () => {
    expect(classifyAddress('fc00::1', 6)).toBe('private');
    expect(classifyAddress('fd12:3456:789a::1', 6)).toBe('private');
    expect(classifyAddress('fe80::1', 6)).toBe('link-local');
  });

  it('classifies an IPv4-mapped IPv6 metadata address by its embedded IPv4 address', () => {
    expect(classifyAddress('::ffff:169.254.169.254', 6)).toBe('link-local');
    expect(classifyAddress('::ffff:10.0.0.5', 6)).toBe('private');
  });

  it('classifies genuine public addresses as public', () => {
    expect(classifyAddress('8.8.8.8', 4)).toBe('public');
    expect(classifyAddress('1.1.1.1', 4)).toBe('public');
    expect(classifyAddress('2606:4700:4700::1111', 6)).toBe('public'); // Cloudflare DNS
  });
});

describe('SSRF guard — resolveSafeOutboundTarget', () => {
  it('allows an HTTPS destination that resolves to a genuine public address', async () => {
    const target = await resolveSafeOutboundTarget('https://1.1.1.1/webhook');
    expect(target.address).toBe('1.1.1.1');
    expect(target.protocol).toBe('https:');
  });

  it('blocks loopback (127.0.0.1) in production, even over HTTPS', async () => {
    await withNodeEnvAsync('production', async () => {
      await expect(resolveSafeOutboundTarget('https://127.0.0.1/webhook')).rejects.toThrow(BlockedDestinationError);
    });
  });

  it('allows loopback (127.0.0.1) outside production — required for local dev/test servers', async () => {
    await withNodeEnvAsync('test', async () => {
      const target = await resolveSafeOutboundTarget('http://127.0.0.1:9999/webhook');
      expect(target.address).toBe('127.0.0.1');
    });
  });

  it('blocks the "localhost" hostname in production (resolves to loopback)', async () => {
    await withNodeEnvAsync('production', async () => {
      const fakeLookup: LookupFn = async () => [{ address: '127.0.0.1', family: 4 }];
      await expect(resolveSafeOutboundTarget('https://localhost/webhook', fakeLookup)).rejects.toThrow(BlockedDestinationError);
    });
  });

  it('blocks private IPv4 ranges unconditionally, even outside production', async () => {
    await expect(resolveSafeOutboundTarget('https://10.0.0.5/webhook')).rejects.toThrow(BlockedDestinationError);
    await expect(resolveSafeOutboundTarget('https://192.168.1.1/webhook')).rejects.toThrow(BlockedDestinationError);
  });

  it('blocks the cloud metadata address 169.254.169.254 unconditionally', async () => {
    await expect(resolveSafeOutboundTarget('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(BlockedDestinationError);
  });

  it('blocks IPv6 loopback (::1) in production', async () => {
    await withNodeEnvAsync('production', async () => {
      await expect(resolveSafeOutboundTarget('https://[::1]/webhook')).rejects.toThrow(BlockedDestinationError);
    });
  });

  it('blocks IPv6 private (unique local) and link-local ranges unconditionally', async () => {
    await expect(resolveSafeOutboundTarget('https://[fc00::1]/webhook')).rejects.toThrow(BlockedDestinationError);
    await expect(resolveSafeOutboundTarget('https://[fe80::1]/webhook')).rejects.toThrow(BlockedDestinationError);
  });

  it('blocks a hostname that DNS resolves to a private address, using an injected resolver', async () => {
    const fakeLookup: LookupFn = async () => [{ address: '10.1.2.3', family: 4 }];
    await expect(resolveSafeOutboundTarget('https://internal.example.test/webhook', fakeLookup)).rejects.toThrow(
      BlockedDestinationError,
    );
  });

  it('blocks a hostname if ANY of its resolved addresses is unsafe, even if another is public', async () => {
    const fakeLookup: LookupFn = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.9', family: 4 },
    ];
    await expect(resolveSafeOutboundTarget('https://mixed.example.test/webhook', fakeLookup)).rejects.toThrow(
      BlockedDestinationError,
    );
  });

  it('rejects a plain http:// destination that is not loopback, even outside production', async () => {
    await expect(resolveSafeOutboundTarget('http://1.1.1.1/webhook')).rejects.toThrow(BlockedDestinationError);
  });

  it('rejects a non-http(s) scheme', async () => {
    await expect(resolveSafeOutboundTarget('ftp://1.1.1.1/webhook')).rejects.toThrow(BlockedDestinationError);
    await expect(resolveSafeOutboundTarget('javascript:alert(1)')).rejects.toThrow(BlockedDestinationError);
  });

  it('never includes the resolved address or matched range in its error message', async () => {
    try {
      await resolveSafeOutboundTarget('https://169.254.169.254/latest/meta-data/');
      expect.fail('expected resolveSafeOutboundTarget to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BlockedDestinationError);
      expect((error as Error).message).not.toContain('169.254');
      expect((error as Error).message).not.toMatch(/link-local|metadata|private|loopback/i);
    }
  });
});
