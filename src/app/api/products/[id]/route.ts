import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds } from '@/lib/authz';
import { updateProductSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { toJson } from '@/lib/json';
import { serializeProduct } from '@/lib/productService';

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
    const { variants, images, categories, attributes, ...rest } = body;

    const images2 = images ?? (rest.imageUrl ? [rest.imageUrl] : undefined);
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: {
        ...rest,
        ...(images2 !== undefined ? { images: toJson(images2), imageUrl: images2[0] ?? rest.imageUrl ?? null } : {}),
        ...(categories !== undefined ? { categories: toJson(categories) } : {}),
        ...(attributes !== undefined ? { attributes: toJson(attributes) } : {}),
      },
    });

    if (variants) {
      await prisma.$transaction([
        prisma.productVariant.deleteMany({ where: { productId: product.id } }),
        ...(variants.length > 0
          ? [
              prisma.productVariant.createMany({
                data: variants.map((v) => ({ productId: product.id, name: v.name, sku: v.sku, price: v.price, quantity: v.quantity })),
              }),
            ]
          : []),
      ]);
    }

    const withVariants = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { inventory: true, variants: true } });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'product.updated',
      targetType: 'Product',
      targetId: product.id,
      metadata: { name: body.name, status: body.status },
    });

    return ok(serializeProduct(withVariants));
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
      prisma.productVariant.deleteMany({ where: { productId: product.id } }),
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
