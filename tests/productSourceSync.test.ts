import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { signWebhookBody } from '@/lib/webhookSignature';
import { resetDb, registerUser, createStore, createIntegration, buildRequest } from './helpers';

describe('product webhook sync — sourceUpdatedAt staleness + tightened validation', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await registerUser({ name: 'Owner', email: 'sync-owner@example.com', password: 'password123', orgName: 'Sync Org' });
    const store = await createStore(owner.jar, { name: 'Sync Store' });
    const storeId = store.body.data.id as string;
    await createIntegration(owner.jar, { storeId, provider: 'custom_webhook' });
    const endpoint = await prisma.webhookEndpoint.findFirstOrThrow({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    const secret = decryptSecret(endpoint.secretCiphertext);
    return { owner, storeId, secret };
  }

  async function postProduct(secret: string, storeId: string, eventId: string, data: Record<string, unknown>, occurredAt?: string) {
    const payload = {
      event: 'product.created',
      store_id: storeId,
      event_id: eventId,
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
      data,
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const { POST } = await import('@/app/api/webhooks/products/route');
    return POST(
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
  }

  it('accepts a valid occurred_at and stores it on Product.sourceUpdatedAt', async () => {
    const { storeId, secret } = await setup();
    const res = await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-1', name: 'First', price: 1000 }, '2026-09-01T10:00:00Z');
    expect(res.status).toBe(200);

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-1' } } });
    expect(product.sourceUpdatedAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('an older occurred_at cannot overwrite a newer product', async () => {
    const { storeId, secret } = await setup();
    await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-2', name: 'New', price: 2000 }, '2026-09-01T12:00:00Z');
    const staleRes = await postProduct(secret, storeId, 'evt-2', { sku: 'SKU-2', name: 'Old', price: 1000 }, '2026-09-01T11:00:00Z');
    expect(staleRes.status).toBe(200); // rejected as stale, not an error — a benign no-op

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-2' } } });
    expect(product.name).toBe('New');
    expect(product.price).toBe(2000);
    expect(product.sourceUpdatedAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('an equal occurred_at cannot overwrite the existing product', async () => {
    const { storeId, secret } = await setup();
    await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-3', name: 'First', price: 1000 }, '2026-09-01T12:00:00Z');
    await postProduct(secret, storeId, 'evt-2', { sku: 'SKU-3', name: 'Second', price: 5000 }, '2026-09-01T12:00:00Z');

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-3' } } });
    expect(product.name).toBe('First');
    expect(product.price).toBe(1000);
  });

  it('a newer occurred_at updates the product and advances sourceUpdatedAt', async () => {
    const { storeId, secret } = await setup();
    await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-4', name: 'A', price: 1000 }, '2026-09-01T10:00:00Z');
    await postProduct(secret, storeId, 'evt-2', { sku: 'SKU-4', name: 'B', price: 2000 }, '2026-09-01T11:00:00Z');

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-4' } } });
    expect(product.name).toBe('B');
    expect(product.price).toBe(2000);
    expect(product.sourceUpdatedAt?.toISOString()).toBe('2026-09-01T11:00:00.000Z');
  });

  it('a missing occurred_at preserves the old unconditional-overwrite behavior', async () => {
    const { storeId, secret } = await setup();
    await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-5', name: 'A', price: 1000 }); // no occurred_at
    await postProduct(secret, storeId, 'evt-2', { sku: 'SKU-5', name: 'B', price: 2000 }); // no occurred_at

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-5' } } });
    expect(product.name).toBe('B'); // unconditionally overwritten, exactly like before this feature existed
    expect(product.price).toBe(2000);
    expect(product.sourceUpdatedAt).toBeNull();
  });

  it('a later push with no occurred_at still applies and does not null out a previously stored sourceUpdatedAt', async () => {
    const { storeId, secret } = await setup();
    await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-6', name: 'A', price: 1000 }, '2026-09-01T10:00:00Z');
    await postProduct(secret, storeId, 'evt-2', { sku: 'SKU-6', name: 'B', price: 2000 }); // no occurred_at this time

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'SKU-6' } } });
    expect(product.name).toBe('B'); // still applied — no staleness check runs without an incoming occurred_at
    expect(product.sourceUpdatedAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z'); // left untouched, not nulled
  });

  it('rejects a data: image URL on the webhook sync channel', async () => {
    const { storeId, secret } = await setup();
    const res = await postProduct(secret, storeId, 'evt-1', {
      sku: 'SKU-7',
      name: 'Bad Image',
      price: 1000,
      images: ['data:image/png;base64,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    });
    expect(res.status).toBe(422);
    const found = await prisma.product.findFirst({ where: { storeId, sku: 'SKU-7' } });
    expect(found).toBeNull();
  });

  it('rejects an oversized description', async () => {
    const { storeId, secret } = await setup();
    const res = await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-8', name: 'X', price: 1000, description: 'a'.repeat(4001) });
    expect(res.status).toBe(422);
  });

  it('rejects more than 8 images', async () => {
    const { storeId, secret } = await setup();
    const images = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.jpg`);
    const res = await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-9', name: 'X', price: 1000, images });
    expect(res.status).toBe(422);
  });

  it('rejects more than 20 categories', async () => {
    const { storeId, secret } = await setup();
    const categories = Array.from({ length: 21 }, (_, i) => `Cat${i}`);
    const res = await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-10', name: 'X', price: 1000, categories });
    expect(res.status).toBe(422);
  });

  it('rejects more than 30 custom attributes', async () => {
    const { storeId, secret } = await setup();
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 31; i++) attributes[`key${i}`] = 'v';
    const res = await postProduct(secret, storeId, 'evt-1', { sku: 'SKU-11', name: 'X', price: 1000, attributes });
    expect(res.status).toBe(422);
  });

  it('leaves the existing dashboard/session product form (data: URL uploads) unaffected', async () => {
    const { owner, storeId } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        jar: owner.jar,
        body: {
          storeId,
          sku: 'DASH-1',
          name: 'Dashboard Upload',
          price: 1000,
          images: ['data:image/png;base64,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        },
      }),
    );
    expect(res.status).toBe(201); // dashboard form still accepts data: URLs — only the webhook channel was tightened
  });

  it('still allows the developer-owned webhook sync channel to work', async () => {
    const { owner, storeId, secret } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });

    const res = await postProduct(secret, storeId, 'evt-1', { sku: 'DEV-1', name: 'Synced', price: 1000 }, '2026-09-01T10:00:00Z');
    expect(res.status).toBe(200);
    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'DEV-1' } } });
    expect(product.name).toBe('Synced');
  });

  it('still blocks dashboard/API product CRUD for developer_owned stores', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'BLOCKED-1', name: 'Nope', price: 1000 } }),
    );
    expect(res.status).toBe(403);
  });

  it('keeps inventory.updated as the only path that changes stock — a product.updated quantity is ignored', async () => {
    const { storeId, secret } = await setup();
    await postProduct(secret, storeId, 'evt-1', { sku: 'STOCK-1', name: 'A', price: 1000, quantity: 10 });
    const product1 = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'STOCK-1' } }, include: { inventory: true } });
    expect(product1.inventory?.quantity).toBe(10);

    // product.updated carrying `quantity` must NOT change stock.
    await postProduct(secret, storeId, 'evt-2', { sku: 'STOCK-1', name: 'A', price: 1000, quantity: 999 });
    const product2 = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'STOCK-1' } }, include: { inventory: true } });
    expect(product2.inventory?.quantity).toBe(10); // unchanged

    // inventory.updated is the real path.
    const invPayload = {
      event: 'inventory.updated',
      store_id: storeId,
      event_id: 'evt-inv-1',
      data: { sku: 'STOCK-1', quantity: 42 },
    };
    const rawBody = JSON.stringify(invPayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const { POST: postInventory } = await import('@/app/api/webhooks/inventory/route');
    const invRes = await postInventory(
      new Request('http://localhost:3000/api/webhooks/inventory', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nexora-signature': signWebhookBody(secret, timestamp, rawBody),
          'x-nexora-timestamp': String(timestamp),
        },
        body: rawBody,
      }) as unknown as Parameters<typeof postInventory>[0],
    );
    expect(invRes.status).toBe(200);

    const product3 = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'STOCK-1' } }, include: { inventory: true } });
    expect(product3.inventory?.quantity).toBe(42);
  });
});
