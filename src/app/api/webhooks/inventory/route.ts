import { NextRequest } from 'next/server';
import { webhookInventoryPayloadSchema } from '@/lib/validation';
import { authenticateAndDedupeWebhook, markWebhookProcessed, markWebhookFailed } from '@/lib/webhookAuth';
import { updateInventoryBySku } from '@/lib/productService';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/db';
import { ok, fail } from '@/lib/apiResponse';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await authenticateAndDedupeWebhook(req, webhookInventoryPayloadSchema, 'inventory:write');
  } catch (error) {
    return fail(error);
  }

  if (ctx.isDuplicate) return ok({ status: 'duplicate' });

  try {
    const { envelope, storeId } = ctx;
    const inventory = await updateInventoryBySku(
      storeId,
      envelope.data.sku,
      envelope.data.quantity,
      envelope.data.low_stock_threshold,
    );

    if (inventory.quantity <= inventory.lowStockThreshold) {
      const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
      const product = await prisma.product.findUnique({ where: { id: inventory.productId } });
      await createNotification({
        organizationId: store.organizationId,
        storeId,
        type: 'inventory.low_stock',
        title: 'Low stock alert',
        body: `${product?.name ?? envelope.data.sku} is down to ${inventory.quantity} units.`,
        severity: 'warning',
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
