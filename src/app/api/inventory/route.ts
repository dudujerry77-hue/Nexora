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
    const lowStockOnly = searchParams.get('lowStockOnly') === 'true';

    if (storeId) await assertStoreAccess({ member, storeId, permission: 'view_products' });
    const storeIds = storeId ? [storeId] : await getAccessibleStoreIds(member, 'view_products');

    const where: Prisma.InventoryWhereInput = { storeId: { in: storeIds } };

    const inventory = await prisma.inventory.findMany({
      where,
      include: { product: true },
      orderBy: { updatedAt: 'desc' },
    });

    const filtered = lowStockOnly ? inventory.filter((i) => i.quantity <= i.lowStockThreshold) : inventory;

    return ok(filtered);
  } catch (error) {
    return fail(error);
  }
}
