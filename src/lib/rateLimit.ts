// In-memory token-bucket rate limiter. Keyed per-process, which is
// sufficient for the MVP single-instance deployment (see docs/AUTH.md).
// Swapping this for a Redis-backed limiter behind the same `consume()`
// signature is the production upgrade path.

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * `cost` lets one call debit more than one token — e.g. a product.sync
 * batch charging once per item instead of once per HTTP request. Every
 * existing caller omits it, so `cost` defaults to 1 and behaves exactly as
 * before (see rateLimit.test.ts's original three cases, unchanged).
 */
export function consume(key: string, limit: number, windowMs: number, cost: number = 1): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  const refillRate = limit / windowMs; // tokens per ms

  let bucket = existing;
  if (!bucket) {
    bucket = { tokens: limit, lastRefillMs: now };
    buckets.set(key, bucket);
  } else {
    const elapsed = now - bucket.lastRefillMs;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRate);
    bucket.lastRefillMs = now;
  }

  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }

  const missing = cost - bucket.tokens;
  const msPerToken = 1 / refillRate;
  return { allowed: false, remaining: Math.floor(bucket.tokens), retryAfterMs: Math.ceil(missing * msPerToken) };
}

/** Test-only: clears all buckets so tests don't leak state across cases. */
export function _resetRateLimiter(): void {
  buckets.clear();
}
