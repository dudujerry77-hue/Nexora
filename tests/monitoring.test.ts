import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb, registerUser, createStore, createIntegration, buildRequest } from './helpers';

describe('monitoring', () => {
  beforeEach(resetDb);

  async function setupStoreWithPublicKey() {
    const owner = await registerUser({ name: 'Mon Owner', email: 'mon-owner@example.com', password: 'password123', orgName: 'Mon Org' });
    const store = await createStore(owner.jar, { name: 'Mon Store' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'js_sdk' });
    return { owner, storeId: store.body.data.id as string, publicKey: integration.body.data.apiKey as string };
  }

  async function postEvent(publicKey: string, body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/monitoring/events/route');
    return POST(
      new Request('http://localhost:3000/api/monitoring/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${publicKey}` },
        body: JSON.stringify(body),
      }) as unknown as Parameters<typeof POST>[0],
    );
  }

  it('creates a new issue from a public-key event and returns 201', async () => {
    const { storeId, publicKey } = await setupStoreWithPublicKey();
    const res = await postEvent(publicKey, { type: 'js_error', message: 'Cannot read properties of undefined' });
    expect(res.status).toBe(201);

    const issues = await prisma.monitoringIssue.findMany({ where: { storeId } });
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrenceCount).toBe(1);
    expect(issues[0].status).toBe('unresolved');
  });

  it('deduplicates repeat occurrences of the same error into one issue', async () => {
    const { storeId, publicKey } = await setupStoreWithPublicKey();
    await postEvent(publicKey, { type: 'js_error', message: 'Cannot read properties of undefined (reading foo)' });
    await postEvent(publicKey, { type: 'js_error', message: 'Cannot read properties of undefined (reading foo)' });
    await postEvent(publicKey, { type: 'js_error', message: 'Cannot read properties of undefined (reading foo)' });

    const issues = await prisma.monitoringIssue.findMany({ where: { storeId } });
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrenceCount).toBe(3);

    const events = await prisma.monitoringEvent.findMany({ where: { issueId: issues[0].id } });
    expect(events).toHaveLength(3);
  });

  it('collapses errors that differ only by an interpolated number/id into one issue', async () => {
    const { storeId, publicKey } = await setupStoreWithPublicKey();
    await postEvent(publicKey, { type: 'network_error', message: 'GET /api/orders/123 failed', statusCode: 500 });
    await postEvent(publicKey, { type: 'network_error', message: 'GET /api/orders/456 failed', statusCode: 500 });

    const issues = await prisma.monitoringIssue.findMany({ where: { storeId } });
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrenceCount).toBe(2);
  });

  it('creates separate issues for genuinely different errors', async () => {
    const { storeId, publicKey } = await setupStoreWithPublicKey();
    await postEvent(publicKey, { type: 'js_error', message: 'TypeError: x is not a function' });
    await postEvent(publicKey, { type: 'network_error', message: 'GET /api/orders failed', statusCode: 500 });

    const issues = await prisma.monitoringIssue.findMany({ where: { storeId } });
    expect(issues).toHaveLength(2);
  });

  it('strips unknown/sensitive keys out of diagnostics instead of storing them', async () => {
    const { publicKey } = await setupStoreWithPublicKey();
    const res = await postEvent(publicKey, {
      type: 'crash',
      message: 'App crashed',
      diagnostics: {
        userAgent: 'test-agent',
        apiKey: 'nx_live_shouldnotbestored',
        password: 'hunter2',
        sessionToken: 'abc.def.ghi',
      },
    });
    expect(res.status).toBe(201);

    const issue = await prisma.monitoringIssue.findFirstOrThrow();
    expect(issue.lastBrowser).toBe('test-agent');

    const event = await prisma.monitoringEvent.findFirstOrThrow({ where: { issueId: issue.id } });
    expect(event.diagnostics).not.toMatch(/nx_live_|hunter2|sessionToken/);
  });

  it('lists issues scoped to the store and status filter', async () => {
    const { owner, storeId, publicKey } = await setupStoreWithPublicKey();
    await postEvent(publicKey, { type: 'js_error', message: 'Error A' });
    const res2 = await postEvent(publicKey, { type: 'js_error', message: 'Error B' });
    const created = await res2.json();

    const { PATCH } = await import('@/app/api/monitoring/issues/[id]/route');
    await PATCH(
      buildRequest(`/api/monitoring/issues/${created.data.issueId}`, { method: 'PATCH', jar: owner.jar, body: { status: 'resolved' } }),
      { params: { id: created.data.issueId } },
    );

    const { GET } = await import('@/app/api/monitoring/issues/route');
    const unresolvedRes = await GET(buildRequest(`/api/monitoring/issues?storeId=${storeId}&status=unresolved`, { jar: owner.jar }));
    const unresolvedBody = await unresolvedRes.json();
    expect(unresolvedBody.data).toHaveLength(1);
    expect(unresolvedBody.data[0].message).toBe('Error A');

    const allRes = await GET(buildRequest(`/api/monitoring/issues?storeId=${storeId}&status=all`, { jar: owner.jar }));
    const allBody = await allRes.json();
    expect(allBody.data).toHaveLength(2);
  });

  it('returns issue detail with recent raw events', async () => {
    const { owner, publicKey } = await setupStoreWithPublicKey();
    const createRes = await postEvent(publicKey, { type: 'js_error', message: 'Detail test error' });
    const created = await createRes.json();

    const { GET } = await import('@/app/api/monitoring/issues/[id]/route');
    const res = await GET(buildRequest(`/api/monitoring/issues/${created.data.issueId}`, { jar: owner.jar }), {
      params: { id: created.data.issueId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].message).toBe('Detail test error');
  });

  it('reopens a resolved issue when a new occurrence arrives (regression)', async () => {
    const { owner, publicKey } = await setupStoreWithPublicKey();
    const createRes = await postEvent(publicKey, { type: 'crash', message: 'Fatal crash' });
    const created = await createRes.json();

    const { PATCH } = await import('@/app/api/monitoring/issues/[id]/route');
    await PATCH(buildRequest(`/api/monitoring/issues/${created.data.issueId}`, { method: 'PATCH', jar: owner.jar, body: { status: 'resolved' } }), {
      params: { id: created.data.issueId },
    });

    await postEvent(publicKey, { type: 'crash', message: 'Fatal crash' });

    const issue = await prisma.monitoringIssue.findUniqueOrThrow({ where: { id: created.data.issueId } });
    expect(issue.status).toBe('unresolved');
    expect(issue.occurrenceCount).toBe(2);
  });

  it('rejects a resolve request without a matching CSRF token', async () => {
    const { owner, publicKey } = await setupStoreWithPublicKey();
    const createRes = await postEvent(publicKey, { type: 'js_error', message: 'CSRF test error' });
    const created = await createRes.json();

    const { PATCH } = await import('@/app/api/monitoring/issues/[id]/route');
    const res = await PATCH(
      buildRequest(`/api/monitoring/issues/${created.data.issueId}`, { method: 'PATCH', jar: { session: owner.jar.session }, body: { status: 'resolved' } }),
      { params: { id: created.data.issueId } },
    );
    expect(res.status).toBe(403);
  });

  it('keeps issues isolated between organizations', async () => {
    const { publicKey } = await setupStoreWithPublicKey();
    const createRes = await postEvent(publicKey, { type: 'js_error', message: 'Org isolation test' });
    const created = await createRes.json();

    const other = await registerUser({ name: 'Other', email: 'mon-other@example.com', password: 'password123', orgName: 'Other Mon Org' });
    const { GET } = await import('@/app/api/monitoring/issues/[id]/route');
    const res = await GET(buildRequest(`/api/monitoring/issues/${created.data.issueId}`, { jar: other.jar }), {
      params: { id: created.data.issueId },
    });
    expect(res.status).toBe(404);
  });

  it('also accepts a secret API key (server-side reporting), not just a public key', async () => {
    const owner = await registerUser({ name: 'Server Owner', email: 'server-owner@example.com', password: 'password123', orgName: 'Server Org' });
    const store = await createStore(owner.jar, { name: 'Server Store' });
    const integration = await createIntegration(owner.jar, { storeId: store.body.data.id, provider: 'custom_api' });

    const res = await postEvent(integration.body.data.apiKey, { type: 'network_error', message: 'Upstream payment API timed out', statusCode: 504 });
    expect(res.status).toBe(201);
  });
});
