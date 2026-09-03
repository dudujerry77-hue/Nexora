import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { consume, _resetRateLimiter } from '@/lib/rateLimit';
import { connectorRegistry } from '@/lib/connectors';
import type { PushProductResult } from '@/lib/connectors/types';
import { MAX_PUSH_ALL_BATCH_SIZE, PRODUCT_PUSH_ITEMS_PER_MINUTE } from '@/lib/productPushService';
import { resetDb, registerUser, createStore, createIntegration, connectIntegration, buildRequest } from './helpers';

async function setup() {
  const owner = await registerUser({ name: 'Owner', email: 'push-limits-owner@example.com', password: 'password123', orgName: 'Push Limits Org' });
  const store = await createStore(owner.jar, { name: 'Push Limits Store' });
  const storeId = store.body.data.id as string;
  const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });
  await connectIntegration(integration.body.data.integration.id);
  return { owner, storeId };
}

async function createProducts(storeId: string, count: number, skuPrefix: string) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const product = await prisma.product.create({ data: { storeId, sku: `${skuPrefix}-${i}`, name: `${skuPrefix} ${i}`, price: 1000 } });
    ids.push(product.id);
  }
  return ids;
}

async function push(jar: { session?: string; csrf?: string }, body: { storeId: string; mode: 'all' | 'selected'; productIds?: string[] }) {
  const { POST } = await import('@/app/api/products/push/route');
  const res = await POST(buildRequest('/api/products/push', { method: 'POST', jar, body }));
  return { res, body: await res.json() };
}

