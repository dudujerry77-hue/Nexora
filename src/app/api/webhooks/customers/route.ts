import { NextRequest } from 'next/server';
import { webhookCustomerPayloadSchema } from '@/lib/validation';
import { authenticateAndDedupeWebhook, markWebhookProcessed, markWebhookFailed } from '@/lib/webhookAuth';
import { upsertCustomer } from '@/lib/customerService';
import { ok, fail } from '@/lib/apiResponse';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await authenticateAndDedupeWebhook(req, webhookCustomerPayloadSchema, 'customers:write');
  } catch (error) {
    return fail(error);
  }

  if (ctx.isDuplicate) return ok({ status: 'duplicate' });

  try {
    await upsertCustomer(ctx.storeId, ctx.envelope.data);
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
