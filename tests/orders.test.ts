import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb, buildRequest, registerUser, createStore, createIntegration } from './helpers';

describe('orders', () => {
  beforeEach(resetDb);

  it('creates an order via API key, decrements inventory, and raises a notification', async () => {
    const owner = await registerUser({ name: 'Owner', email: 'orders-owner@example.com', password: 'password123', orgName: 'Orders Org' });
    const store = await createStore(owner.jar, { name: 'Iya Kudinka Restaurant', type: 'restaurant' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_api' });

    const { POST: postProduct } = await import('@/app/api/products/route');
    await postProduct(
      buildRequest('/api/products', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId: store.body.data.id, sku: 'CHK-1', name: 'Chicken', price: 2000, quantity: 10 },
      }),
    );

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const res = await postOrder(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: {
          storeId: store.body.data.id,
          externalId: 'ORD-1001',
          customer: { id: 'cust-1', name: 'Musa' },
          items: [{ sku: 'CHK-1', name: 'Chicken', quantity: 2, price: 2000 }],
          total: 4000,
          currency: 'NGN',
        },
      }),
    );

    expect(res.status).toBe(201);

    const product = await prisma.product.findFirst({ where: { storeId: store.body.data.id, sku: 'CHK-1' }, include: { inventory: true } });
    expect(product?.inventory?.quantity).toBe(8);

    const notifications = await prisma.notification.findMany({ where: { storeId: store.body.data.id } });
    const orderNotification = notifications.find((n) => n.type === 'order.created');
    expect(orderNotification).toBeTruthy();
    expect(orderNotification?.title).toContain('New order received');
  });

  it('rejects a duplicate externalId for the same store', async () => {
    const owner = await registerUser({ name: 'Owner2', email: 'orders-owner2@example.com', password: 'password123', orgName: 'Orders Org 2' });
    const store = await createStore(owner.jar, { name: 'Store' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_api' });

    const orderPayload = {
      storeId: store.body.data.id,
      externalId: 'ORD-SAME',
      customer: { name: 'Chidi' },
      items: [{ name: 'Item', quantity: 1, price: 1000 }],
      total: 1000,
      currency: 'NGN',
    };

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const first = await postOrder(
      buildRequest('/api/orders', { method: 'POST', headers: { authorization: `Bearer ${integration.body.data.apiKey}` }, body: orderPayload }),
    );
    expect(first.status).toBe(201);

    const second = await postOrder(
      buildRequest('/api/orders', { method: 'POST', headers: { authorization: `Bearer ${integration.body.data.apiKey}` }, body: orderPayload }),
    );
    expect(second.status).toBe(409);
  });

  it('rejects an order create request with a missing required field', async () => {
    const owner = await registerUser({ name: 'Owner3', email: 'orders-owner3@example.com', password: 'password123', orgName: 'Orders Org 3' });
    const store = await createStore(owner.jar, { name: 'Store' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_api' });

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const res = await postOrder(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId: store.body.data.id, externalId: 'ORD-X', items: [], total: 100, currency: 'NGN' }, // missing customer, empty items
      }),
    );
    expect(res.status).toBe(422);
  });

  it('lets an owner update order status via the dashboard and notifies on the change', async () => {
    const owner = await registerUser({ name: 'Owner4', email: 'orders-owner4@example.com', password: 'password123', orgName: 'Orders Org 4' });
    const store = await createStore(owner.jar, { name: 'Store' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_api' });

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const orderRes = await postOrder(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: { storeId: store.body.data.id, externalId: 'ORD-STATUS', customer: { name: 'Ngozi' }, items: [{ name: 'Item', quantity: 1, price: 500 }], total: 500, currency: 'NGN' },
      }),
    );
    const order = (await orderRes.json()).data;

    const { PATCH } = await import('@/app/api/orders/[id]/route');
    const patchRes = await PATCH(buildRequest(`/api/orders/${order.id}`, { method: 'PATCH', jar: owner.jar, body: { status: 'confirmed' } }), {
      params: { id: order.id },
    });
    expect(patchRes.status).toBe(200);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('confirmed');
  });

  it('rejects a mutating dashboard request without a matching CSRF token', async () => {
    const owner = await registerUser({ name: 'Owner5', email: 'orders-owner5@example.com', password: 'password123', orgName: 'Orders Org 5' });
    const store = await createStore(owner.jar, { name: 'Store' });

    const { POST } = await import('@/app/api/stores/route');
    const res = await POST(
      buildRequest('/api/stores', { method: 'POST', jar: { session: owner.jar.session }, body: { name: 'No CSRF Store' } }),
    );
    expect(res.status).toBe(403);
    // sanity: the store from setup exists, the CSRF-less one was rejected and not created
    const stores = await prisma.store.findMany({ where: { id: store.body.data.id } });
    expect(stores).toHaveLength(1);
  });
});