describe('product push — rate limiting (Blocker 2)', () => {
  beforeEach(() => {
    _resetRateLimiter();
  });
  beforeEach(resetDb);

  it('rejects a push once the per-store rate-limit bucket is exhausted', async () => {
    const { owner, storeId } = await setup();
    const ids = await createProducts(storeId, 20, 'RL');
    // Deliberately NOT configuring a connector for this test — the
    // rate-limit gate runs before pushProducts() is ever called (see the
    // route), so it's exercised identically either way, but the
    // "unsupported" branch does one bulk updateMany per allowed request
    // instead of N sequential per-item writes — avoiding heavy SQLite
    // write contention when many of these concurrent requests are allowed
    // through before the limit trips.
    //
    // Fired concurrently rather than pre-draining the bucket then awaiting
    // one more call — same reasoning as tests/webhooks.test.ts's own
    // rate-limit test: the token bucket refills based on real elapsed
    // wall-clock time, so a drain-then-await-setup-then-test sequence can
    // let enough time pass for refill to silently cover the next request's
    // cost, producing a flaky pass/fail depending on how long the
    // in-between async work happened to take. Firing many concurrent
    // requests whose combined cost comfortably exceeds the limit makes the
    // exhaustion happen within the test's own real request volume instead.
    const requests = Array.from({ length: 60 }, () => push(owner.jar, { storeId, mode: 'selected', productIds: ids }));
    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.res.status);

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('allows a push when the bucket has sufficient capacity', async () => {
    const { owner, storeId } = await setup();
    await createProducts(storeId, 1, 'RL-OK');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    const { res } = await push(owner.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(200);
    delete connectorRegistry.custom_api.pushProduct;
  });

  it('charges the bucket proportional to item count, not a flat per-request cost', async () => {
    const { owner, storeId } = await setup();
    await createProducts(storeId, 5, 'RL-COST');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    const t0 = Date.now();
    const { res } = await push(owner.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(200);

    const probe = consume(`product-push:${storeId}`, PRODUCT_PUSH_ITEMS_PER_MINUTE, 60_000, 0); // cost=0 peek
    const elapsedMs = Date.now() - t0;
    const maxPossibleRefill = Math.ceil(elapsedMs * (PRODUCT_PUSH_ITEMS_PER_MINUTE / 60_000)) + 1;
    // A flat 1-token charge would leave remaining at (limit - 1 + refill).
    // A real 5-item charge must leave it measurably lower than that.
    const upperBoundIfFlatCost = PRODUCT_PUSH_ITEMS_PER_MINUTE - 1 + maxPossibleRefill;
    expect(probe.remaining).toBeLessThan(upperBoundIfFlatCost - 3);
    delete connectorRegistry.custom_api.pushProduct;
  });

  it('keeps each store\'s rate-limit bucket independent of other stores', async () => {
    const { owner, storeId } = await setup();
    const storeB = await createStore(owner.jar, { name: 'Push Limits Store B' });
    const storeBId = storeB.body.data.id as string;
    const integrationB = await createIntegration(owner.jar, { storeId: storeBId, provider: 'custom_api' });
    await connectIntegration(integrationB.body.data.integration.id);
    await createProducts(storeBId, 1, 'RL-B');

    // Exhaust store A's bucket only.
    consume(`product-push:${storeId}`, PRODUCT_PUSH_ITEMS_PER_MINUTE, 60_000, PRODUCT_PUSH_ITEMS_PER_MINUTE);

    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });
    const { res } = await push(owner.jar, { storeId: storeBId, mode: 'all' });
    expect(res.status).toBe(200); // store B's own bucket is untouched
    delete connectorRegistry.custom_api.pushProduct;
  });

  it('does not expose rate-limit bucket internals in the response', async () => {
    const { owner, storeId } = await setup();
    const ids = await createProducts(storeId, 20, 'RL-NOLEAK');
    // Same reasoning as the previous test — no connector configured, so an
    // allowed request takes the light "unsupported" bulk-update path
    // rather than N sequential per-item writes.

    const responses = await Promise.all(
      Array.from({ length: 60 }, () => push(owner.jar, { storeId, mode: 'selected', productIds: ids })),
    );
    const limited = responses.find((r) => r.res.status === 429);
    expect(limited).toBeTruthy();
    expect(limited!.body.error.code).toBe('rate_limited');
    expect(JSON.stringify(limited!.body)).not.toMatch(/tokens|bucket|refill/i);
  });
});

describe('product push — Push All batch size (Blocker 3)', () => {
  beforeEach(() => {
    _resetRateLimiter();
  });
  beforeEach(resetDb);

  it(`caps a single Push All request at ${MAX_PUSH_ALL_BATCH_SIZE} products and reports truncated:true`, async () => {
    const { owner, storeId } = await setup();
    const extra = 7;
    await createProducts(storeId, MAX_PUSH_ALL_BATCH_SIZE + extra, 'BATCH');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    const { res, body } = await push(owner.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(200);
    expect(body.data.total).toBe(MAX_PUSH_ALL_BATCH_SIZE);
    expect(body.data.truncated).toBe(true);
    expect(body.data.totalEligible).toBe(MAX_PUSH_ALL_BATCH_SIZE + extra);

    const pushedCount = await prisma.product.count({ where: { storeId, pushStatus: 'pushed' } });
    expect(pushedCount).toBe(MAX_PUSH_ALL_BATCH_SIZE); // never more than the cap, regardless of catalog size
    delete connectorRegistry.custom_api.pushProduct;
  });

  it('does not truncate when the catalog is at or under the batch cap', async () => {
    const { owner, storeId } = await setup();
    await createProducts(storeId, MAX_PUSH_ALL_BATCH_SIZE, 'ATCAP');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    const { body } = await push(owner.jar, { storeId, mode: 'all' });
    expect(body.data.total).toBe(MAX_PUSH_ALL_BATCH_SIZE);
    expect(body.data.truncated).toBe(false);
    expect(body.data.totalEligible).toBe(MAX_PUSH_ALL_BATCH_SIZE);
    delete connectorRegistry.custom_api.pushProduct;
  });

  it('a truncated Push All still returns real, per-product results — never a fake bulk success', async () => {
    const { owner, storeId } = await setup();
    await createProducts(storeId, MAX_PUSH_ALL_BATCH_SIZE + 3, 'REALRESULTS');
    let calls = 0;
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => {
      calls++;
      if (calls === 2) throw new Error('destination rejected this one');
      return { destinationRef: `dest-${calls}`, action: 'created' };
    };

    const { body } = await push(owner.jar, { storeId, mode: 'all' });
    expect(body.data.results).toHaveLength(MAX_PUSH_ALL_BATCH_SIZE);
    expect(body.data.pushed).toBe(MAX_PUSH_ALL_BATCH_SIZE - 1);
    expect(body.data.failed).toBe(1);
    delete connectorRegistry.custom_api.pushProduct;
  });

  it("does not change Push Selected's own cap or truncation behavior — selected always reports truncated:false", async () => {
    const { owner, storeId } = await setup();
    const ids = await createProducts(storeId, 12, 'SELECTED-UNCHANGED');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    const { body } = await push(owner.jar, { storeId, mode: 'selected', productIds: ids });
    expect(body.data.total).toBe(12);
    expect(body.data.truncated).toBe(false);
    delete connectorRegistry.custom_api.pushProduct;
  });

  it('rejects a Push Selected request with more than 500 ids (unchanged pre-existing cap)', async () => {
    const { owner, storeId } = await setup();
    const tooMany = Array.from({ length: 501 }, (_, i) => `fake-id-${i}`);
    const { res } = await push(owner.jar, { storeId, mode: 'selected', productIds: tooMany });
    expect(res.status).toBe(422);
  });
});
