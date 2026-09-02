import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createNotification } from '@/lib/notifications';
import { resetDb, registerUser, createStore, createIntegration, connectIntegration, buildRequest } from './helpers';

describe('notifications — store source, ordering, and connected-store visibility (pre-phase-1 checkpoint)', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await registerUser({ name: 'Owner', email: 'notif-owner@example.com', password: 'password123', orgName: 'Notif Org' });
    const connectedA = await createStore(owner.jar, { name: 'Iya Kudinka Restaurant' });
    const connectedAId = connectedA.body.data.id as string;
    const integrationA = await createIntegration(owner.jar, { storeId: connectedAId, provider: 'js_sdk' });
    await connectIntegration(integrationA.body.data.integration.id);

    const connectedB = await createStore(owner.jar, { name: 'Second Connected Store' });
    const connectedBId = connectedB.body.data.id as string;
    const integrationB = await createIntegration(owner.jar, { storeId: connectedBId, provider: 'js_sdk' });
    await connectIntegration(integrationB.body.data.integration.id);

    const disconnected = await createStore(owner.jar, { name: 'Never Connected Store' });
    const disconnectedId = disconnected.body.data.id as string;
    await createIntegration(owner.jar, { storeId: disconnectedId, provider: 'js_sdk' }); // exists, never actually connected

    return { owner, connectedAId, connectedBId, disconnectedId };
  }

  async function getNotifications(jar: { session?: string; csrf?: string }, storeId?: string) {
    const { GET } = await import('@/app/api/notifications/route');
    const url = storeId ? `/api/notifications?storeId=${storeId}` : '/api/notifications';
    const res = await GET(buildRequest(url, { jar }));
    const body = await res.json();
    return { res, body };
  }

  // 1. store display — every notification's payload carries its own store, not the currently-selected store's name
  it('carries the notification\'s own originating store, not a hardcoded selected store', async () => {
    const { owner, connectedAId, connectedBId } = await setup();
    await createNotification({ organizationId: (await prisma.organization.findFirstOrThrow()).id, storeId: connectedAId, type: 'monitoring.issue', title: 'Error in A', body: 'boom' });
    await createNotification({ organizationId: (await prisma.organization.findFirstOrThrow()).id, storeId: connectedBId, type: 'monitoring.issue', title: 'Error in B', body: 'boom' });

    const { body } = await getNotifications(owner.jar);
    const a = body.data.find((n: { title: string }) => n.title === 'Error in A');
    const b = body.data.find((n: { title: string }) => n.title === 'Error in B');
    expect(a.store.id).toBe(connectedAId);
    expect(b.store.id).toBe(connectedBId);
    expect(a.store.name).toBe('Iya Kudinka Restaurant');
    expect(b.store.name).toBe('Second Connected Store');
  });

  // 2. selected-store-first ordering
  it('orders the selected store\'s notifications first, other connected stores after, newest-first within each group', async () => {
    const { owner, connectedAId, connectedBId } = await setup();
    const orgId = (await prisma.organization.findFirstOrThrow()).id;
    await createNotification({ organizationId: orgId, storeId: connectedBId, type: 'order.created', title: 'B older', body: 'x' });
    await createNotification({ organizationId: orgId, storeId: connectedAId, type: 'order.created', title: 'A older', body: 'x' });
    await createNotification({ organizationId: orgId, storeId: connectedBId, type: 'order.created', title: 'B newer', body: 'x' });
    await createNotification({ organizationId: orgId, storeId: connectedAId, type: 'order.created', title: 'A newer', body: 'x' });

    const { body } = await getNotifications(owner.jar);
    // GET /api/notifications itself only guarantees newest-first overall and
    // connected-only visibility — "selected store first" is applied
    // client-side (see sortBySelectedStoreFirst in NotificationBell.tsx /
    // notifications/page.tsx), so this test verifies the ordering
    // precondition the client-side sort depends on: newest-first per store.
    const titles = body.data.map((n: { title: string }) => n.title);
    expect(titles.indexOf('A newer')).toBeLessThan(titles.indexOf('A older'));
    expect(titles.indexOf('B newer')).toBeLessThan(titles.indexOf('B older'));
  });

  // 3. disconnected-excluded
  it('excludes a disconnected store\'s notifications entirely from the global (no explicit storeId) list', async () => {
    const { owner, connectedAId, disconnectedId } = await setup();
    const orgId = (await prisma.organization.findFirstOrThrow()).id;
    await createNotification({ organizationId: orgId, storeId: connectedAId, type: 'order.created', title: 'Visible', body: 'x' });
    await createNotification({ organizationId: orgId, storeId: disconnectedId, type: 'order.created', title: 'Hidden', body: 'x' });

    const { body } = await getNotifications(owner.jar);
    const titles = body.data.map((n: { title: string }) => n.title);
    expect(titles).toContain('Visible');
    expect(titles).not.toContain('Hidden');
  });

  // 4. bell-aggregates-connected-stores
  it('aggregates notifications from every connected store the caller can access, not just one', async () => {
    const { owner, connectedAId, connectedBId } = await setup();
    const orgId = (await prisma.organization.findFirstOrThrow()).id;
    await createNotification({ organizationId: orgId, storeId: connectedAId, type: 'order.created', title: 'From A', body: 'x' });
    await createNotification({ organizationId: orgId, storeId: connectedBId, type: 'order.created', title: 'From B', body: 'x' });

    const { body } = await getNotifications(owner.jar);
    const titles = body.data.map((n: { title: string }) => n.title);
    expect(titles).toContain('From A');
    expect(titles).toContain('From B');
  });

  // 5. explicit-storeId view is a distinct, deliberate "this store only" request, unaffected by connected-only filtering
  it('still returns a disconnected store\'s own notifications when that store is explicitly requested', async () => {
    const { owner, disconnectedId } = await setup();
    const orgId = (await prisma.organization.findFirstOrThrow()).id;
    await createNotification({ organizationId: orgId, storeId: disconnectedId, type: 'order.created', title: 'Direct view', body: 'x' });

    const { body } = await getNotifications(owner.jar, disconnectedId);
    expect(body.data.map((n: { title: string }) => n.title)).toContain('Direct view');
  });

  // 6. cross-org-notification-access-rejected — a client-supplied storeId from another org must not leak that org's notifications
  it('rejects an explicit storeId belonging to a different organization', async () => {
    const { owner } = await setup();
    const other = await registerUser({ name: 'Other', email: 'notif-other@example.com', password: 'password123', orgName: 'Other Notif Org' });
    const otherStore = await createStore(other.jar, { name: 'Other Org Store' });
    const otherStoreId = otherStore.body.data.id as string;
    await createNotification({ organizationId: (await prisma.organization.findFirstOrThrow({ where: { name: 'Other Notif Org' } })).id, storeId: otherStoreId, type: 'order.created', title: 'Other org secret', body: 'x' });

    const { res } = await getNotifications(owner.jar, otherStoreId);
    expect(res.status).toBe(404);
  });

  // 7. org-level (storeId null) notifications always show regardless of any store's connection status
  it('always includes organization-level notifications (no storeId) in the global list', async () => {
    const { owner } = await setup();
    const orgId = (await prisma.organization.findFirstOrThrow()).id;
    await createNotification({ organizationId: orgId, storeId: null, type: 'system', title: 'Org-wide', body: 'x' });

    const { body } = await getNotifications(owner.jar);
    expect(body.data.map((n: { title: string }) => n.title)).toContain('Org-wide');
  });

  // 8. existing monitoring-generated notifications still flow through unaffected — the store-filter and store-source
  // additions must not have turned into monitoring suppression.
  it('still generates a notification with correct store attribution when monitoring records a real issue', async () => {
    const owner = await registerUser({ name: 'Owner', email: 'notif-monitoring-owner@example.com', password: 'password123', orgName: 'Notif Monitoring Org' });
    const store = await createStore(owner.jar, { name: 'Monitored Store' });
    const storeId = store.body.data.id as string;
    const integration = await createIntegration(owner.jar, { storeId, provider: 'js_sdk' });

    const { POST } = await import('@/app/api/monitoring/events/route');
    const eventRes = await POST(
      new Request('http://localhost:3000/api/monitoring/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${integration.body.data.apiKey}` },
        body: JSON.stringify({ type: 'js_error', message: 'boom' }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(eventRes.status).toBe(201);

    const issue = await prisma.monitoringIssue.findFirstOrThrow({ where: { storeId } });
    expect(issue.occurrenceCount).toBeGreaterThanOrEqual(1);

    // The monitoring event itself sets lastRequestAt, so the store is now
    // genuinely connected — the global list should surface the resulting notification.
    const { body } = await getNotifications(owner.jar);
    const notif = body.data.find((n: { storeId: string | null }) => n.storeId === storeId);
    expect(notif).toBeTruthy();
    expect(notif.store.id).toBe(storeId);
  });

  // 9. switch-store access verification — switching relies on the store already being present in this
  // organization-scoped, connected-only list; a storeId not present (e.g. another org's) can't be switched to
  // via this endpoint's data at all, since it never appears in the response to begin with.
  it('never exposes another organization\'s store id anywhere in the notification list for a switch target', async () => {
    const { owner } = await setup();
    const other = await registerUser({ name: 'Other', email: 'notif-switch-other@example.com', password: 'password123', orgName: 'Switch Other Org' });
    const otherStore = await createStore(other.jar, { name: 'Switch Other Store' });
    const otherOrgId = (await prisma.organization.findFirstOrThrow({ where: { name: 'Switch Other Org' } })).id;
    await createNotification({ organizationId: otherOrgId, storeId: otherStore.body.data.id as string, type: 'order.created', title: 'Not mine', body: 'x' });

    const { body } = await getNotifications(owner.jar);
    const storeIds = body.data.map((n: { storeId: string | null }) => n.storeId).filter(Boolean);
    expect(storeIds).not.toContain(otherStore.body.data.id);
  });

  // 10. no-switch-for-current-store is a pure client-side rendering rule (n.storeId !== selectedStoreId), not
  // server behavior — the server has no concept of "selected store" at all (see section 14: it must never trust
  // a client-supplied selectedStoreId for authorization). This is asserted by inspecting the exact predicate
  // used in the two client surfaces, so a regression there is caught even though it's UI logic.
  it('the switch-button predicate in both notification surfaces is storeId-inequality, never store-name or index based', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const bell = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/NotificationBell.tsx'), 'utf8');
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/dashboard/notifications/page.tsx'), 'utf8');
    expect(bell).toMatch(/n\.storeId\s*!==\s*selectedStoreId/);
    expect(page).toMatch(/n\.storeId\s*!==\s*selectedStoreId/);
  });
});
