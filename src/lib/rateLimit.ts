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

export function consume(key: string, limit: number, windowMs: number): RateLimitResult {
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

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }

  const msPerToken = 1 / refillRate;
  return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(msPerToken) };
}

/** Test-only: clears all buckets so tests don't leak state across cases. */
export function _resetRateLimiter(): void {
  buckets.clear();
}
