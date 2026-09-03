import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { verifyWebhookSignature } from '@/lib/webhookSignature';
import { resetDb, registerUser, createStore, createIntegration, connectIntegration, buildRequest } from './helpers';

// These tests exercise the real custom_webhook outbound connector
// (src/lib/connectors/nexoraNative.ts pushProductViaCustomWebhook) against
// an actual local HTTP server on a real loopback socket — a genuine network
// round trip, not a mocked fetch — so a push can only be reported "pushed"
// here if this test server actually received a validly-signed request and
// responded with a real confirmation.

interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}

function startTestServer(
  handler: (req: CapturedRequest) => { status: number; body?: unknown; headers?: Record<string, string> } | 'timeout',
) {
  const captured: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      captured.push({ headers: req.headers, rawBody });
      const result = handler({ headers: req.headers, rawBody });
      if (result === 'timeout') return; // never respond — the client-side AbortSignal.timeout will fire
      res.writeHead(result.status, { 'content-type': 'application/json', ...result.headers });
      res.end(result.body !== undefined ? JSON.stringify(result.body) : undefined);
    });
  });
  return new Promise<{ url: string; captured: CapturedRequest[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/nexora/products`,
        captured,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function setup() {
  const owner = await registerUser({ name: 'Owner', email: 'outbound-owner@example.com', password: 'password123', orgName: 'Outbound Org' });
  const store = await createStore(owner.jar, { name: 'Outbound Store' });
  const storeId = store.body.data.id as string;
  const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_webhook' });
  const integrationId = integration.body.data.integration.id as string;
  await connectIntegration(integrationId);
  return { owner, storeId, integrationId };
}

async function configureOutbound(owner: { jar: { session?: string; csrf?: string } }, integrationId: string, url: string | null) {
  const { PATCH } = await import('@/app/api/integrations/[id]/route');
  const res = await PATCH(buildRequest(`/api/integrations/${integrationId}`, { method: 'PATCH', jar: owner.jar, body: { outboundWebhookUrl: url } }), {
    params: { id: integrationId },
  });
  const body = await res.json();
  return { res, body };
}

async function createProduct(owner: { jar: { session?: string; csrf?: string } }, storeId: string, sku: string) {
  const { POST } = await import('@/app/api/products/route');
  const res = await POST(buildRequest('/api/products', { method: 'POST', jar: owner.jar, body: { storeId, sku, name: sku, price: 1000 } }));
  const body = await res.json();
  return body.data.id as string;
}

async function push(owner: { jar: { session?: string; csrf?: string } }, storeId: string, productIds: string[]) {
  const { POST } = await import('@/app/api/products/push/route');
  const res = await POST(buildRequest('/api/products/push', { method: 'POST', jar: owner.jar, body: { storeId, mode: 'selected', productIds } }));
  return res.json();
}

describe('real outbound webhook push connector (Phase 2)', () => {
  let servers: { close: () => Promise<void> }[] = [];

  beforeEach(async () => {
    await resetDb();
    servers = [];
  });
  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('reports capability as unsupported before an outbound URL is configured', async () => {
    const { owner, storeId } = await setup();
    const { GET } = await import('@/app/api/products/push/route');
    const res = await GET(buildRequest(`/api/products/push?storeId=${storeId}`, { jar: owner.jar }));
    const body = await res.json();
    expect(body.data.supported).toBe(false);
    expect(body.data.reason).toMatch(/isn't configured/i);
  });

  it('sends a genuinely signed real HTTP request and marks the product pushed only on a real 2xx confirmation', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => ({ status: 200, body: { status: 'ok', action: 'created', productRef: 'remote-123' } }));
    servers.push(server);

    const configured = await configureOutbound(owner, integrationId, server.url);
    expect(configured.res.status).toBe(200);
    const secret = configured.body.data.outboundWebhookSecret as string;
    expect(secret).toBeTruthy();

    const productId = await createProduct(owner, storeId, 'REAL-WEBHOOK-1');
    const result = await push(owner, storeId, [productId]);

    expect(result.data.status).toBe('processed');
    expect(result.data.pushed).toBe(1);
    expect(result.data.results[0]).toMatchObject({ status: 'pushed', action: 'created' });

    // The request that actually landed on the real server was validly signed
    // with the secret this integration was just given — proving Nexora
    // really called out over the network with real credentials, not a fake.
    expect(server.captured).toHaveLength(1);
    const received = server.captured[0];
    const verification = verifyWebhookSignature({
      secret,
      timestampHeader: received.headers['x-nexora-timestamp'] as string,
      signatureHeader: received.headers['x-nexora-signature'] as string,
      rawBody: received.rawBody,
    });
    expect(verification.valid).toBe(true);
    const sentPayload = JSON.parse(received.rawBody);
    expect(sentPayload.data.sku).toBe('REAL-WEBHOOK-1');

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('pushed');
    expect(product.pushDestinationRef).toBe('remote-123');
  });

  it('reports failed (never pushed) when the destination responds with a non-2xx rejection', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => ({ status: 422, body: { error: 'SKU already exists with conflicting data' } }));
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);
    const productId = await createProduct(owner, storeId, 'REJECTED-1');

    const result = await push(owner, storeId, [productId]);
    expect(result.data.pushed).toBe(0);
    expect(result.data.failed).toBe(1);
    expect(result.data.results[0]).toMatchObject({ status: 'failed', error: 'SKU already exists with conflicting data' });

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('failed');
  });

  it('never follows a redirect toward a blocked/private destination — a 3xx is reported failed, not chased', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => ({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      body: { status: 'ok', action: 'created' }, // even if the body looked like success, a 3xx must never be treated as one
    }));
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);
    const productId = await createProduct(owner, storeId, 'REDIRECT-1');

    const result = await push(owner, storeId, [productId]);
    // Exactly one request ever reached the real server — proving the 302's
    // Location header was never dereferenced into a second request at all
    // (this codebase's outbound transport is Node's raw http/https client,
    // which — unlike fetch — never auto-follows redirects; see
    // src/lib/ssrfSafeFetch.ts sendSafeRequest).
    expect(server.captured).toHaveLength(1);
    expect(result.data.pushed).toBe(0);
    expect(result.data.failed).toBe(1);
    expect(result.data.results[0].status).toBe('failed');

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('failed');
  });

  it('reports unverifiable (never pushed, never plain failed) when the destination never responds', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => 'timeout');
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);
    const productId = await createProduct(owner, storeId, 'TIMEOUT-1');

    const result = await push(owner, storeId, [productId]);
    expect(result.data.pushed).toBe(0);
    expect(result.data.unverifiable).toBe(1);
    expect(result.data.results[0].status).toBe('unverifiable');

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.pushStatus).toBe('unverifiable');
  });

  it('reports unverifiable when the destination confirms status "ok" but omits the required action field', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => ({ status: 200, body: { status: 'ok' } }));
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);
    const productId = await createProduct(owner, storeId, 'NOACTION-1');

    const result = await push(owner, storeId, [productId]);
    expect(result.data.unverifiable).toBe(1);
    expect(result.data.results[0].status).toBe('unverifiable');
  });

  it('rejects a signature computed with the wrong secret (proves the destination-side verification path is real)', async () => {
    const { owner, storeId, integrationId } = await setup();
    let sawInvalidSignature = false;
    const server = await startTestServer((req) => {
      const verification = verifyWebhookSignature({
        secret: 'wrong-secret-the-destination-does-not-actually-have',
        timestampHeader: req.headers['x-nexora-timestamp'] as string,
        signatureHeader: req.headers['x-nexora-signature'] as string,
        rawBody: req.rawBody,
      });
      sawInvalidSignature = !verification.valid;
      return { status: 200, body: { status: 'ok', action: 'created' } };
    });
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);
    const productId = await createProduct(owner, storeId, 'SIGCHECK-1');

    await push(owner, storeId, [productId]);
    // Confirms the outbound request really is signed with the integration's
    // own real secret (not a shared/hardcoded one) — a receiving server
    // checking against a different secret genuinely fails verification.
    expect(sawInvalidSignature).toBe(true);
  });

  it('clearing the outbound URL makes the store report unsupported again and stops sending pushes', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => ({ status: 200, body: { status: 'ok', action: 'created' } }));
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);
    await configureOutbound(owner, integrationId, null);

    const { GET } = await import('@/app/api/products/push/route');
    const capRes = await GET(buildRequest(`/api/products/push?storeId=${storeId}`, { jar: owner.jar }));
    expect((await capRes.json()).data.supported).toBe(false);

    const productId = await createProduct(owner, storeId, 'CLEARED-1');
    const result = await push(owner, storeId, [productId]);
    expect(result.data.status).toBe('unsupported');
    expect(server.captured).toHaveLength(0);
  });

  it('never returns the outbound webhook secret ciphertext (or plaintext) from GET /api/integrations/:id', async () => {
    const { owner, storeId, integrationId } = await setup();
    const server = await startTestServer(() => ({ status: 200, body: { status: 'ok', action: 'created' } }));
    servers.push(server);
    await configureOutbound(owner, integrationId, server.url);

    const { GET } = await import('@/app/api/integrations/[id]/route');
    const res = await GET(buildRequest(`/api/integrations/${integrationId}`, { jar: owner.jar }), { params: { id: integrationId } });
    const body = await res.json();
    expect(body.data.outboundWebhookUrl).toBe(server.url);
    expect(body.data.outboundWebhookSecretCiphertext).toBeUndefined();
    expect(JSON.stringify(body.data)).not.toMatch(/whsec_/);
    void storeId;
  });

  it('rejects configuring an outbound webhook on a non-custom_webhook provider', async () => {
    const owner = await registerUser({ name: 'Owner', email: 'outbound-wrong-provider@example.com', password: 'password123', orgName: 'Wrong Provider Org' });
    const store = await createStore(owner.jar, { name: 'API Store' });
    const storeId = store.body.data.id as string;
    const integration = await createIntegration(owner.jar, { storeId, provider: 'custom_api' });
    const integrationId = integration.body.data.integration.id as string;

    const { res } = await configureOutbound(owner, integrationId, 'https://example.com/hook');
    expect(res.status).toBe(422);
  });

  it('rejects a non-http(s) outbound URL', async () => {
    const { owner, integrationId } = await setup();
    const { res } = await configureOutbound(owner, integrationId, 'javascript:alert(1)');
    expect(res.status).toBe(422);
  });
});
