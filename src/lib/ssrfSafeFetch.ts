import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';

// SSRF protection for any outbound request to a destination NEXORA does not
// control (currently: the merchant-configured custom_webhook push URL — see
// src/lib/connectors/nexoraNative.ts). The threat model: an authenticated
// but potentially malicious/compromised store owner sets `outboundWebhookUrl`
// to an address that reaches internal infrastructure (loopback, private
// ranges, link-local/cloud-metadata, etc.) and uses Nexora's own server as a
// request proxy into a network the owner could not otherwise reach.
//
// Same "relaxed only outside production" pattern already used by
// src/lib/cors.ts's dev-only CORS allowlist — a narrow, explicit exception
// (loopback only, and only for the destination actually resolved-to, not a
// blanket bypass) so local development/tests can still run a real HTTP
// server on 127.0.0.1, while a real production deployment enforces the
// full policy unconditionally.
function isDevEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Thrown for any destination this module refuses to contact. The message is
 * deliberately generic — never the resolved IP, matched range, or DNS
 * detail — so it can be surfaced all the way to a dashboard error toast
 * without leaking internal network topology (see the security requirement
 * this exists to satisfy).
 */
export class BlockedDestinationError extends Error {
  constructor(message = 'Destination address is not allowed.') {
    super(message);
  }
}

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'multicast'
  | 'reserved'
  | 'unspecified';

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

interface Cidr4 {
  base: number;
  bits: number;
  addressClass: AddressClass;
}

function parseCidr4(cidr: string, addressClass: AddressClass): Cidr4 {
  const [addr, bitsStr] = cidr.split('/');
  return { base: ipv4ToInt(addr), bits: Number(bitsStr), addressClass };
}

function inCidr4(ip: number, cidr: Cidr4): boolean {
  if (cidr.bits === 0) return true;
  const mask = cidr.bits === 32 ? 0xffffffff : (0xffffffff << (32 - cidr.bits)) >>> 0;
  return (ip & mask) === (cidr.base & mask);
}

// IANA IPv4 special-purpose address registry — every range a real merchant
// production destination must never resolve to.
const IPV4_RANGES: Cidr4[] = [
  parseCidr4('0.0.0.0/8', 'unspecified'), // "this network"
  parseCidr4('10.0.0.0/8', 'private'),
  parseCidr4('100.64.0.0/10', 'private'), // shared address space (CGNAT)
  parseCidr4('127.0.0.0/8', 'loopback'),
  parseCidr4('169.254.0.0/16', 'link-local'), // includes cloud metadata 169.254.169.254
  parseCidr4('172.16.0.0/12', 'private'),
  parseCidr4('192.0.0.0/24', 'reserved'), // IETF protocol assignments
  parseCidr4('192.0.2.0/24', 'reserved'), // documentation (TEST-NET-1)
  parseCidr4('192.88.99.0/24', 'reserved'), // deprecated 6to4 relay anycast
  parseCidr4('192.168.0.0/16', 'private'),
  parseCidr4('198.18.0.0/15', 'reserved'), // benchmarking
  parseCidr4('198.51.100.0/24', 'reserved'), // documentation (TEST-NET-2)
  parseCidr4('203.0.113.0/24', 'reserved'), // documentation (TEST-NET-3)
  parseCidr4('224.0.0.0/4', 'multicast'),
  parseCidr4('240.0.0.0/4', 'reserved'), // includes 255.255.255.255 broadcast
];

export function classifyIpv4(address: string): AddressClass {
  const ip = ipv4ToInt(address);
  for (const range of IPV4_RANGES) {
    if (inCidr4(ip, range)) return range.addressClass;
  }
  return 'public';
}

/** Parses a (possibly `::`-compressed, possibly IPv4-embedded) IPv6 literal into its 128-bit value. */
function ipv6ToBigInt(ipRaw: string): bigint {
  let ip = ipRaw;
  // An embedded IPv4 tail (e.g. "::ffff:169.254.169.254") is only valid in
  // the last 32 bits — rewrite it as two hex groups before the generic parse.
  const v4Match = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (v4Match) {
    const v4 = v4Match[1];
    const parts = v4.split('.').map(Number);
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    ip = ip.slice(0, ip.length - v4.length) + hi + ':' + lo;
  }

  let head: string[];
  let tail: string[];
  if (ip.includes('::')) {
    const [headStr, tailStr] = ip.split('::');
    head = headStr ? headStr.split(':').filter(Boolean) : [];
    tail = tailStr ? tailStr.split(':').filter(Boolean) : [];
  } else {
    head = ip.split(':');
    tail = [];
  }
  const missing = 8 - head.length - tail.length;
  const groups = [...head, ...Array(Math.max(missing, 0)).fill('0'), ...tail];

  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) | BigInt(parseInt(g || '0', 16));
  }
  return result;
}

interface Cidr6 {
  base: bigint;
  bits: number;
  addressClass: AddressClass | 'embedded-v4';
}

function parseCidr6(cidr: string, addressClass: Cidr6['addressClass']): Cidr6 {
  const [addr, bitsStr] = cidr.split('/');
  return { base: ipv6ToBigInt(addr), bits: Number(bitsStr), addressClass };
}

function inCidr6(ip: bigint, cidr: Cidr6): boolean {
  if (cidr.bits === 0) return true;
  const shift = BigInt(128 - cidr.bits);
  return ip >> shift === cidr.base >> shift;
}

