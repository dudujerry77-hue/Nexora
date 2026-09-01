import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds } from '@/lib/authz';
import { updateInventorySchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';

export async function PATCH(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const { user, member } = await requireSession(req);
    const storeIds = await getAccessibleStoreIds(member, 'manage_products');

    const inventory = await prisma.inventory.findFirst({
      where: { productId: params.productId, storeId: { in: storeIds } },
    });
    if (!inventory) throw new ApiError('not_found', 'Inventory record not found.');

    const body = updateInventorySchema.parse(await req.json());
    const updated = await prisma.inventory.update({ where: { id: inventory.id }, data: body });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'inventory.updated',
      targetType: 'Inventory',
      targetId: inventory.id,
      metadata: body,
    });

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
