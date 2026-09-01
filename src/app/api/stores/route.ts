import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/authz';
import { createStoreSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { storeSummary } from '@/lib/storeService';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);

    const storeIds =
      member.role === 'OWNER'
        ? null
        : (
            await prisma.storeAssignment.findMany({
              where: { memberId: member.id },
              select: { storeId: true },
            })
          ).map((a) => a.storeId);

    const stores = await prisma.store.findMany({
      where: {
        organizationId: member.organizationId,
        ...(storeIds ? { id: { in: storeIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const withSummary = await Promise.all(
      stores.map(async (store) => {
        const { orderCount, productCount, integrations } = await storeSummary(store.id);
        return { ...store, orderCount, productCount, integrationCount: integrations.length };
      }),
    );

    return ok(withSummary);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can create stores.');

    const body = createStoreSchema.parse(await req.json());

    const store = await prisma.store.create({
      data: {
        organizationId: member.organizationId,
        name: body.name,
        type: body.type,
        logoUrl: body.logoUrl,
        status: 'disconnected',
      },
    });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'store.created',
      targetType: 'Store',
      targetId: store.id,
      metadata: { name: store.name },
    });

    return ok(store, 201);
  } catch (error) {
    return fail(error);
  }
}
