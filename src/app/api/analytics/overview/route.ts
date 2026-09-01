import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds, assertStoreAccess } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { computeStatus } from '@/lib/integrations';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId') ?? undefined;
    const range = searchParams.get('range') ?? '7d';
    const days = RANGE_DAYS[range] ?? 7;

    if (storeId) await assertStoreAccess({ member, storeId });
    const storeIds = storeId ? [storeId] : await getAccessibleStoreIds(member);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalStores, orders, ordersToday, pendingOrders, products, integrations] = await Promise.all([
      prisma.store.count({ where: { id: { in: storeIds } } }),
      prisma.order.findMany({ where: { storeId: { in: storeIds }, createdAt: { gte: since } } }),
      prisma.order.count({ where: { storeId: { in: storeIds }, createdAt: { gte: startOfToday } } }),
      prisma.order.count({ where: { storeId: { in: storeIds }, status: 'pending' } }),
      prisma.product.findMany({ where: { storeId: { in: storeIds } }, include: { inventory: true } }),
      prisma.integration.findMany({ where: { storeId: { in: storeIds } } }),
    ]);

    const revenue = orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.total, 0);

    const connectedStores = integrations.filter((i) => computeStatus(i) === 'connected').length;
    const lowStockProducts = products.filter((p) => p.inventory && p.inventory.quantity <= p.inventory.lowStockThreshold);

    const recentOrders = await prisma.order.findMany({
      where: { storeId: { in: storeIds } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { store: { select: { name: true } } },
    });

    const recentNotifications = await prisma.notification.findMany({
      where: { organizationId: member.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return ok({
      totalStores,
      connectedStores,
      ordersToday,
      pendingOrders,
      revenue,
      revenueRangeDays: days,
      lowStockCount: lowStockProducts.length,
      lowStockProducts: lowStockProducts.slice(0, 10),
      recentOrders,
      recentNotifications,
    });
  } catch (error) {
    return fail(error);
  }
}