const IPV6_RANGES: Cidr6[] = [
  parseCidr6('::1/128', 'loopback'),
  parseCidr6('::/128', 'unspecified'),
  parseCidr6('::ffff:0:0/96', 'embedded-v4'), // IPv4-mapped
  parseCidr6('64:ff9b::/96', 'embedded-v4'), // NAT64 well-known prefix
  parseCidr6('100::/64', 'reserved'), // discard-only
  parseCidr6('2001:db8::/32', 'reserved'), // documentation
  parseCidr6('2001::/23', 'reserved'), // IETF protocol assignments (Teredo etc.)
  parseCidr6('fc00::/7', 'private'), // unique local address
  parseCidr6('fe80::/10', 'link-local'),
  parseCidr6('ff00::/8', 'multicast'),
];

export function classifyIpv6(address: string): AddressClass {
  const ip = ipv6ToBigInt(address);
  for (const range of IPV6_RANGES) {
    if (inCidr6(ip, range)) {
      if (range.addressClass === 'embedded-v4') {
        // The embedded IPv4 address is the real destination the underlying
        // socket will use — classify by IT, not by the IPv6 wrapper alone,
        // so e.g. ::ffff:169.254.169.254 is caught as link-local too.
        const v4 = [Number((ip >> 24n) & 0xffn), Number((ip >> 16n) & 0xffn), Number((ip >> 8n) & 0xffn), Number(ip & 0xffn)].join('.');
        return classifyIpv4(v4);
      }
      return range.addressClass;
    }
  }
  return 'public';
}

export function classifyAddress(address: string, family: 4 | 6): AddressClass {
  return family === 4 ? classifyIpv4(address) : classifyIpv6(address);
}

/** Injectable so tests can simulate "this hostname resolves to a blocked address" without controlling real DNS. Defaults to the real resolver. */
export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

const realLookup: LookupFn = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

export interface SafeTarget {
  /** The original hostname — used for the Host header and TLS SNI, never for the actual socket connection. */
  hostname: string;
  port: number;
  path: string;
  protocol: 'http:' | 'https:';
  /** The single, pre-validated address the connection will be pinned to. */
  address: string;
  family: 4 | 6;
}

/**
 * Resolves `urlString` to a single destination address, validating BOTH the
 * scheme and every address the hostname resolves to. Throws
 * BlockedDestinationError for anything unsafe. The returned `address` is
 * meant to be pinned for the actual connection (see sendSafeRequest below) —
 * resolving here and never re-resolving for the real connection is what
 * closes the DNS-rebinding TOCTOU gap (a hostname that resolves to a public
 * IP at validation time and a private one moments later at connect time).
 */
export async function resolveSafeOutboundTarget(urlString: string, lookup: LookupFn = realLookup): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new BlockedDestinationError();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedDestinationError();
  }

  const hostname = url.hostname;
  const literalFamily = net.isIP(hostname);
  const candidates: { address: string; family: 4 | 6 }[] = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : (await lookup(hostname)).map((r) => ({ address: r.address, family: r.family as 4 | 6 }));

  if (candidates.length === 0) throw new BlockedDestinationError();

  // Every resolved address must be safe — if a hostname resolves to a mix of
  // a public and a private address, the whole destination is rejected
  // rather than cherry-picking the "good" one (a mixed answer is itself a
  // signal something adversarial may be going on).
  for (const candidate of candidates) {
    const addressClass = classifyAddress(candidate.address, candidate.family);
    const allowed = addressClass === 'public' || (addressClass === 'loopback' && isDevEnvironment());
    if (!allowed) throw new BlockedDestinationError();
  }

  const chosen = candidates[0];
  const chosenClass = classifyAddress(chosen.address, chosen.family);

  // HTTPS-only in production. The one narrow exception mirrors the loopback
  // carve-out above: a local, non-TLS test server on loopback during
  // development/tests is not a production destination.
  if (url.protocol !== 'https:' && !(isDevEnvironment() && chosenClass === 'loopback')) {
    throw new BlockedDestinationError('Only HTTPS destinations are allowed.');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  return {
    hostname,
    port,
    path: `${url.pathname}${url.search}`,
    protocol: url.protocol as 'http:' | 'https:',
    address: chosen.address,
    family: chosen.family,
  };
}

export interface SafeRequestOptions {
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface SafeResponse {
  status: number;
  body: string;
}

/**
 * Performs the actual outbound call to an already-validated SafeTarget. The
 * connection is pinned to `target.address` via a custom `lookup` that never
 * defers to real DNS — Node/undici never gets a chance to re-resolve the
 * hostname for the real socket, which is what actually eliminates the
 * DNS-rebinding race (not just documents it). `agent: false` disables
 * connection-pooling/reuse so this call can never reuse a socket opened for
 * a different (differently-validated) target.
 *
 * Redirects are never followed — Node's core http/https client (unlike
 * fetch) does not auto-follow 3xx responses at all, so a redirect simply
 * comes back as an ordinary response with a 3xx status, which the caller
 * already treats as a non-2xx (failed) result. There is no code path here
 * that could ever dereference a Location header into a second, unvalidated
 * request.
 */
export function sendSafeRequest(target: SafeTarget, options: SafeRequestOptions): Promise<SafeResponse> {
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: options.method,
        headers: options.headers,
        agent: false,
        lookup: (_hostname: string, _opts: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
          callback(null, target.address, target.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.setTimeout(options.timeoutMs, () => req.destroy(new Error('Request timed out.')));
    req.on('error', reject);
    req.write(options.body);
    req.end();
  });
}
