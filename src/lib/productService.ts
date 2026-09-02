import type { Product } from '@prisma/client';
import { ZodError } from 'zod';
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

export interface CatalogSyncItemResult {
  index: number;
  sku?: string;
  action?: 'upsert' | 'delete';
  status: 'applied' | 'unchanged' | 'failed';
  reason?: 'stale' | 'already_missing' | 'not_attempted';
  error?: string;
}

export interface CatalogSyncResult {
  status: 'processed' | 'partial' | 'failed';
  total: number;
  applied: number;
  unchanged: number;
  failed: number;
  results: CatalogSyncItemResult[];
}

function bestEffortSku(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const sku = (raw as Record<string, unknown>).sku;
  return typeof sku === 'string' ? sku : undefined;
}

function bestEffortAction(raw: unknown): 'upsert' | 'delete' | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const action = (raw as Record<string, unknown>).action;
  return action === 'upsert' || action === 'delete' ? action : undefined;
}

/**
 * Processes one product.sync batch item by item, reusing the exact same
 * upsertProduct()/deleteProductBySku() the single-item webhook events use
 * — every existing guarantee (sourceUpdatedAt staleness, connector
 * normalization, storeId scoping) applies identically to a batch item as
 * to a lone one. `parseItem` and `normalizeProduct` are injected by the
 * caller (src/app/api/webhooks/products/route.ts) so this module doesn't
 * need to import zod schemas or the connector registry directly. `upsert`/
 * `remove` are also injectable (defaulting to the real upsertProduct/
 * deleteProductBySku below) purely so tests can simulate a systemic
 * failure on one specific item — ordinary callers never pass them.
 *
 * Each item is validated and written independently, in input order — a
 * bad item can only ever produce its own "failed" result, never abort a
 * sibling's write, and no item's write is wrapped in another's
 * transaction (a batch of 300 is 300 independent database operations, not
 * one giant one). Because items run strictly in order and each write
 * lands immediately, a later item for the same SKU deterministically wins
 * over an earlier one — unless the existing sourceUpdatedAt staleness
 * check in upsertProduct() says otherwise, which this never bypasses.
 *
 * The one exception to "one bad item, one failed result" is a genuinely
 * unexpected error (anything that isn't a per-item validation failure or
 * "SKU already missing" on delete) — a sign of a systemic problem, e.g.
 * the database itself being unreachable. That stops the loop immediately
 * rather than repeating the same failure hundreds of times; every
 * remaining item is reported "not_attempted" rather than silently
 * omitted, so the response always accounts for every item submitted.
 */
export async function syncProductBatch(params: {
  storeId: string;
  items: unknown[];
  parseItem: (raw: unknown) => { sku: string; action: 'upsert' | 'delete'; occurred_at?: string };
  normalizeProduct: (raw: unknown) => CanonicalProduct;
  upsert?: typeof upsertProduct;
  remove?: typeof deleteProductBySku;
}): Promise<CatalogSyncResult> {
  const { storeId, items, parseItem, normalizeProduct, upsert = upsertProduct, remove = deleteProductBySku } = params;
  const results: CatalogSyncItemResult[] = [];
  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  let aborted = false;

  for (let index = 0; index < items.length; index++) {
    if (aborted) {
      failed++;
      results.push({ index, sku: bestEffortSku(items[index]), action: bestEffortAction(items[index]), status: 'failed', reason: 'not_attempted' });
      continue;
    }

    const raw = items[index];
    let parsed: { sku: string; action: 'upsert' | 'delete'; occurred_at?: string };
    try {
      parsed = parseItem(raw);
    } catch (error) {
      failed++;
      results.push({
        index,
        sku: bestEffortSku(raw),
        action: bestEffortAction(raw),
        status: 'failed',
        error: error instanceof ZodError ? 'Invalid product data for this item.' : 'Could not read this item.',
      });
      continue;
    }

    try {
      if (parsed.action === 'delete') {
        try {
          await remove(storeId, parsed.sku);
          applied++;
          results.push({ index, sku: parsed.sku, action: 'delete', status: 'applied' });
        } catch (error) {
          if (error instanceof ApiError && error.code === 'not_found') {
            unchanged++;
            results.push({ index, sku: parsed.sku, action: 'delete', status: 'unchanged', reason: 'already_missing' });
          } else {
            throw error;
          }
        }
      } else {
        const canonical = normalizeProduct(parsed);
        const occurredAt = parsed.occurred_at ? new Date(parsed.occurred_at) : undefined;
        const { applied: wasApplied } = await upsert(storeId, canonical, { occurredAt });
        if (wasApplied) {
          applied++;
          results.push({ index, sku: parsed.sku, action: 'upsert', status: 'applied' });
        } else {
          unchanged++;
          results.push({ index, sku: parsed.sku, action: 'upsert', status: 'unchanged', reason: 'stale' });
        }
      }
    } catch (error) {
      failed++;
      results.push({
        index,
        sku: parsed.sku,
        action: parsed.action,
        status: 'failed',
        error: 'An unexpected error occurred while processing this item.',
      });
      // Not a validation or "already missing" outcome — looks systemic
      // (e.g. a DB-level failure). Stop rather than repeat it hundreds of
      // times; see the function doc comment above.
      aborted = true;
    }
  }

  const total = items.length;
  const status: CatalogSyncResult['status'] = failed === 0 ? 'processed' : applied + unchanged > 0 ? 'partial' : 'failed';
  return { status, total, applied, unchanged, failed, results };
}
