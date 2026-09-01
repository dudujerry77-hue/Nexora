import { describe, it, expect, beforeEach } from 'vitest';
import { consume, _resetRateLimiter } from '@/lib/rateLimit';

describe('rate limiter', () => {
  beforeEach(_resetRateLimiter);

  it('allows requests under the limit and blocks once exhausted', () => {
    const key = 'test-key';
    for (let i = 0; i < 5; i++) {
      const result = consume(key, 5, 60_000);
      expect(result.allowed).toBe(true);
    }
    const sixth = consume(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks separate buckets per key', () => {
    consume('key-a', 1, 60_000);
    const blockedA = consume('key-a', 1, 60_000);
    const allowedB = consume('key-b', 1, 60_000);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('refills tokens gradually over time', async () => {
    const key = 'refill-key';
    consume(key, 2, 100); // 2 tokens per 100ms window
    consume(key, 2, 100);
    expect(consume(key, 2, 100).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(consume(key, 2, 100).allowed).toBe(true);
  });
});
