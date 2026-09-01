import { NextRequest } from 'next/server';
import { webhookProductPayloadSchema } from '@/lib/validation';
import { authenticateAndDedupeWebhook, markWebhookProcessed, markWebhookFailed } from '@/lib/webhookAuth';
import { upsertProduct, deleteProductBySku } from '@/lib/productService';
import { connectorRegistry } from '@/lib/connectors';
import { ok, fail } from '@/lib/apiResponse';

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
    const data = envelope.data as Record<string, unknown>;

    if (envelope.event === 'product.created' || envelope.event === 'product.updated') {
      const canonical = connectorRegistry.custom_api.normalizeProduct(data);
      await upsertProduct(storeId, canonical);
    } else if (envelope.event === 'product.deleted') {
      await deleteProductBySku(storeId, String(data.sku ?? ''));
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
