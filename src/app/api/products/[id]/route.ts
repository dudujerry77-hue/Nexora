import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds } from '@/lib/authz';
import { updateProductSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';

async function loadAccessibleProduct(storeIds: string[], productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId: { in: storeIds } } });
  if (!product) throw new ApiError('not_found', 'Product not found.');
  return product;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    const storeIds = await getAccessibleStoreIds(member, 'manage_products');
    const product = await loadAccessibleProduct(storeIds, params.id);

    const body = updateProductSchema.parse(await req.json());
    const updated = await prisma.product.update({ where: { id: product.id }, data: body });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'product.updated',
      targetType: 'Product',
      targetId: product.id,
      metadata: body,
    });

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    const storeIds = await getAccessibleStoreIds(member, 'manage_products');
    const product = await loadAccessibleProduct(storeIds, params.id);

    await prisma.$transaction([
      prisma.orderItem.updateMany({ where: { productId: product.id }, data: { productId: null } }),
      prisma.inventory.deleteMany({ where: { productId: product.id } }),
      prisma.product.delete({ where: { id: product.id } }),
    ]);

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'product.deleted',
      targetType: 'Product',
      targetId: product.id,
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
