import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, requireApiKey, getAccessibleStoreIds, assertStoreAccess } from '@/lib/authz';
import { createOrderSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { consume } from '@/lib/rateLimit';
import { ingestOrder } from '@/lib/orderService';
import type { CanonicalOrder } from '@/lib/connectors/types';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '20')));

    if (storeId) {
      await assertStoreAccess({ member, storeId, permission: 'view_orders' });
    }

    const accessibleStoreIds = await getAccessibleStoreIds(member, 'view_orders');
    const scopedStoreIds = storeId ? [storeId] : accessibleStoreIds;

    const where: Prisma.OrderWhereInput = {
      storeId: { in: scopedStoreIds },
      ...(status ? { status } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { items: true, store: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);

    return ok({ orders, page, pageSize, total });
  } catch (error) {
    return fail(error);
  }
}

function toCanonicalOrder(body: ReturnType<typeof createOrderSchema.parse>): CanonicalOrder {
  return {
    externalId: body.externalId,
    customerName: body.customer.name,
    customerExternalId: body.customer.id,
    items: body.items,
    total: body.total,
    currency: body.currency,
    status: body.status,
    deliveryAddress: body.deliveryAddress,
  };
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');

    if (authHeader) {
      const apiKeyCtx = await requireApiKey(req, 'orders:write');
      const rl = consume(`orders:write:${apiKeyCtx.apiKeyId}`, 60, 60_000);
      if (!rl.allowed) throw new ApiError('rate_limited', 'API key rate limit exceeded.');

      const body = createOrderSchema.parse(await req.json());
      if (body.storeId !== apiKeyCtx.storeId) {
        throw new ApiError('forbidden', 'API key is not authorized for this store.');
      }
      await prisma.integration.update({
        where: { id: apiKeyCtx.integrationId },
        data: { lastRequestAt: new Date() },
      });
      const order = await ingestOrder(apiKeyCtx.storeId, toCanonicalOrder(body));
      return ok(order, 201);
    }

    const { member } = await requireSession(req);
    if (member.role !== 'OWNER') {
      throw new ApiError('forbidden', 'Only owners can manually create orders from the dashboard.');
    }
    const body = createOrderSchema.parse(await req.json());
    await assertStoreAccess({ member, storeId: body.storeId });
    const order = await ingestOrder(body.storeId, toCanonicalOrder(body));
    return ok(order, 201);
  } catch (error) {
    return fail(error);
  }
}
