import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { signWebhookBody } from '@/lib/webhookSignature';
import { resetDb, registerUser, createStore, createIntegration } from './helpers';

async function getWebhookSecret(storeId: string): Promise<string> {
  const endpoint = await prisma.webhookEndpoint.findFirstOrThrow({ where: { storeId } });
  return decryptSecret(endpoint.secretCiphertext);
}

function signedHeaders(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    'x-nexora-signature': signWebhookBody(secret, timestamp, rawBody),
    'x-nexora-timestamp': String(timestamp),
  };
}

describe('webhooks', () => {
  beforeEach(resetDb);

  async function setupStoreWithWebhook() {
    const owner = await registerUser({ name: 'WH Owner', email: 'wh-owner@example.com', password: 'password123', orgName: 'WH Org' });
    const store = await createStore(owner.jar, { name: 'WH Store' });
    await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_webhook' });
    const secret = await getWebhookSecret(store.body.data.id);
    return { storeId: store.body.data.id, secret };
  }

  it('accepts a validly signed order.created webhook and creates the order', async () => {
    const { storeId, secret } = await setupStoreWithWebhook();
    const payload = {
      event: 'order.created',
      store_id: storeId,
      event_id: 'evt-1',
      data: {
        id: 'ORD-1001',
        customer: { name: 'Musa' },
        items: [{ name: 'Chicken', quantity: 2, price: 2000 }],
        total: 4000,
        currency: 'NGN',
      },
    };
    const rawBody = JSON.stringify(payload);

    const { POST } = await import('@/app/api/webhooks/orders/route');
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signedHeaders(secret, rawBody) },
        body: rawBody,
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('processed');

    const order = await prisma.order.findFirst({ where: { storeId, externalId: 'ORD-1001' } });
    expect(order).not.toBeNull();
    expect(order?.total).toBe(4000);
  });

  it('rejects a webhook with an invalid signature', async () => {
    const { storeId } = await setupStoreWithWebhook();
    const payload = { event: 'order.created', store_id: storeId, event_id: 'evt-bad-sig', data: { id: 'X', customer: { name: 'X' }, items: [{ name: 'X', quantity: 1, price: 1 }], total: 1, currency: 'NGN' } };
    const rawBody = JSON.stringify(payload);

    const { POST } = await import('@/app/api/webhooks/orders/route');
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nexora-signature': 'sha256=deadbeef', 'x-nexora-timestamp': String(Math.floor(Date.now() / 1000)) },
        body: rawBody,
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_signature');
  });

  it('treats a redelivered event_id as a no-op duplicate, not a second order', async () => {
    const { storeId, secret } = await setupStoreWithWebhook();
    const payload = {
      event: 'order.created',
      store_id: storeId,
      event_id: 'evt-dup',
      data: { id: 'ORD-DUP', customer: { name: 'Ada' }, items: [{ name: 'Item', quantity: 1, price: 500 }], total: 500, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const { POST } = await import('@/app/api/webhooks/orders/route');

    const makeReq = () =>
      new Request('http://localhost:3000/api/webhooks/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signedHeaders(secret, rawBody) },
        body: rawBody,
      }) as unknown as Parameters<typeof POST>[0];

    const first = await POST(makeReq());
    expect((await first.json()).data.status).toBe('processed');

    const second = await POST(makeReq());
    expect(second.status).toBe(200);
    expect((await second.json()).data.status).toBe('duplicate');

    const orders = await prisma.order.findMany({ where: { storeId, externalId: 'ORD-DUP' } });
    expect(orders).toHaveLength(1);
  });

  it('rejects a malformed webhook payload with a validation error', async () => {
    const { storeId, secret } = await setupStoreWithWebhook();
    const rawBody = JSON.stringify({ event: 'order.created', store_id: storeId, event_id: 'evt-bad-shape' /* missing data */ });

    const { POST } = await import('@/app/api/webhooks/orders/route');
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signedHeaders(secret, rawBody) },
        body: rawBody,
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(res.status).toBe(422);
  });

  it('rate limits a store that sends too many webhook requests too quickly', async () => {
    const { storeId, secret } = await setupStoreWithWebhook();
    const { POST } = await import('@/app/api/webhooks/orders/route');

    const send = (eventId: string) => {
      const payload = {
        event: 'order.created',
        store_id: storeId,
        event_id: eventId,
        data: { id: eventId, customer: { name: 'X' }, items: [{ name: 'X', quantity: 1, price: 1 }], total: 1, currency: 'NGN' },
      };
      const rawBody = JSON.stringify(payload);
      return POST(
        new Request('http://localhost:3000/api/webhooks/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...signedHeaders(secret, rawBody) },
          body: rawBody,
        }) as unknown as Parameters<typeof POST>[0],
      );
    };

    // Fired concurrently rather than awaited one-by-one: the rate limiter's
    // token bucket refills based on real elapsed wall-clock time, and each
    // webhook call does real DB work, so a sequential loop can take long
    // enough for refill to outpace consumption and never trip the limit.
    const responses = await Promise.all(Array.from({ length: 65 }, (_, i) => send(`evt-rl-${i}`)));
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
