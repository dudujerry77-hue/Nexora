import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { computeStatus, deriveStoreStatus } from '@/lib/integrations';
import { ok, fail } from '@/lib/apiResponse';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const storeId = searchParams.get('storeId') ?? undefined;

    if (storeId) await assertStoreAccess({ member, storeId });

    // The global notification center (no explicit storeId — this is what
    // the bell and "view all" use) must only ever surface notifications
    // from currently-connected stores — same canonical deriveStoreStatus
    // used by the Stores page and Profile dropdown, not a separate/raw
    // check. An explicit storeId request (a per-store notifications view)
    // is a deliberate "show me this store" ask and is left unfiltered by
    // connection status, same as before.
    let visibleStoreIds: string[] | undefined;
    if (!storeId) {
      const orgStores = await prisma.store.findMany({
        where: { organizationId: member.organizationId },
        select: { id: true, integrations: { select: { lastRequestAt: true, lastWebhookAt: true, failedRequestCount: true } } },
      });
      visibleStoreIds = orgStores
        .filter((s) => deriveStoreStatus(s.integrations.map((i) => ({ status: computeStatus(i) }))) === 'connected')
        .map((s) => s.id);
    }

    const notifications = await prisma.notification.findMany({
      where: {
        organizationId: member.organizationId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(storeId
          ? { storeId }
          : // Org-level notifications (storeId null) always show; store-scoped
            // ones only show if that store is currently connected.
            { OR: [{ storeId: null }, { storeId: { in: visibleStoreIds } }] }),
      },
      include: { store: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return ok(notifications);
  } catch (error) {
    return fail(error);
  }
}
