import type { Product } from '@prisma/client';
import { prisma } from './db';
import { ApiError } from './errors';
import { toJson, fromJson } from './json';
import type { CanonicalProduct } from './connectors/types';

/** Parses a Product row's JSON-as-TEXT columns for API responses. */
export function serializeProduct<T extends Product>(product: T) {
  return {
    ...product,
    images: fromJson<string[]>(product.images, []),
    categories: fromJson<string[]>(product.categories, []),
    attributes: fromJson<Record<string, unknown>>(product.attributes, {}),
  };
}

/**
 * Enforces the dual product-ownership model at the API layer, not just in
 * the dashboard UI: a `developer_owned` store's products are only ever
 * meant to change via the push-based API-key/webhook sync path (see
 * docs/API_CONTRACTS.md "Products"). Call this from every
 * session-authenticated (dashboard) product mutation — create, update,
 * delete — so a direct API call with a valid session cookie can't bypass
 * the read-only UI. Never call this from the API-key/webhook ingestion
 * path, which must keep working regardless of productMode.
 */
export async function assertNexoraManagedProducts(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { productMode: true } });
  if (!store) throw new ApiError('not_found', 'Store not found.');
  if (store.productMode !== 'nexora_managed') {
    throw new ApiError(
      'forbidden',
      "This store's products are managed by its connected integration — push changes via your API key or webhook instead of the dashboard.",
    );
  }
}

/**
 * Creates or updates a product from a developer-owned integration push
 * (webhook or direct API). This is the "sync" half of the dual product-mode
 * design (see docs/API_CONTRACTS.md "Products") — a full replace of the
 * mapped fields on every push, since the developer's own system is the
 * source of truth for these products, not anything edited in the Nexora
 * dashboard.
 */
export async function upsertProduct(storeId: string, product: CanonicalProduct) {
  const images = product.images ?? [];
  const data = {
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    imageUrl: images[0],
    images: toJson(images),
    categories: toJson(product.categories ?? []),
    status: product.status ?? 'active',
    attributes: toJson(product.attributes ?? {}),
  };

  const saved = await prisma.product.upsert({
    where: { storeId_sku: { storeId, sku: product.sku } },
    create: {
      storeId,
      sku: product.sku,
      ...data,
      inventory: { create: { storeId, quantity: product.quantity ?? 0 } },
    },
    update: data,
    include: { inventory: true },
  });

  if (product.variants) {
    await prisma.$transaction([
      prisma.productVariant.deleteMany({ where: { productId: saved.id } }),
      ...(product.variants.length > 0
        ? [
            prisma.productVariant.createMany({
              data: product.variants.map((v) => ({
                productId: saved.id,
                name: v.name,
                sku: v.sku,
                price: v.price,
                quantity: v.quantity ?? 0,
              })),
            }),
          ]
        : []),
    ]);
  }

  return saved;
}

export async function deleteProductBySku(storeId: string, sku: string) {
  const product = await prisma.product.findUnique({ where: { storeId_sku: { storeId, sku } } });
  if (!product) throw new ApiError('not_found', `Product with SKU ${sku} not found for this store.`);

  await prisma.$transaction([
    prisma.orderItem.updateMany({ where: { productId: product.id }, data: { productId: null } }),
    prisma.productVariant.deleteMany({ where: { productId: product.id } }),
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
