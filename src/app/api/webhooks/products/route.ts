import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { webhookProductPayloadSchema, webhookProductDataSchema } from '@/lib/validation';
import { authenticateAndDedupeWebhook, markWebhookProcessed, markWebhookFailed } from '@/lib/webhookAuth';
import { upsertProduct, deleteProductBySku } from '@/lib/productService';
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
    ctx = await authenticateAndDedupeWebhook(req, webhookProductPayloadSchema, 'products:write');
  } catch (error) {
    return fail(error);
  }

  if (ctx.isDuplicate) return ok({ status: 'duplicate' });

  try {
    const { envelope, storeId } = ctx;
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
