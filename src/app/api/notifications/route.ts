import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
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

    const notifications = await prisma.notification.findMany({
      where: {
        organizationId: member.organizationId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(storeId ? { storeId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return ok(notifications);
  } catch (error) {
    return fail(error);
  }
}
