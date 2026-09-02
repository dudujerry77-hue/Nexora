import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  webhookProductPayloadSchema,
  webhookProductDataSchema,
  productSyncBatchShapeSchema,
  productSyncItemSchema,
} from '@/lib/validation';
import { authenticateAndDedupeWebhook, markWebhookProcessed, markWebhookFailed, logInbound, MAX_WEBHOOK_BODY_BYTES } from '@/lib/webhookAuth';
import { upsertProduct, deleteProductBySku, syncProductBatch } from '@/lib/productService';
import { connectorRegistry } from '@/lib/connectors';
import { ok, fail } from '@/lib/apiResponse';

/**
 * Resolves the connector for whichever provider actually authenticated this
 * webhook (custom_api or custom_webhook — the only two providers that can
 * reach authenticateAndDedupeWebhook with products:write). Falls back to
 * custom_api only in the defensive case where no integration could be
 * resolved at all (authenticateAndDedupeWebhook already requires *a* valid
 * key/signature, so this is a last resort, not the normal path).
 */
async function resolveConnector(integrationId: string | null) {
  const provider = integrationId ? (await prisma.integration.findUnique({ where: { id: integrationId } }))?.provider : undefined;
  return (provider && connectorRegistry[provider]) || connectorRegistry.custom_api;
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await authenticateAndDedupeWebhook(req, webhookProductPayloadSchema, 'products:write', {
      // Only enforced here (products), not for orders/inventory/customers —
      // see MAX_WEBHOOK_BODY_BYTES's doc comment in webhookAuth.ts.
      maxBodyBytes: MAX_WEBHOOK_BODY_BYTES,
      // Charges the separate catalog-sync bucket by actual item count,
      // computed before the idempotency record is written. Every other
      // event type returns null here — zero extra charge, unchanged.
      //
      // A malformed request (`products` missing or not an array) returns 0
      // here, not null — deliberately still charged. `null` means "not a
      // batch at all, skip the extra bucket entirely" (every non-sync
      // event); `0` means "this claimed to be a batch, so charge it
      // something for the attempt" — authenticateAndDedupeWebhook clamps
      // any non-null value to at least 1 via `Math.max(itemCost, 1)`, so a
      // malformed batch is never a free attempt against the flat webhook
      // bucket alone. See "malformed product.sync still charges at least
      // 1 catalog-sync token" in tests/productSync.test.ts.
      itemCost: (envelope) => {
        if (envelope.event !== 'product.sync') return null;
        const products = (envelope.data as Record<string, unknown>).products;
        return Array.isArray(products) ? products.length : 0;
      },
    });
  } catch (error) {
    return fail(error);
  }

  if (ctx.isDuplicate) return ok({ status: 'duplicate' });

  try {
    const { envelope, storeId } = ctx;

    if (envelope.event === 'product.sync') {
      // Whole-request shape only (is `products` an array, 1..300 items) —
      // per-item field validation happens inside syncProductBatch so one
      // bad item can't invalidate its siblings.
      const { products } = productSyncBatchShapeSchema.parse(envelope.data);
      const connector = await resolveConnector(ctx.integrationId);

      const result = await syncProductBatch({
        storeId,
        items: products,
        parseItem: (raw) => productSyncItemSchema.parse(raw),
        normalizeProduct: (raw) => connector.normalizeProduct(raw),
      });

      // One summary log line for the whole batch, never one per item —
      // counts only, no product payloads, no keys/secrets.
      await logInbound({
        storeId,
        integrationId: ctx.integrationId,
        level: result.failed === 0 ? 'info' : result.applied + result.unchanged > 0 ? 'warning' : 'error',
        message: `Catalog sync: ${result.total} items — ${result.applied} applied, ${result.unchanged} unchanged, ${result.failed} failed.`,
        metadata: { event: 'product.sync', total: result.total, applied: result.applied, unchanged: result.unchanged, failed: result.failed },
      });

      await markWebhookProcessed(ctx.storeId, ctx.envelope.event_id);
      return ok(result);
    }

    // Bounded, http(s)-only-image validation — mirrors the dashboard's
    // createProductSchema/updateProductSchema (see webhookProductDataSchema
    // in src/lib/validation.ts) so a webhook push can't smuggle in
    // anything the dashboard form itself wouldn't allow.
    const data = webhookProductDataSchema.parse(envelope.data);
    const occurredAt = envelope.occurred_at ? new Date(envelope.occurred_at) : undefined;

    if (envelope.event === 'product.created' || envelope.event === 'product.updated') {
      const connector = await resolveConnector(ctx.integrationId);
      const canonical = connector.normalizeProduct(data);
      await upsertProduct(storeId, canonical, { occurredAt });
    } else if (envelope.event === 'product.deleted') {
      await deleteProductBySku(storeId, data.sku);
    }

    await markWebhookProcessed(ctx.storeId, ctx.envelope.event_id);
    return ok({ status: 'processed' });
  } catch (error) {
    await markWebhookFailed({
      storeId: ctx.storeId,
      eventId: ctx.envelope.event_id,
      integrationId: ctx.integrationId,
      error,
    });
    return fail(error);
  }
}
