import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, signSessionToken } from '@/lib/auth';
import { toJson } from '@/lib/json';
import { resetDb, buildRequest, registerUser, createStore, createIntegration } from './helpers';

describe('authorization & store isolation', () => {
  beforeEach(resetDb);

  it("prevents User A from reading User B's store by id, and vice versa", async () => {
    const a = await registerUser({ name: 'A Owner', email: 'a-owner@example.com', password: 'password123', orgName: 'Org A' });
    const b = await registerUser({ name: 'B Owner', email: 'b-owner@example.com', password: 'password123', orgName: 'Org B' });

    const storeA = await createStore(a.jar, { name: 'Store A' });
    const storeB = await createStore(b.jar, { name: 'Store B' });

    const { GET } = await import('@/app/api/stores/[id]/route');

    const bReadsA = await GET(buildRequest(`/api/stores/${storeA.body.data.id}`, { jar: b.jar }), {
      params: { id: storeA.body.data.id },
    });
    expect(bReadsA.status).toBe(404);

    const aReadsB = await GET(buildRequest(`/api/stores/${storeB.body.data.id}`, { jar: a.jar }), {
      params: { id: storeB.body.data.id },
    });
    expect(aReadsB.status).toBe(404);
  });

  it("prevents User A from listing or reading User B's orders, even by direct order id", async () => {
    const a = await registerUser({ name: 'A2', email: 'a2@example.com', password: 'password123', orgName: 'Org A2' });
    const b = await registerUser({ name: 'B2', email: 'b2@example.com', password: 'password123', orgName: 'Org B2' });

    const storeB = await createStore(b.jar, { name: 'Store B2' });
    const integrationB = await createIntegration(b.jar, { storeId: storeB.body.data.id, provider: 'custom_api' });

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const orderRes = await postOrder(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${integrationB.body.data.apiKey}` },
        body: {
          storeId: storeB.body.data.id,
          externalId: 'ORD-1',
          customer: { name: 'Musa' },
          items: [{ name: 'Rice', quantity: 1, price: 5000 }],
          total: 5000,
          currency: 'NGN',
        },
      }),
    );
    expect(orderRes.status).toBe(201);
    const order = (await orderRes.json()).data;

    const { GET: getOrder } = await import('@/app/api/orders/[id]/route');
    const aReadsBOrder = await getOrder(buildRequest(`/api/orders/${order.id}`, { jar: a.jar }), { params: { id: order.id } });
    expect(aReadsBOrder.status).toBe(404);

    const { GET: listOrders } = await import('@/app/api/orders/route');
    const aListsWithBStoreId = await listOrders(buildRequest(`/api/orders?storeId=${storeB.body.data.id}`, { jar: a.jar }));
    expect(aListsWithBStoreId.status).toBe(404); // assertStoreAccess rejects a foreign storeId filter
  });

  it("rejects an API key used against a store it doesn't belong to", async () => {
    const a = await registerUser({ name: 'A3', email: 'a3@example.com', password: 'password123', orgName: 'Org A3' });
    const storeA1 = await createStore(a.jar, { name: 'Store A3-1' });
    const storeA2 = await createStore(a.jar, { name: 'Store A3-2' });
    const integrationA1 = await createIntegration(a.jar, { storeId: storeA1.body.data.id, provider: 'custom_api' });

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const res = await postOrder(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${integrationA1.body.data.apiKey}` },
        body: {
          storeId: storeA2.body.data.id, // mismatched store
          externalId: 'ORD-2',
          customer: { name: 'Chidi' },
          items: [{ name: 'Item', quantity: 1, price: 1000 }],
          total: 1000,
          currency: 'NGN',
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects a revoked API key', async () => {
    const a = await registerUser({ name: 'A4', email: 'a4@example.com', password: 'password123', orgName: 'Org A4' });
    const store = await createStore(a.jar, { name: 'Store A4' });
    const integration = await createIntegration(a.jar, { storeId: store.body.data.id, provider: 'custom_api' });

    const { DELETE } = await import('@/app/api/integrations/[id]/route');
    await DELETE(buildRequest(`/api/integrations/${integration.body.data.integration.id}`, { method: 'DELETE', jar: a.jar }), {
      params: { id: integration.body.data.integration.id },
    });

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const res = await postOrder(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${integration.body.data.apiKey}` },
        body: {
          storeId: store.body.data.id,
          externalId: 'ORD-3',
          customer: { name: 'Tunde' },
          items: [{ name: 'Item', quantity: 1, price: 1000 }],
          total: 1000,
          currency: 'NGN',
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('enforces per-store staff permissions (view without manage)', async () => {
    const owner = await registerUser({ name: 'Owner5', email: 'owner5@example.com', password: 'password123', orgName: 'Org 5' });
    const store = await createStore(owner.jar, { name: 'Store 5' });

    const me = await (await import('@/app/api/auth/me/route')).GET(buildRequest('/api/auth/me', { jar: owner.jar }));
    const meBody = await me.json();
    const organizationId = meBody.data.organization.id;

    const staffUser = await prisma.user.create({
      data: { name: 'Staff', email: 'staff5@example.com', passwordHash: await hashPassword('password123'), role: 'STAFF' },
    });
    const staffMember = await prisma.member.create({
      data: { userId: staffUser.id, organizationId, role: 'STAFF', status: 'active' },
    });
    await prisma.storeAssignment.create({
      data: {
        memberId: staffMember.id,
        storeId: store.body.data.id,
        permissions: toJson({ viewOrders: true, manageOrders: false }),
      },
    });
    const staffJar = { session: signSessionToken({ sub: staffUser.id, role: staffUser.role }) };

    const { GET: listOrders } = await import('@/app/api/orders/route');
    const viewRes = await listOrders(buildRequest(`/api/orders?storeId=${store.body.data.id}`, { jar: staffJar }));
    expect(viewRes.status).toBe(200);

    const { POST: postOrder } = await import('@/app/api/orders/route');
    const createAttempt = await postOrder(
      buildRequest('/api/orders', { method: 'POST', jar: staffJar, body: { storeId: store.body.data.id, externalId: 'x', customer: { name: 'x' }, items: [{ name: 'x', quantity: 1, price: 1 }], total: 1, currency: 'NGN' } }),
    );
    // Staff (non-owner) cannot manually create orders from the dashboard at all.
    expect(createAttempt.status).toBe(403);
  });
});
