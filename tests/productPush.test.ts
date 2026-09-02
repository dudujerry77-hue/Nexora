import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { connectorRegistry } from '@/lib/connectors';
import { PushVerificationError, type PushProductResult } from '@/lib/connectors/types';
import { resetDb, registerUser, createStore, createIntegration, connectIntegration, buildRequest } from './helpers';

async function setup() {
  const owner = await registerUser({ name: 'Owner', email: 'push-owner@example.com', password: 'password123', orgName: 'Push Org' });
  const store = await createStore(owner.jar, { name: 'Push Store' });
  const storeId = store.body.data.id as string;
  const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });
  await connectIntegration(integration.body.data.integration.id);
  return { owner, storeId };
}

async function createProduct(owner: { jar: { session?: string; csrf?: string } }, storeId: string, sku: string) {
  const { POST } = await import('@/app/api/products/route');
  const res = await POST(buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku, name: sku, price: 1000 } }));
  const body = await res.json();
  return body.data.id as string;
}

async function getCapability(jar: { session?: string; csrf?: string }, storeId: string) {
  const { GET } = await import('@/app/api/products/push/route');
  const res = await GET(buildRequest(`/api/products/push?storeId=${storeId}`, { jar }));
  return { res, body: await res.json() };
}

async function push(
  jar: { session?: string; csrf?: string },
  body: { storeId: string; mode: 'all' | 'selected'; productIds?: string[] },
) {
  const { POST } = await import('@/app/api/products/push/route');
  const res = await POST(buildRequest('/api/products/push', { method: 'POST', jar, body }));
  return { res, body: await res.json() };
}

