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

  // Added for the product.sync batch rate limiter (cost defaults to 1,
  // preserving every call above unchanged).
  it('debits a multi-unit cost in one call when provided', () => {
    const key = 'cost-key';
    const result = consume(key, 100, 60_000, 40);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(60);
  });

  it('rejects a cost larger than the remaining bucket, without partially debiting it', () => {
    const key = 'cost-key-2';
    consume(key, 100, 60_000, 90);
    const result = consume(key, 100, 60_000, 20);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(10); // untouched by the rejected attempt
  });

  it('omitting cost behaves exactly like cost=1 (existing callers unaffected)', () => {
    const keyA = 'default-cost-a';
    const keyB = 'default-cost-b';
    const withoutCost = consume(keyA, 10, 60_000);
    const withExplicitCost1 = consume(keyB, 10, 60_000, 1);
    expect(withoutCost).toEqual(withExplicitCost1);
  });
});
