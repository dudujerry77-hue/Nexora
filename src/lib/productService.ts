import { prisma } from './db';
import { ApiError } from './errors';
import type { CanonicalProduct } from './connectors/types';

export async function upsertProduct(storeId: string, product: CanonicalProduct) {
  return prisma.product.upsert({
    where: { storeId_sku: { storeId, sku: product.sku } },
    create: {
      storeId,
      sku: product.sku,
      name: product.name,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
      inventory: { create: { storeId, quantity: product.quantity ?? 0 } },
    },
    update: { name: product.name, price: product.price, imageUrl: product.imageUrl },
    include: { inventory: true },
  });
}

export async function deleteProductBySku(storeId: string, sku: string) {
  const product = await prisma.product.findUnique({ where: { storeId_sku: { storeId, sku } } });
  if (!product) throw new ApiError('not_found', `Product with SKU ${sku} not found for this store.`);

  await prisma.$transaction([
    prisma.orderItem.updateMany({ where: { productId: product.id }, data: { productId: null } }),
    prisma.inventory.deleteMany({ where: { productId: product.id } }),
    prisma.product.delete({ where: { id: product.id } }),
  ]);
}

export async function updateInventoryBySku(
  storeId: string,
  sku: string,
  quantity: number,
  lowStockThreshold?: number,
) {
  const product = await prisma.product.findUnique({ where: { storeId_sku: { storeId, sku } } });
  if (!product) throw new ApiError('not_found', `Product with SKU ${sku} not found for this store.`);

  return prisma.inventory.upsert({
    where: { productId: product.id },
    create: { productId: product.id, storeId, quantity, lowStockThreshold: lowStockThreshold ?? 5 },
    update: { quantity, ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}) },
  });
}
