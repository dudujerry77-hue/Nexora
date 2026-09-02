import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { signWebhookBody } from '@/lib/webhookSignature';
import { resetDb, registerUser, createStore, createIntegration, connectIntegration, buildRequest } from './helpers';

describe('products', () => {
  beforeEach(resetDb);

  // Product creation now requires a connected store (see
  // tests/productStoreScoping.test.ts's dedicated "creation requires a
  // connected store" tests) — most tests in this file are about product
  // *shape*, not that gate, so this setup connects a store up front.
  async function setup() {
    const owner = await registerUser({ name: 'Prod Owner', email: 'prod-owner@example.com', password: 'password123', orgName: 'Prod Org' });
    const store = await createStore(owner.jar, { name: 'Prod Store' });
    const storeId = store.body.data.id as string;
    const integration = await createIntegration(owner.jar, { storeId, provider: 'js_sdk' });
    await connectIntegration(integration.body.data.integration.id);
    return { owner, storeId };
  }

  it('creates a product with images, categories, and variants', async () => {
    const { owner, storeId } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        jar: owner.jar,
        body: {
          storeId,
          sku: 'SHOE-1',
          name: 'Running Shoe',
          description: 'Lightweight trainer',
          price: 25000,
          images: ['https://example.com/shoe.jpg'],
          categories: ['Footwear', 'Sale'],
          status: 'active',
          variants: [
            { name: 'Size 42', sku: 'SHOE-1-42', price: 25000, quantity: 3 },
            { name: 'Size 43', sku: 'SHOE-1-43', price: 25000, quantity: 5 },
          ],
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.images).toEqual(['https://example.com/shoe.jpg']);
    expect(body.data.imageUrl).toBe('https://example.com/shoe.jpg');
    expect(body.data.categories).toEqual(['Footwear', 'Sale']);
    expect(body.data.variants).toHaveLength(2);
  });

  it('replaces a product\'s variant set on update rather than appending', async () => {
    const { owner, storeId } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const createRes = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        jar: owner.jar,
        body: { storeId, sku: 'SHIRT-1', name: 'T-Shirt', price: 5000, variants: [{ name: 'Small', quantity: 2 }] },
      }),
    );
    const created = await createRes.json();
    expect(created.data.variants).toHaveLength(1);

    const { PATCH } = await import('@/app/api/products/[id]/route');
    const updateRes = await PATCH(
      buildRequest(`/api/products/${created.data.id}`, {
        method: 'PATCH',
        jar: owner.jar,
        body: { variants: [{ name: 'Medium', quantity: 4 }, { name: 'Large', quantity: 1 }] },
      }),
      { params: { id: created.data.id } },
    );
    const updated = await updateRes.json();
    expect(updated.data.variants).toHaveLength(2);
    expect(updated.data.variants.map((v: { name: string }) => v.name).sort()).toEqual(['Large', 'Medium']);

    const remainingVariants = await prisma.productVariant.findMany({ where: { productId: created.data.id } });
    expect(remainingVariants).toHaveLength(2);
  });

  it('deletes a product and its variants together', async () => {
    const { owner, storeId } = await setup();
    const { POST } = await import('@/app/api/products/route');
    const createRes = await POST(
      buildRequest('/api/products', {
        method: 'POST',
        jar: owner.jar,
        body: { storeId, sku: 'HAT-1', name: 'Hat', price: 3000, variants: [{ name: 'One size', quantity: 10 }] },
      }),
    );
    const created = await createRes.json();

    const { DELETE } = await import('@/app/api/products/[id]/route');
    const res = await DELETE(buildRequest(`/api/products/${created.data.id}`, { method: 'DELETE', jar: owner.jar }), {
      params: { id: created.data.id },
    });
    expect(res.status).toBe(200);

    const remainingVariants = await prisma.productVariant.findMany({ where: { productId: created.data.id } });
    expect(remainingVariants).toHaveLength(0);
  });

  it('rejects an attributes object with more than 30 keys', async () => {
    const { owner, storeId } = await setup();
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 31; i++) attributes[`key${i}`] = 'value';

    const { POST } = await import('@/app/api/products/route');
    const res = await POST(
      buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku: 'X-1', name: 'X', price: 100, attributes } }),
    );
    expect(res.status).toBe(422);
  });

  it('lets an owner switch a store to developer_owned product mode', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    const res = await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });
    expect(res.status).toBe(200);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.productMode).toBe('developer_owned');
  });

  it('maps images/categories/variants from a webhook push through the connector adapter', async () => {
    const { owner, storeId } = await setup();
    await createIntegration(owner.jar, { storeId, provider: 'custom_webhook' });
    const endpoint = await prisma.webhookEndpoint.findFirstOrThrow({ where: { storeId } });
    const secret = decryptSecret(endpoint.secretCiphertext);

    const payload = {
      event: 'product.created',
      store_id: storeId,
      event_id: 'evt-product-1',
      data: {
        sku: 'MUG-1',
        name: 'Coffee Mug',
        price: 1500,
        images: ['https://example.com/mug.jpg'],
        categories: ['Kitchen'],
        variants: [{ name: 'Blue', sku: 'MUG-1-BLUE', price: 1500, quantity: 20 }],
        attributes: { material: 'ceramic' },
      },
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

    const product = await prisma.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'MUG-1' } }, include: { variants: true } });
    expect(JSON.parse(product.images)).toEqual(['https://example.com/mug.jpg']);
    expect(JSON.parse(product.categories)).toEqual(['Kitchen']);
    expect(JSON.parse(product.attributes)).toEqual({ material: 'ceramic' });
    expect(product.variants).toHaveLength(1);
  });
});