describe('product push (pre-phase-1 checkpoint)', () => {
  beforeEach(resetDb);
  afterEach(() => {
    // Never let a test-registered push capability leak into another test —
    // production has zero connectors implementing this today (see
    // src/lib/connectors), so every test starts from that same honest
    // baseline unless it explicitly opts in.
    delete connectorRegistry.custom_api.pushProduct;
  });

  // 1. Product creation does NOT automatically trigger outbound push.
  it('never auto-pushes a newly created product', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'NOAUTO-1');
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('not_pushed');
    expect(product.lastPushedAt).toBeNull();
  });

  // 2 & 3. Push requires an eligible connected store; disconnected store cannot push.
  it('rejects push for a store with no connected integration', async () => {
    const owner = await registerUser({ name: 'Owner', email: 'push-disc-owner@example.com', password: 'password123', orgName: 'Push Disc Org' });
    const store = await createStore(owner.jar, { name: 'Disconnected Store' });
    const storeId = store.body.data.id as string;
    const { res } = await push(owner.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(403);
  });

  // 19. Unsupported outbound connector never reports fake success (the real, current-production baseline).
  it('reports "unsupported" — never fake success — when no connector implements outbound push', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'UNSUP-1');
    const { res, body } = await push(owner.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('unsupported');
    expect(body.data.pushed).toBe(0);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('unsupported');
  });

  it('GET capability reports unsupported by default, with a human-readable reason', async () => {
    const { owner, storeId } = await setup();
    const { body } = await getCapability(owner.jar, storeId);
    expect(body.data.supported).toBe(false);
    expect(body.data.reason).toMatch(/does not currently support/i);
  });

  it('GET capability reports supported once a connected connector implements pushProduct', async () => {
    const { owner, storeId } = await setup();
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'x', action: 'created' });
    const { body } = await getCapability(owner.jar, storeId);
    expect(body.data.supported).toBe(true);
    expect(body.data.provider).toBe('custom_api');
  });

  // 10. Successful real destination response produces pushed state.
  it('marks a product pushed only after the connector genuinely resolves with a destination ref', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'REAL-1');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest-abc', action: 'created' });

    const { body } = await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    expect(body.data.status).toBe('processed');
    expect(body.data.pushed).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('pushed');
    expect(product.pushDestinationRef).toBe('dest-abc');
    expect(product.lastPushedAt).not.toBeNull();
    expect(product.lastPushError).toBeNull();
  });

  // 8. Push does not report success when destination rejects the product.
  it('marks a product failed (never pushed) when the connector rejects it', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'REJECT-1');
    connectorRegistry.custom_api.pushProduct = async () => {
      throw new Error('Destination rejected: duplicate SKU');
    };

    const { body } = await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    expect(body.data.pushed).toBe(0);
    expect(body.data.failed).toBe(1);
    expect(body.data.results[0]).toMatchObject({ status: 'failed', error: 'Destination rejected: duplicate SKU' });

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('failed');
    expect(product.lastPushError).toBe('Destination rejected: duplicate SKU');
  });

  // 9. Push does not report success when destination cannot be verified.
  it('marks a product "unverifiable" (never pushed, never plain failed) when confirmation could not be obtained', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'UNVER-1');
    connectorRegistry.custom_api.pushProduct = async () => {
      throw new PushVerificationError('Timed out waiting for destination confirmation');
    };

    const { body } = await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    expect(body.data.pushed).toBe(0);
    expect(body.data.unverifiable).toBe(1);
    expect(body.data.results[0].status).toBe('unverifiable');

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('unverifiable');
  });

  // 21. Partial Push All results are correctly reported.
  it('reports a correct partial result when some products succeed and others fail', async () => {
    const { owner, storeId } = await setup();
    await createProduct(owner, storeId, 'PARTIAL-OK-1');
    await createProduct(owner, storeId, 'PARTIAL-BAD-1');
    await createProduct(owner, storeId, 'PARTIAL-OK-2');

    connectorRegistry.custom_api.pushProduct = async (product): Promise<PushProductResult> => {
      if (product.sku === 'PARTIAL-BAD-1') throw new Error('Destination validation failed');
      return { destinationRef: `dest-${product.sku}`, action: 'created' };
    };

    const { body } = await push(owner.jar, { storeId, mode: 'all' });
    expect(body.data.status).toBe('partial');
    expect(body.data.total).toBe(3);
    expect(body.data.pushed).toBe(2);
    expect(body.data.failed).toBe(1);
  });

  // 22. Failed products remain available for retry.
  it('lets a failed product be retried, and a successful retry clears the failure', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'RETRY-1');
    connectorRegistry.custom_api.pushProduct = async () => {
      throw new Error('temporary destination outage');
    };
    await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    let product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('failed');

    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest-retry', action: 'created' });
    const { body } = await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    expect(body.data.pushed).toBe(1);
    product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('pushed');
    expect(product.lastPushError).toBeNull();
  });

  // 11. Repeated push does not blindly create duplicate destination products — the plumbing is safe to call
  // twice, and passes the connector everything it needs (the product's own canonical sku) to dedupe itself.
  it('calling push twice on the same product is safe and reflects the connector\'s own create-then-update result', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'IDEMPOTENT-1');
    let calls = 0;
    connectorRegistry.custom_api.pushProduct = async (product): Promise<PushProductResult> => {
      calls++;
      expect(product.sku).toBe('IDEMPOTENT-1'); // the connector always gets the real canonical identity to dedupe by
      return { destinationRef: 'dest-stable-id', action: calls === 1 ? 'created' : 'updated' };
    };

    const first = await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    expect(first.body.data.results[0]).toMatchObject({ status: 'pushed', action: 'created' });

    const second = await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });
    expect(second.body.data.results[0]).toMatchObject({ status: 'pushed', action: 'updated' });

    expect(calls).toBe(2);
    // Nexora itself never created a second Product row for a repeat push.
    const rows = await prisma.product.findMany({ where: { storeId, sku: 'IDEMPOTENT-1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].pushDestinationRef).toBe('dest-stable-id');
  });

  // 12 & 13. Already-pushed products appear after unpushed products, and ordering changes after a push.
  it('orders unpushed products first and already-pushed products last, updating after a push', async () => {
    const { owner, storeId } = await setup();
    const a = await createProduct(owner, storeId, 'ORDER-A');
    const b = await createProduct(owner, storeId, 'ORDER-B');
    const c = await createProduct(owner, storeId, 'ORDER-C');
    await prisma.product.update({ where: { id: c }, data: { pushStatus: 'pushed', lastPushedAt: new Date() } });

    const { GET } = await import('@/app/api/products/route');
    const before = await (await GET(buildRequest(`/api/products?storeId=${storeId}`, { jar: owner.jar }))).json();
    const beforeIds = before.data.map((p: { id: string }) => p.id);
    expect(beforeIds.indexOf(a)).toBeLessThan(beforeIds.indexOf(c));
    expect(beforeIds.indexOf(b)).toBeLessThan(beforeIds.indexOf(c));

    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest-a', action: 'created' });
    await push(owner.jar, { storeId, mode: 'selected', productIds: [a] });

    const after = await (await GET(buildRequest(`/api/products?storeId=${storeId}`, { jar: owner.jar }))).json();
    const afterIds = after.data.map((p: { id: string }) => p.id);
    // a is now pushed too, so it must be at (or after) the same tier as c — specifically, b (still unpushed) must precede both.
    expect(afterIds.indexOf(b)).toBeLessThan(afterIds.indexOf(a));
    expect(afterIds.indexOf(b)).toBeLessThan(afterIds.indexOf(c));
  });

  // 4, 5, 6, 20. Store isolation: Push All only affects the selected store; Push Selected only pushes selected
  // ids; a cross-store id is never pushed under another store's identity.
  it('Push All only pushes the selected store\'s own products, never another store\'s', async () => {
    const { owner, storeId } = await setup();
    const storeB = await createStore(owner.jar, { name: 'Push Store B' });
    const storeBId = storeB.body.data.id as string;
    const integrationB = await createIntegration(owner.jar, { storeId: storeBId, provider: 'custom_api' });
    await connectIntegration(integrationB.body.data.integration.id);

    const aProduct = await createProduct(owner, storeId, 'ISO-A-1');
    const bProduct = await createProduct(owner, storeBId, 'ISO-B-1');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    await push(owner.jar, { storeId, mode: 'all' });

    const a = await prisma.product.findUniqueOrThrow({ where: { id: aProduct } });
    const b = await prisma.product.findUniqueOrThrow({ where: { id: bProduct } });
    expect(a.pushStatus).toBe('pushed');
    expect(b.pushStatus).toBe('not_pushed'); // untouched — different store
  });

  it('Push Selected pushes only the selected products, leaving unselected ones untouched', async () => {
    const { owner, storeId } = await setup();
    const selected = await createProduct(owner, storeId, 'SEL-1');
    const unselected = await createProduct(owner, storeId, 'SEL-2');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    await push(owner.jar, { storeId, mode: 'selected', productIds: [selected] });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: selected } })).pushStatus).toBe('pushed');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: unselected } })).pushStatus).toBe('not_pushed');
  });

  it('silently drops a cross-store product id from a "selected" push rather than pushing it', async () => {
    const { owner, storeId } = await setup();
    const storeB = await createStore(owner.jar, { name: 'Push Store B2' });
    const storeBId = storeB.body.data.id as string;
    const integrationB = await createIntegration(owner.jar, { storeId: storeBId, provider: 'custom_api' });
    await connectIntegration(integrationB.body.data.integration.id);
    const bProduct = await createProduct(owner, storeBId, 'CROSS-B-1');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });

    // Ask store A to push a product that actually belongs to store B.
    const { res } = await push(owner.jar, { storeId, mode: 'selected', productIds: [bProduct] });
    expect(res.status).toBe(422); // "No eligible products to push" — nothing in the request actually belonged to storeId

    const b = await prisma.product.findUniqueOrThrow({ where: { id: bProduct } });
    expect(b.pushStatus).toBe('not_pushed'); // never touched under the wrong store's push
  });

  // 7. Empty selection cannot push.
  it('rejects "selected" mode with an empty productIds array', async () => {
    const { owner, storeId } = await setup();
    const { res } = await push(owner.jar, { storeId, mode: 'selected', productIds: [] });
    expect(res.status).toBe(422);
  });

  // 17. Developer-owned dashboard CRUD restrictions remain intact — push is a dashboard write concern too.
  it('rejects push entirely for a developer_owned store', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { productMode: 'developer_owned' } }), {
      params: { id: storeId },
    });
    const { res } = await push(owner.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(403);
  });

  // Cross-org access is rejected the same way every other store-scoped route rejects it.
  it('rejects push for a store belonging to a different organization', async () => {
    const { storeId } = await setup();
    const other = await registerUser({ name: 'Other', email: 'push-other@example.com', password: 'password123', orgName: 'Push Other Org' });
    const { res } = await push(other.jar, { storeId, mode: 'all' });
    expect(res.status).toBe(404);
  });

  // 26. A completed push produces a real, correctly store-attributed notification.
  it('creates a store-attributed notification after a push completes', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'NOTIF-1');
    connectorRegistry.custom_api.pushProduct = async (): Promise<PushProductResult> => ({ destinationRef: 'dest', action: 'created' });
    await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });

    const notification = await prisma.notification.findFirstOrThrow({ where: { storeId, type: 'product.push' } });
    expect(notification.body).toContain('Push Store');
    expect(notification.severity).toBe('info');
  });

  it('creates a warning-severity notification when a push has failures', async () => {
    const { owner, storeId } = await setup();
    const productId = await createProduct(owner, storeId, 'NOTIF-FAIL-1');
    connectorRegistry.custom_api.pushProduct = async () => {
      throw new Error('nope');
    };
    await push(owner.jar, { storeId, mode: 'selected', productIds: [productId] });

    const notification = await prisma.notification.findFirstOrThrow({ where: { storeId, type: 'product.push' } });
    expect(notification.severity).toBe('warning');
  });

  // 14 & 15. Push default mode is persisted per store, and only one can ever be active.
  it('persists pushDefaultMode per store, independently of other stores', async () => {
    const { owner, storeId } = await setup();
    const storeB = await createStore(owner.jar, { name: 'Push Default Store B' });
    const storeBId = storeB.body.data.id as string;

    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { pushDefaultMode: 'push_all' } }), {
      params: { id: storeId },
    });
    await PATCH(buildRequest(`/api/stores/${storeBId}`, { method: 'PATCH', jar: owner.jar, body: { pushDefaultMode: 'push_selected' } }), {
      params: { id: storeBId },
    });

    const a = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const b = await prisma.store.findUniqueOrThrow({ where: { id: storeBId } });
    expect(a.pushDefaultMode).toBe('push_all');
    expect(b.pushDefaultMode).toBe('push_selected'); // unaffected by store A's setting
  });

  it('switching pushDefaultMode replaces the previous value — only one default is ever active', async () => {
    const { owner, storeId } = await setup();
    const { PATCH } = await import('@/app/api/stores/[id]/route');
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { pushDefaultMode: 'push_all' } }), {
      params: { id: storeId },
    });
    await PATCH(buildRequest(`/api/stores/${storeId}`, { method: 'PATCH', jar: owner.jar, body: { pushDefaultMode: 'push_selected' } }), {
      params: { id: storeId },
    });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.pushDefaultMode).toBe('push_selected');
  });

  it('defaults a newly created store\'s pushDefaultMode to "push" (opens options, never assumes a mode)', async () => {
    const owner = await registerUser({ name: 'Owner', email: 'push-default-owner@example.com', password: 'password123', orgName: 'Push Default Org' });
    const store = await createStore(owner.jar, { name: 'Fresh Store' });
    expect(store.body.data.pushDefaultMode).toBe('push');
  });
});
