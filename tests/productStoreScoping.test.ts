import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { signWebhookBody } from '@/lib/webhookSignature';
import { resetDb, registerUser, createStore, createIntegration, connectIntegration, buildRequest } from './helpers';

describe('product creation must be explicitly, validly, server-side store-scoped', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await registerUser({ name: 'Owner', email: 'prod-scope-owner@example.com', password: 'password123', orgName: 'Prod Scope Org' });
    const store = await createStore(owner.jar, { name: 'Prod Scope Store' });
    return { owner, storeId: store.body.data.id as string };
  }

  // Store-scoping tests below are about *which* store a product lands in,
  // not the separate connected-store creation gate — see the dedicated
  // "product creation requires a connected store" describe block at the
  // bottom of this file for that gate's own tests. This connects the store
  // up front so these tests keep testing only what they say they test.
  async function setupConnected() {
    const { owner, storeId } = await setup();
    const integration = await createIntegration(owner.jar, { storeId, provider: 'js_sdk' });
    await connectIntegration(integration.body.data.integration.id);
    return { owner, storeId };
  }

  it('succeeds when created against the selected, accessible, nexora_managed store', async () => {
    const { owner, storeId } = await setupConnected();
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'OK-1', name: 'OK Product', price: 1000 } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('OK Product');

    const stored = await prisma.product.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(stored.storeId).toBe(storeId);
  });

  it('rejects product creation with no storeId at all', async () => {
    const { owner } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { sku: 'NO-STORE-1', name: 'No Store', price: 1000 } }),
    );
    expect(res.status).toBe(422);

    const found = await prisma.product.findFirst({ where: { sku: 'NO-STORE-1' } });
    expect(found).toBeNull();
  });

  it('rejects "all" as a storeId — there is no "All Stores" product creation target', async () => {
    const { owner } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId: 'all', sku: 'ALL-1', name: 'All Stores?', price: 1000 } }),
    );
    expect(res.status).toBe(404);

    const found = await prisma.product.findFirst({ where: { sku: 'ALL-1' } });
    expect(found).toBeNull();
  });

  it('rejects product creation against a store the session cannot access (a different organization)', async () => {
    const { owner } = await setup();
    const other = await registerUser({ name: 'Other', email: 'prod-scope-other@example.com', password: 'password123', orgName: 'Other Org' });
    const otherStore = await createStore(other.jar, { name: 'Other Org Store' });

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        jar: owner.jar,
        body: { storeId: otherStore.body.data.id, sku: 'CROSS-ORG-1', name: 'Cross Org', price: 1000 },
      }),
    );
    expect(res.status).toBe(404);

    const found = await prisma.product.findFirst({ where: { sku: 'CROSS-ORG-1' } });
    expect(found).toBeNull();
  });

  it('rejects an API key from one store creating a product against a different store (no cross-store creation)', async () => {
    const { owner, storeId } = await setup();
    const store2 = await createStore(owner.jar, { name: 'Prod Scope Store 2' });
    const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId: store2.body.data.id, sku: 'CROSS-STORE-1', name: 'Cross Store', price: 1000 },
      }),
    );
    expect(res.status).toBe(403);

    const found = await prisma.product.findFirst({ where: { sku: 'CROSS-STORE-1' } });
    expect(found).toBeNull();
  });

  it('rejects dashboard-session product creation against a developer_owned store (preserves read-only behavior)', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        jar: owner.jar,
        body: { storeId, sku: 'DEV-OWNED-1', name: 'Should not be creatable', price: 1000 },
      }),
    );
    expect(res.status).toBe(403);

    const found = await prisma.product.findFirst({ where: { sku: 'DEV-OWNED-1' } });
    expect(found).toBeNull();
  });

  it('rejects an API-key POST /api/products against a developer_owned store too — that endpoint is create-only CRUD, not the sync channel', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });
    const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId, sku: 'DEV-OWNED-PUSH-1', name: 'Should not be creatable via API key either', price: 1000 },
      }),
    );
    expect(res.status).toBe(403);

    const found = await prisma.product.findFirst({ where: { sku: 'DEV-OWNED-PUSH-1' } });
    expect(found).toBeNull();
  });

  it('rejects dashboard-session product update (PATCH) against a developer_owned store', async () => {
    const { owner, storeId } = await setupConnected();
    const { POST } = await import('@/app/api/products/route');
    const createRes = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'PRE-CONVERT-1', name: 'Before conversion', price: 1000 } }),
    );
    const created = await createRes.json();

    const { PATCH: patchStore } = await import('@/app/api/stores/[id]/route');
    await patchStore(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });

    const { PATCH: patchProduct } = await import('@/app/api/products/[id]/route');
    const res = await patchProduct(
      buildRequest(`/api/products/${created.data.id}`, { method: 'PATCH', jar: owner.jar, body: { name: 'Edited after conversion' } }),
      { params: { id: created.data.id } },
    );
    expect(res.status).toBe(403);

    const stillOriginal = await prisma.product.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(stillOriginal.name).toBe('Before conversion');
  });

  it('still allows the real developer-owned sync channel — POST /api/webhooks/products — for a developer_owned store', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });
    await createIntegration(owner.jar, { storeId, provider: 'custom_webhook' });
    const endpoint = await prisma.webhookEndpoint.findFirstOrThrow({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    const secret = decryptSecret(endpoint.secretCiphertext);

    const payload = {
      event: 'product.created',
      store_id: storeId,
      event_id: 'evt-dev-owned-sync-1',
      data: { sku: 'SYNCED-1', name: 'Synced From Developer System', price: 2000 },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);

    const { POST } = await import('@/app/api/webhooks/products/route');
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/products', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nexora-signature': signWebhookBody(secret, timestamp, rawBody),
          'x-nexora-timestamp': String(timestamp),
        },
        body: rawBody,
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);

    const synced = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SYNCED-1' } } });
    expect(synced.name).toBe('Synced From Developer System');
  });
});

