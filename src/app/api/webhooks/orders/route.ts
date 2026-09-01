import { NextRequest } from 'next/server';
import { webhookOrderPayloadSchema } from '@/lib/validation';
import { authenticateAndDedupeWebhook, markWebhookProcessed, markWebhookFailed } from '@/lib/webhookAuth';
import { ingestOrder, updateOrderByExternalId } from '@/lib/orderService';
import { connectorRegistry } from '@/lib/connectors';
import { ok, fail } from '@/lib/apiResponse';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await authenticateAndDedupeWebhook(req, webhookOrderPayloadSchema, 'orders:write');
  } catch (error) {
    return fail(error);
  }

  if (ctx.isDuplicate) {
    return ok({ status: 'duplicate' });
  }

  try {
    const { envelope, storeId } = ctx;
    const data = envelope.data as Record<string, unknown>;

    if (envelope.event === 'order.created') {
      const canonical = connectorRegistry.custom_api.normalizeOrder(data);
      await ingestOrder(storeId, canonical);
    } else if (envelope.event === 'order.updated') {
      await updateOrderByExternalId(storeId, String(data.id ?? ''), {
        status: data.status ? String(data.status) : undefined,
        paymentStatus: data.payment_status ? String(data.payment_status) : undefined,
      });
    } else if (envelope.event === 'order.cancelled') {
      await updateOrderByExternalId(storeId, String(data.id ?? ''), {
        status: 'cancelled',
        reason: data.reason ? String(data.reason) : undefined,
      });
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
