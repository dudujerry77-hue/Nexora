import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds } from '@/lib/authz';
import { updateOrderSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

async function loadAccessibleOrder(memberOrgStoreIds: string[], orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, storeId: { in: memberOrgStoreIds } },
    include: { items: true, store: true, customer: true },
  });
  if (!order) throw new ApiError('not_found', 'Order not found.');
  return order;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const storeIds = await getAccessibleStoreIds(member, 'view_orders');
    const order = await loadAccessibleOrder(storeIds, params.id);
    return ok(order);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    const storeIds = await getAccessibleStoreIds(member, 'manage_orders');
    const order = await loadAccessibleOrder(storeIds, params.id);

    const body = updateOrderSchema.parse(await req.json());
    const updated = await prisma.order.update({ where: { id: order.id }, data: body });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'order.status_updated',
      targetType: 'Order',
      targetId: order.id,
      metadata: body,
    });

    if (body.status && body.status !== order.status) {
      await createNotification({
        organizationId: member.organizationId,
        storeId: order.storeId,
        type: 'order.updated',
        title: `Order #${order.externalId} is now ${body.status}`,
        body: `${order.store.name}: order for ${order.customerName} updated to "${body.status}".`,
        severity: 'info',
      });
    }

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
