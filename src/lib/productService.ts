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
 * Guards the "create once, edit in place" product-management surface
 * (POST/PATCH /api/products) — used by both the dashboard session and a
 * direct API-key call. A developer_owned store's catalog is authoritative
 * on the developer's own system, so letting either path write here would
 * let Nexora silently clobber it.
 *
 * This deliberately does NOT gate `upsertProduct` below or the
 * POST /api/webhooks/products route that calls it — that upsert-shaped
 * push (re-sending the same SKU is a normal, idempotent update, not a
 * conflict) is the real developer-owned sync channel and must keep
 * working for a developer_owned store regardless of how it authenticates.
 */
export function assertNexoraManagedProductWrites(store: { productMode: string }): void {
  if (store.productMode !== 'nexora_managed') {
    throw new ApiError(
      'forbidden',
      'This store is developer-owned — its product catalog syncs in via POST /api/webhooks/products, not through the create/edit product management endpoints.',
    );
  }
}

export interface UpsertProductResult {
  product: Awaited<ReturnType<typeof prisma.product.upsert>>;
  /** false when the write was skipped as stale/out-of-order — see below. */
  applied: boolean;
}

/**
 * Creates or updates a product from a developer-owned integration push
 * (webhook). This is the "sync" half of the dual product-mode design (see
 * docs/API_CONTRACTS.md "Products") — a full replace of the mapped fields
 * on every push, since the developer's own system is the source of truth
 * for these products, not anything edited in the Nexora dashboard.
 *
 * `occurredAt` is the sender's own `occurred_at` for this specific push
 * (never Nexora's `updatedAt`, which stays a local write timestamp — see
 * the `sourceUpdatedAt` column comment in schema.prisma). When an existing
 * product already recorded a `sourceUpdatedAt` at or after this push's
 * `occurredAt`, the push is a stale/out-of-order redelivery and is skipped
 * entirely rather than clobbering newer data with older data. Omitting
 * `occurredAt` (as every integration did before this field existed)
 * preserves the previous unconditional-overwrite behavior exactly — it
 * only ever compares against a previous `occurredAt`, never against
 * anything else.
 */
export async function upsertProduct(
  storeId: string,
  product: CanonicalProduct,
  options: { occurredAt?: Date } = {},
): Promise<UpsertProductResult> {
  const { occurredAt } = options;

  if (occurredAt) {
    const existing = await prisma.product.findUnique({ where: { storeId_sku: { storeId, sku: product.sku } } });
    if (existing?.sourceUpdatedAt && occurredAt <= existing.sourceUpdatedAt) {
      return { product: await prisma.product.findUniqueOrThrow({ where: { id: existing.id }, include: { inventory: true } }), applied: false };
    }
  }

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
    ...(occurredAt ? { sourceUpdatedAt: occurredAt } : {}),
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

  return { product: saved, applied: true };
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
