import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds, assertStoreAccess } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId') ?? undefined;
    const search = searchParams.get('search') ?? undefined;

    if (storeId) await assertStoreAccess({ member, storeId, permission: 'view_customers' });
    const storeIds = storeId ? [storeId] : await getAccessibleStoreIds(member, 'view_customers');

    const where: Prisma.CustomerWhereInput = {
      storeId: { in: storeIds },
      ...(search ? { name: { contains: search } } : {}),
    };

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    });

    return ok(customers);
  } catch (error) {
    return fail(error);
  }
}
