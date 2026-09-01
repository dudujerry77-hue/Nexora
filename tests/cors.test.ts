import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildRequest, resetDb, registerUser, createStore, createIntegration } from './helpers';

// Regression coverage for the local-integration-test CORS allowlist added
// to /api/orders and /api/webhooks/orders (see src/lib/cors.ts). A real
// external store integration is server-to-server and never triggers CORS
// at all — this only covers the opt-in allowance for a browser-based local
// test page (e.g. VS Code "Live Server" on 127.0.0.1:5500 / localhost:5500).

const ALLOWED_ORIGIN = 'http://127.0.0.1:5500';
const ALLOWED_ORIGIN_ALT = 'http://localhost:5500';
const DISALLOWED_ORIGIN = 'http://evil.example.com';

function setNodeEnv(value: string) {
  Object.assign(process.env, { NODE_ENV: value });
}

describe('CORS on order-ingestion endpoints', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(resetDb);
  afterEach(() => {
    if (originalNodeEnv !== undefined) setNodeEnv(originalNodeEnv);
  });

  async function setupStoreWithApiKey() {
    const owner = await registerUser({ name: 'CORS Owner', email: 'cors-owner@example.com', password: 'password123', orgName: 'CORS Org' });
    const store = await createStore(owner.jar, { name: 'CORS Store' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_api' });
    return { storeId: store.body.data.id, apiKey: integration.body.data.apiKey as string };
  }

  it('answers an OPTIONS preflight from an allowed dev origin with matching CORS headers', async () => {
    setNodeEnv('development');
    const { OPTIONS } = await import('@/app/api/orders/route');
    const res = await OPTIONS(buildRequest('/api/orders', { method: 'OPTIONS', headers: { origin: ALLOWED_ORIGIN } }));

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('answers an OPTIONS preflight from the alternate allowed dev origin (localhost:5500)', async () => {
    setNodeEnv('development');
    const { OPTIONS } = await import('@/app/api/orders/route');
    const res = await OPTIONS(buildRequest('/api/orders', { method: 'OPTIONS', headers: { origin: ALLOWED_ORIGIN_ALT } }));

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN_ALT);
  });

  it('does not grant CORS headers to an origin outside the dev allowlist', async () => {
    setNodeEnv('development');
    const { OPTIONS } = await import('@/app/api/orders/route');
    const res = await OPTIONS(buildRequest('/api/orders', { method: 'OPTIONS', headers: { origin: DISALLOWED_ORIGIN } }));

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never grants CORS headers in production, even for an allowlisted origin', async () => {
    setNodeEnv('production');
    const { OPTIONS } = await import('@/app/api/orders/route');
    const res = await OPTIONS(buildRequest('/api/orders', { method: 'OPTIONS', headers: { origin: ALLOWED_ORIGIN } }));

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('reflects the allowed origin on a real cross-origin POST /api/orders and still requires a valid API key', async () => {
    setNodeEnv('development');
    const { storeId, apiKey } = await setupStoreWithApiKey();
    const { POST } = await import('@/app/api/orders/route');

    const res = await POST(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, authorization: `Bearer ${apiKey}` },
        body: {
          storeId,
          externalId: 'ORD-CORS-1',
          customer: { name: 'Test Buyer' },
          items: [{ name: 'Widget', quantity: 1, price: 1000 }],
          total: 1000,
          currency: 'NGN',
        },
      }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });

  it('still rejects a cross-origin POST with a missing/invalid API key (CORS does not bypass auth)', async () => {
    setNodeEnv('development');
    const { storeId } = await setupStoreWithApiKey();
    const { POST } = await import('@/app/api/orders/route');

    const res = await POST(
      buildRequest('/api/orders', {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, authorization: 'Bearer nx_live_invalidkey' },
        body: {
          storeId,
          externalId: 'ORD-CORS-2',
          customer: { name: 'Test Buyer' },
          items: [{ name: 'Widget', quantity: 1, price: 1000 }],
          total: 1000,
          currency: 'NGN',
        },
      }),
    );

    expect(res.status).toBe(401);
    // Even a rejected request from an allowed dev origin still carries the
    // CORS header, so the browser can read the 401 error body/status
    // instead of reporting an opaque network failure.
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });

  it('answers an OPTIONS preflight for /api/webhooks/orders from an allowed dev origin', async () => {
    setNodeEnv('development');
    const { OPTIONS } = await import('@/app/api/webhooks/orders/route');
    const res = await OPTIONS(buildRequest('/api/webhooks/orders', { method: 'OPTIONS', headers: { origin: ALLOWED_ORIGIN } }));

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });
});