describe('product creation requires a connected store (pre-phase-1 checkpoint)', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await registerUser({ name: 'Owner', email: 'prod-gate-owner@example.com', password: 'password123', orgName: 'Prod Gate Org' });
    const store = await createStore(owner.jar, { name: 'Prod Gate Store' });
    return { owner, storeId: store.body.data.id as string };
  }

  it('rejects dashboard-session product creation for a store with no integration at all', async () => {
    const { owner, storeId } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'NOINT-1', name: 'X', price: 1000 } }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { sku: 'NOINT-1' } })).toBeNull();
  });

  it('rejects dashboard-session product creation for a store whose integration exists but has never actually connected', async () => {
    const { owner, storeId } = await setup();
    await createIntegration(owner.jar, { storeId, provider: 'js_sdk' }); // created, but no real request/webhook/event ever landed
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'NEVERUSED-1', name: 'X', price: 1000 } }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/connect/i);
    expect(await prisma.product.findFirst({ where: { sku: 'NEVERUSED-1' } })).toBeNull();
  });

  it('rejects dashboard-session product creation while the only integration is stale (warning, not connected)', async () => {
    const { owner, storeId } = await setup();
    const integration = await createIntegration(owner.jar, { storeId, provider: 'js_sdk' });
    await prisma.integration.update({
      where: { id: integration.body.data.integration.id },
      data: { lastRequestAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }, // >24h ago -> 'warning', not 'connected'
    });
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'STALE-1', name: 'X', price: 1000 } }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { sku: 'STALE-1' } })).toBeNull();
  });

  it('allows dashboard-session product creation once the store has a genuinely connected integration', async () => {
    const { owner, storeId } = await setup();
    const integration = await createIntegration(owner.jar, { storeId, provider: 'js_sdk' });
    await connectIntegration(integration.body.data.integration.id);
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'CONNECTED-1', name: 'X', price: 1000 } }),
    );
    expect(res.status).toBe(201);
    expect(await prisma.product.findFirst({ where: { sku: 'CONNECTED-1' } })).not.toBeNull();
  });

  it('rejects an API-key product creation for a store whose own integration has never connected', async () => {
    const { owner, storeId } = await setup();
    const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId, sku: 'APIKEY-NOINT-1', name: 'X', price: 1000 },
      }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.product.findFirst({ where: { sku: 'APIKEY-NOINT-1' } })).toBeNull();
  });

  it('allows an API-key product creation once that store\'s integration is genuinely connected', async () => {
    const { owner, storeId } = await setup();
    const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });
    await connectIntegration(integration.body.data.integration.id);
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId, sku: 'APIKEY-CONNECTED-1', name: 'X', price: 1000 },
      }),
    );
    expect(res.status).toBe(201);
    expect(await prisma.product.findFirst({ where: { sku: 'APIKEY-CONNECTED-1' } })).not.toBeNull();
  });
});
