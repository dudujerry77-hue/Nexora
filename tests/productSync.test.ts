import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { signWebhookBody } from '@/lib/webhookSignature';
import { consume, _resetRateLimiter } from '@/lib/rateLimit';
import { CATALOG_SYNC_ITEMS_PER_MINUTE } from '@/lib/webhookAuth';
import { connectorRegistry } from '@/lib/connectors';
import * as productService from '@/lib/productService';
import { MAX_PRODUCT_SYNC_BATCH_SIZE, productSyncItemSchema } from '@/lib/validation';
import { resetDb, registerUser, createStore, createIntegration, buildRequest } from './helpers';

describe('POST /api/webhooks/products — product.sync batch catalog sync', () => {
  beforeEach(() => {
    _resetRateLimiter();
  });
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup() {
    const owner = await registerUser({ name: 'Owner', email: 'sync-batch-owner@example.com', password: 'password123', orgName: 'Sync Batch Org' });
    const store = await createStore(owner.jar, { name: 'Sync Batch Store' });
    const storeId = store.body.data.id as string;
    const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });
    return { owner, storeId, apiKey: integration.body.data.apiKey as string, integrationId: integration.body.data.integration.id as string };
  }

  function envelope(storeId: string, eventId: string, products: unknown[], occurredAt?: string) {
    return {
      event: 'product.sync',
      store_id: storeId,
      event_id: eventId,
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
      data: { products },
    };
  }

  async function postSync(apiKey: string, storeId: string, eventId: string, products: unknown[], occurredAt?: string) {
    const { POST } = await import('@/app/api/webhooks/products/route');
    return POST(
      new Request('http://localhost:3000/api/webhooks/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(envelope(storeId, eventId, products, occurredAt)),
      }) as unknown as Parameters<typeof POST>[0],
    );
  }

  function item(sku: string, overrides: Record<string, unknown> = {}) {
    return { sku, name: `Product ${sku}`, price: 1000, currency: 'NGN', ...overrides };
  }

  // 1. one upsert
  it('processes a batch with a single upsert', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-1', [item('SKU-1')]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ status: 'processed', total: 1, applied: 1, unchanged: 0, failed: 0 });
    expect(body.data.results).toEqual([{ index: 0, sku: 'SKU-1', action: 'upsert', status: 'applied' }]);

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-1' } } });
    expect(product.name).toBe('Product SKU-1');
  });

  // 2. multiple upserts
  it('processes a batch with multiple upserts', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-2', [item('SKU-A'), item('SKU-B'), item('SKU-C')]);
    const body = await res.json();
    expect(body.data).toMatchObject({ status: 'processed', total: 3, applied: 3, unchanged: 0, failed: 0 });

    const count = await prisma.product.count({ where: { storeId } });
    expect(count).toBe(3);
  });

  // 3. delete
  it('deletes an existing product via a delete action', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-create', [item('SKU-DEL')]);
    const res = await postSync(apiKey, storeId, 'evt-delete', [{ sku: 'SKU-DEL', action: 'delete' }]);
    const body = await res.json();
    expect(body.data).toMatchObject({ status: 'processed', applied: 1, failed: 0 });
    expect(body.data.results[0]).toMatchObject({ sku: 'SKU-DEL', action: 'delete', status: 'applied' });

    const found = await prisma.product.findFirst({ where: { storeId, sku: 'SKU-DEL' } });
    expect(found).toBeNull();
  });

  // 4. mixed upsert/delete batch
  it('handles a mixed upsert/delete batch', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-seed', [item('KEEP'), item('REMOVE')]);
    const res = await postSync(apiKey, storeId, 'evt-mixed', [item('KEEP', { price: 2000 }), { sku: 'REMOVE', action: 'delete' }, item('NEW')]);
    const body = await res.json();
    expect(body.data).toMatchObject({ status: 'processed', total: 3, applied: 3, failed: 0 });

    expect((await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'KEEP' } } })).price).toBe(2000);
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'REMOVE' } })).toBeNull();
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'NEW' } })).not.toBeNull();
  });

  // 5. partial failure: valid, invalid, valid — valid ones still succeed
  it('processes valid items even when another item in the same batch is invalid', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-partial', [
      item('OK-1'),
      { sku: 'BAD-1', name: 'x'.repeat(5000), price: 1000 }, // description-less but oversized name > 200
      item('OK-2'),
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('partial');
    expect(body.data.total).toBe(3);
    expect(body.data.applied).toBe(2);
    expect(body.data.failed).toBe(1);
    expect(body.data.results[1].status).toBe('failed');
    expect(body.data.results[0].status).toBe('applied');
    expect(body.data.results[2].status).toBe('applied');

    expect(await prisma.product.findFirst({ where: { storeId, sku: 'OK-1' } })).not.toBeNull();
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'OK-2' } })).not.toBeNull();
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'BAD-1' } })).toBeNull();
  });

  // 6. batch size exactly 300 succeeds
  it('accepts a batch of exactly the maximum size', async () => {
    const { apiKey, storeId } = await setup();
    const products = Array.from({ length: MAX_PRODUCT_SYNC_BATCH_SIZE }, (_, i) => item(`MAX-${i}`));
    const res = await postSync(apiKey, storeId, 'evt-max', products);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(MAX_PRODUCT_SYNC_BATCH_SIZE);
    expect(body.data.applied).toBe(MAX_PRODUCT_SYNC_BATCH_SIZE);

    const count = await prisma.product.count({ where: { storeId } });
    expect(count).toBe(MAX_PRODUCT_SYNC_BATCH_SIZE);
  }, 30000);

  // 7. batch size 301 fails
  it('rejects a batch exceeding the maximum size', async () => {
    const { apiKey, storeId } = await setup();
    const products = Array.from({ length: MAX_PRODUCT_SYNC_BATCH_SIZE + 1 }, (_, i) => item(`OVER-${i}`));
    const res = await postSync(apiKey, storeId, 'evt-over', products);
    expect(res.status).toBe(422);

    const count = await prisma.product.count({ where: { storeId } });
    expect(count).toBe(0);
  });

  // 8. malformed batch fails (products not an array)
  it('rejects a malformed batch where products is not an array', async () => {
    const { apiKey, storeId } = await setup();
    const { POST } = await import('@/app/api/webhooks/products/route');
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ event: 'product.sync', store_id: storeId, event_id: 'evt-malformed', data: { products: 'not-an-array' } }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(422);
  });

  // 9. invalid product data is rejected (per-item, not whole-request)
  it('rejects an individual item with invalid product data without failing the whole request', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-invalid-item', [{ sku: 'BAD-PRICE', name: 'X', price: 'not-a-number' }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.results[0].status).toBe('failed');
  });

  // 10. data: image URL rejected
  it('rejects an item with a data: image URL', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-data-url', [
      item('BAD-IMG', { images: ['data:image/png;base64,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }),
    ]);
    const body = await res.json();
    expect(body.data.results[0].status).toBe('failed');
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'BAD-IMG' } })).toBeNull();
  });

  // 11. whole-request event_id duplicate is idempotent
  it('treats a redelivered event_id as a duplicate no-op', async () => {
    const { apiKey, storeId } = await setup();
    const first = await postSync(apiKey, storeId, 'evt-dup-1', [item('DUP-1'), item('DUP-2')]);
    expect((await first.json()).data.status).toBe('processed');

    const second = await postSync(apiKey, storeId, 'evt-dup-1', [item('DUP-1'), item('DUP-2')]);
    expect(second.status).toBe(200);
    expect((await second.json()).data.status).toBe('duplicate');
  });

  // 12. repeated identical product.sync does not duplicate product records
  it('does not create duplicate product rows when the identical batch is redelivered', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-dup-2', [item('DUP-ROW')]);
    await postSync(apiKey, storeId, 'evt-dup-2', [item('DUP-ROW')]);

    const rows = await prisma.product.findMany({ where: { storeId, sku: 'DUP-ROW' } });
    expect(rows).toHaveLength(1);
  });

  // 13. duplicate SKU inside batch behaves deterministically (later wins)
  it('resolves a duplicate SKU within one batch deterministically — the later item wins, and both get a result', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-dup-sku', [item('SAME-SKU', { price: 100 }), item('SAME-SKU', { price: 200 })]);
    const body = await res.json();
    expect(body.data.results).toHaveLength(2);
    expect(body.data.results[0]).toMatchObject({ index: 0, sku: 'SAME-SKU', status: 'applied' });
    expect(body.data.results[1]).toMatchObject({ index: 1, sku: 'SAME-SKU', status: 'applied' });

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SAME-SKU' } } });
    expect(product.price).toBe(200); // later item in the array wins
  });

  // 14. stale item does not overwrite newer sourceUpdatedAt
  it('does not let a stale item overwrite a newer sourceUpdatedAt', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-stale-seed', [item('STALE-1', { price: 2000, occurred_at: '2026-09-02T12:00:00Z' })]);
    const res = await postSync(apiKey, storeId, 'evt-stale-attempt', [item('STALE-1', { price: 1000, occurred_at: '2026-09-02T11:00:00Z' })]);
    const body = await res.json();
    expect(body.data.results[0]).toMatchObject({ status: 'unchanged', reason: 'stale' });

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'STALE-1' } } });
    expect(product.price).toBe(2000);
  });

  // 15. newer item overwrites older sourceUpdatedAt
  it('lets a newer item overwrite an older sourceUpdatedAt', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-fresh-seed', [item('FRESH-1', { price: 1000, occurred_at: '2026-09-02T10:00:00Z' })]);
    const res = await postSync(apiKey, storeId, 'evt-fresh-attempt', [item('FRESH-1', { price: 3000, occurred_at: '2026-09-02T11:00:00Z' })]);
    const body = await res.json();
    expect(body.data.results[0]).toMatchObject({ status: 'applied' });

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'FRESH-1' } } });
    expect(product.price).toBe(3000);
    expect(product.sourceUpdatedAt?.toISOString()).toBe('2026-09-02T11:00:00.000Z');
  });

  // 16. missing occurred_at preserves compatibility (unconditional overwrite)
  it('unconditionally overwrites when occurred_at is absent, matching pre-existing compatibility behavior', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-nots-1', [item('NO-TS', { price: 1000 })]);
    const res = await postSync(apiKey, storeId, 'evt-nots-2', [item('NO-TS', { price: 5000 })]);
    const body = await res.json();
    expect(body.data.results[0].status).toBe('applied');

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'NO-TS' } } });
    expect(product.price).toBe(5000);
  });

  // 17. already-missing delete returns unchanged, not a batch failure
  it('reports an already-missing delete as unchanged rather than failing the batch', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-missing-del', [{ sku: 'NEVER-EXISTED', action: 'delete' }, item('OK')]);
    const body = await res.json();
    expect(body.data.status).toBe('processed'); // zero failures — unchanged isn't a failure
    expect(body.data.results[0]).toMatchObject({ status: 'unchanged', reason: 'already_missing' });
    expect(body.data.results[1]).toMatchObject({ status: 'applied' });
  });

  // 18. developer_owned store accepts product.sync
  it('still allows product.sync for a developer_owned store', async () => {
    const { owner, apiKey, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });

    const res = await postSync(apiKey, storeId, 'evt-dev-owned', [item('DEV-SYNC')]);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('processed');
  });

  // 19. nexora_managed CRUD protection remains intact
  it('still blocks dashboard/API CRUD for a developer_owned store while sync keeps working', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'CRUD-BLOCKED', name: 'X', price: 1000 } }),
    );
    expect(res.status).toBe(403);
  });

  // 20. nx_public_ key cannot perform catalog write
  it('rejects product.sync from a public (js_sdk) key', async () => {
    const { owner, storeId } = await setup();
    const jsSdk = await createIntegration(owner.jar, { storeId, provider: 'js_sdk' });
    const res = await postSync(jsSdk.body.data.apiKey, storeId, 'evt-public-key', [item('SHOULD-NOT-EXIST')]);
    expect(res.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'SHOULD-NOT-EXIST' } })).toBeNull();
  });

  // 21. authenticated store isolation
  it('rejects a product.sync claiming a different store than the authenticated key', async () => {
    const { apiKey } = await setup();
    const other = await registerUser({ name: 'Other', email: 'sync-batch-other@example.com', password: 'password123', orgName: 'Other Sync Org' });
    const otherStore = await createStore(other.jar, { name: 'Other Store' });

    const res = await postSync(apiKey, otherStore.body.data.id as string, 'evt-cross-store', [item('CROSS')]);
    expect(res.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { sku: 'CROSS' } })).toBeNull();
  });

  // 22. connector resolution uses authenticated provider
  it('resolves the connector from the authenticated provider for a batch, not a hardcoded one', async () => {
    const { owner, storeId } = await setup(); // already has a custom_api integration
    const webhookIntegration = await createIntegration(owner.jar, { storeId, provider: 'custom_webhook' });

    const webhookSpy = vi.spyOn(connectorRegistry.custom_webhook, 'normalizeProduct');
    const apiSpy = vi.spyOn(connectorRegistry.custom_api, 'normalizeProduct');

    const res = await postSync(webhookIntegration.body.data.apiKey, storeId, 'evt-connector', [item('CONN-1'), item('CONN-2')]);
    expect(res.status).toBe(200);
    expect(webhookSpy).toHaveBeenCalledTimes(2);
    expect(apiSpy).not.toHaveBeenCalled();
  });

  // 23. rate limit is charged by item count
  it('charges the catalog-sync rate limit bucket by item count, not by request count', async () => {
    const { apiKey, storeId } = await setup();
    // Leave only 5 tokens in this store's catalog-sync bucket.
    consume(`catalog-sync:${storeId}`, CATALOG_SYNC_ITEMS_PER_MINUTE, 60_000, CATALOG_SYNC_ITEMS_PER_MINUTE - 5);

    const res = await postSync(apiKey, storeId, 'evt-rl-cost', Array.from({ length: 10 }, (_, i) => item(`RL-${i}`)));
    expect(res.status).toBe(429);
    expect(await prisma.product.count({ where: { storeId } })).toBe(0);
  });

  // 24. normal existing webhook rate limiting still works, independent of the catalog-sync bucket
  it('keeps the normal per-request webhook rate limit intact and independent of the catalog-sync bucket', async () => {
    const { apiKey, storeId } = await setup();
    // Exhaust only the flat per-request bucket, not catalog-sync.
    for (let i = 0; i < 60; i++) consume(`webhook:${storeId}`, 60, 60_000);

    const res = await postSync(apiKey, storeId, 'evt-rl-normal', [item('RL-NORMAL')]);
    expect(res.status).toBe(429);
  });

  // 25. request body/payload limit
  it('rejects a request body that exceeds the webhook body-size limit', async () => {
    const { apiKey, storeId } = await setup();
    const { POST } = await import('@/app/api/webhooks/products/route');
    const oversizedDescription = 'a'.repeat(6_000_000); // exceeds MAX_WEBHOOK_BODY_BYTES (5MB) on its own
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(envelope(storeId, 'evt-oversized', [{ sku: 'HUGE', name: 'X', price: 1000, description: oversizedDescription }])),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(422);
  });

  // 26. variants/images/categories/attributes survive batch upsert
  it('preserves variants, images, categories, and attributes through a batch upsert', async () => {
    const { apiKey, storeId } = await setup();
    const res = await postSync(apiKey, storeId, 'evt-full-fields', [
      item('FULL-1', {
        images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
        categories: ['Food', 'Sale'],
        attributes: { material: 'ceramic' },
        variants: [{ name: 'Large', sku: 'FULL-1-L', price: 1200, quantity: 5 }],
      }),
    ]);
    expect((await res.json()).data.applied).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'FULL-1' } }, include: { variants: true } });
    expect(JSON.parse(product.images)).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg']);
    expect(JSON.parse(product.categories)).toEqual(['Food', 'Sale']);
    expect(JSON.parse(product.attributes)).toEqual({ material: 'ceramic' });
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].sku).toBe('FULL-1-L');
  });

  // 27. inventory behavior remains unchanged — product.sync quantity does not touch existing stock
  it('does not let a batch upsert change existing stock — inventory.updated remains the only path', async () => {
    const { apiKey, storeId } = await setup();
    await postSync(apiKey, storeId, 'evt-stock-1', [item('STOCK-SYNC', { quantity: 10 })]);
    let product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'STOCK-SYNC' } }, include: { inventory: true } });
    expect(product.inventory?.quantity).toBe(10);

    await postSync(apiKey, storeId, 'evt-stock-2', [item('STOCK-SYNC', { quantity: 999 })]);
    product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'STOCK-SYNC' } }, include: { inventory: true } });
    expect(product.inventory?.quantity).toBe(10); // unchanged by the second sync
  });

  // 28. integration summary logging does not leak secrets
  it('writes exactly one summary IntegrationLog per batch, with no API key or payload leakage', async () => {
    const { apiKey, storeId, integrationId } = await setup();
    await postSync(apiKey, storeId, 'evt-log-summary', [item('LOG-1'), item('LOG-2')]);

    const logs = await prisma.integrationLog.findMany({ where: { storeId, integrationId, message: { contains: 'Catalog sync' } } });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).not.toContain(apiKey);
    expect(logs[0].message).not.toContain('LOG-1');
    expect(logs[0].metadata).not.toContain(apiKey);
  });

  // 29. systemic database/service failure is handled appropriately — stops early, doesn't mask as per-item errors
  //
  // syncProductBatch calls upsertProduct/deleteProductBySku as plain
  // same-module identifiers, which vi.spyOn cannot intercept (a well-known
  // ESM limitation — the internal reference is a fixed binding, not
  // indirected through the export object). syncProductBatch's `upsert`/
  // `remove` params exist specifically so this can be tested reliably: call
  // the service function directly with an injected failing implementation,
  // rather than going through the HTTP route.
  it('stops processing after an unexpected (non-validation) error and reports the remaining items as not_attempted', async () => {
    const { storeId } = await setup();
    let call = 0;
    const flakyUpsert: typeof productService.upsertProduct = async (sId, product, options) => {
      call++;
      if (call === 2) throw new Error('simulated systemic failure — e.g. the database became unreachable');
      return productService.upsertProduct(sId, product, options);
    };

    const result = await productService.syncProductBatch({
      storeId,
      items: [item('SYS-1'), item('SYS-2'), item('SYS-3')],
      parseItem: (raw) => productSyncItemSchema.parse(raw),
      normalizeProduct: (raw) => connectorRegistry.custom_api.normalizeProduct(raw),
      upsert: flakyUpsert,
    });

    expect(result.results[0]).toMatchObject({ sku: 'SYS-1', status: 'applied' });
    expect(result.results[1]).toMatchObject({ sku: 'SYS-2', status: 'failed' });
    expect(result.results[1].reason).toBeUndefined();
    // The third item was never attempted — the loop stopped rather than
    // trying (and likely failing) 3 unrelated-looking times.
    expect(result.results[2]).toMatchObject({ status: 'failed', reason: 'not_attempted' });
    expect(result.status).toBe('partial');

    expect(await prisma.product.findFirst({ where: { storeId, sku: 'SYS-1' } })).not.toBeNull();
    expect(await prisma.product.findFirst({ where: { storeId, sku: 'SYS-3' } })).toBeNull();
  });
});
