import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb, registerUser, createStore, buildRequest } from './helpers';

describe('reports', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await registerUser({ name: 'Reporter', email: 'reporter@example.com', password: 'password123', orgName: 'Reports Org' });
    const store = await createStore(owner.jar, { name: 'Reports Store' });
    return { owner, storeId: store.body.data.id as string };
  }

  it('creates a bug report with a valid category and returns it', async () => {
    const { owner, storeId } = await setup();
    const { POST } = await import('@/app/api/reports/route');
    const res = await POST(
      buildRequest('/api/reports', {
        method: 'POST',
        jar: owner.jar,
        body: {
          type: 'bug',
          category: 'responsive_issue',
          title: 'Sidebar overflows on mobile',
          description: 'Drawer content overflows at 320px.',
          severity: 'high',
          storeId,
          diagnostics: { route: '/dashboard', viewportWidth: 320, viewportHeight: 812 },
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.type).toBe('bug');
    expect(body.data.category).toBe('responsive_issue');
    expect(body.data.status).toBe('open');
    expect(body.data.diagnostics.viewportWidth).toBe(320);
    expect(body.data.store.id).toBe(storeId);
  });

  it('rejects a category that does not belong to the given report type', async () => {
    const { owner } = await setup();
    const { POST } = await import('@/app/api/reports/route');
    const res = await POST(
      buildRequest('/api/reports', {
        method: 'POST',
        jar: owner.jar,
        body: { type: 'bug', category: 'feature_request', title: 'x', description: 'y' },
      }),
    );
    expect(res.status).toBe(422);
  });

  it('strips unknown/sensitive keys out of diagnostics instead of storing them', async () => {
    const { owner } = await setup();
    const { POST } = await import('@/app/api/reports/route');
    const res = await POST(
      buildRequest('/api/reports', {
        method: 'POST',
        jar: owner.jar,
        body: {
          type: 'crash',
          category: 'blank_screen',
          title: 'Blank dashboard',
          description: 'Nothing renders.',
          diagnostics: {
            route: '/dashboard',
            apiKey: 'nx_live_shouldnotbestored',
            webhookSecret: 'whsec_shouldnotbestored',
            password: 'hunter2',
            sessionToken: 'abc.def.ghi',
          },
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.diagnostics).not.toHaveProperty('apiKey');
    expect(body.data.diagnostics).not.toHaveProperty('webhookSecret');
    expect(body.data.diagnostics).not.toHaveProperty('password');
    expect(body.data.diagnostics).not.toHaveProperty('sessionToken');
    expect(body.data.diagnostics.route).toBe('/dashboard');

    const stored = await prisma.report.findUnique({ where: { id: body.data.id } });
    expect(stored?.diagnostics).not.toMatch(/nx_live_|whsec_|hunter2/);
  });

  it('creates a user report without requiring a store', async () => {
    const { owner } = await setup();
    const { POST } = await import('@/app/api/reports/route');
    const res = await POST(
      buildRequest('/api/reports', {
        method: 'POST',
        jar: owner.jar,
        body: { type: 'user', category: 'feedback', title: 'Love the dashboard', description: 'Just saying thanks.' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.store).toBeNull();
  });

  it('rejects a storeId belonging to a different organization', async () => {
    const { owner } = await setup();
    const other = await registerUser({ name: 'Other', email: 'other-org@example.com', password: 'password123', orgName: 'Other Org' });
    const otherStore = await createStore(other.jar, { name: 'Other Store' });

    const { POST } = await import('@/app/api/reports/route');
    const res = await POST(
      buildRequest('/api/reports', {
        method: 'POST',
        jar: owner.jar,
        body: { type: 'bug', category: 'other', title: 'x', description: 'y', storeId: otherStore.body.data.id },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('lists reports scoped to the caller organization, filtered by type', async () => {
    const { owner } = await setup();
    const { POST, GET } = await import('@/app/api/reports/route');
    await POST(buildRequest('/api/reports', { method: 'POST', jar: owner.jar, body: { type: 'bug', category: 'other', title: 'Bug 1', description: 'd' } }));
    await POST(buildRequest('/api/reports', { method: 'POST', jar: owner.jar, body: { type: 'crash', category: 'other', title: 'Crash 1', description: 'd' } }));

    const res = await GET(buildRequest('/api/reports?type=bug', { jar: owner.jar }));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe('Bug 1');
  });

  it('gets a single report by id, scoped to the caller organization', async () => {
    const { owner } = await setup();
    const other = await registerUser({ name: 'Other2', email: 'other-org-2@example.com', password: 'password123', orgName: 'Other Org 2' });

    const { POST } = await import('@/app/api/reports/route');
    const createRes = await POST(
      buildRequest('/api/reports', { method: 'POST', jar: owner.jar, body: { type: 'user', category: 'question', title: 'Q', description: 'd' } }),
    );
    const created = await createRes.json();

    const { GET } = await import('@/app/api/reports/[id]/route');
    const ownRes = await GET(buildRequest(`/api/reports/${created.data.id}`, { jar: owner.jar }), { params: { id: created.data.id } });
    expect(ownRes.status).toBe(200);

    const otherRes = await GET(buildRequest(`/api/reports/${created.data.id}`, { jar: other.jar }), { params: { id: created.data.id } });
    expect(otherRes.status).toBe(404);
  });

  it('rejects a mutating report request without a matching CSRF token', async () => {
    const { owner } = await setup();
    const { POST } = await import('@/app/api/reports/route');
    const res = await POST(
      buildRequest('/api/reports', {
        method: 'POST',
        jar: { session: owner.jar.session },
        body: { type: 'bug', category: 'other', title: 'x', description: 'y' },
      }),
    );
    expect(res.status).toBe(403);
  });
});
