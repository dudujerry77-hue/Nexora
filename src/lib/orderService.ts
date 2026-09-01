import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { ApiError } from './errors';
import { createNotification } from './notifications';
import type { CanonicalOrder } from './connectors/types';

export async function ingestOrder(storeId: string, order: CanonicalOrder, customerExternalId?: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new ApiError('not_found', 'Store not found.');

  let customerId: string | undefined;
  const externalCustomerId = customerExternalId ?? order.customerExternalId;
  if (externalCustomerId) {
    const customer = await prisma.customer.upsert({
      where: { storeId_externalId: { storeId, externalId: externalCustomerId } },
      create: { storeId, externalId: externalCustomerId, name: order.customerName },
      update: { name: order.customerName },
    });
    customerId = customer.id;
  }

  let created;
  try {
    created = await prisma.order.create({
      data: {
        storeId,
        externalId: order.externalId,
        customerId,
        customerName: order.customerName,
        status: order.status ?? 'pending',
        total: order.total,
        currency: order.currency,
        deliveryAddress: order.deliveryAddress,
        items: {
          create: await Promise.all(
            order.items.map(async (item) => {
              let productId: string | undefined;
              if (item.sku) {
                const product = await prisma.product.findUnique({ where: { storeId_sku: { storeId, sku: item.sku } } });
                if (product) {
                  productId = product.id;
                  const inv = await prisma.inventory.findUnique({ where: { productId: product.id } });
                  if (inv) {
                    const newQty = Math.max(0, inv.quantity - item.quantity);
                    await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: newQty } });
                    if (newQty <= inv.lowStockThreshold) {
                      await createNotification({
                        organizationId: store.organizationId,
                        storeId,
                        type: 'inventory.low_stock',
                        title: 'Low stock alert',
                        body: `${product.name} is down to ${newQty} units.`,
                        severity: 'warning',
                      });
                    }
                  }
                }
              }
              return { productId, name: item.name, quantity: item.quantity, price: item.price };
            }),
          ),
        },
      },
      include: { items: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError('conflict', `Order ${order.externalId} already exists for this store.`);
    }
    throw error;
  }

  await prisma.store.update({ where: { id: storeId }, data: { lastSyncAt: new Date() } });

  await createNotification({
    organizationId: store.organizationId,
    storeId,
    type: 'order.created',
    title: 'New order received',
    body: `${store.name}: Order #${created.externalId} from ${created.customerName} — ${created.currency} ${created.total.toLocaleString()}`,
    severity: 'info',
  });

  return created;
}

export async function updateOrderByExternalId(
  storeId: string,
  externalId: string,
  updates: { status?: string; paymentStatus?: string; reason?: string },
) {
  const order = await prisma.order.findUnique({ where: { storeId_externalId: { storeId, externalId } } });
  if (!order) throw new ApiError('not_found', `Order ${externalId} not found for this store.`);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: updates.status, paymentStatus: updates.paymentStatus },
  });

  if (updates.status && updates.status !== order.status) {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    await createNotification({
      organizationId: store.organizationId,
      storeId,
      type: 'order.updated',
      title: `Order #${externalId} is now ${updates.status}`,
      body: `${store.name}: order for ${order.customerName} updated to "${updates.status}".${updates.reason ? ` Reason: ${updates.reason}` : ''}`,
      severity: updates.status === 'cancelled' ? 'warning' : 'info',
    });
  }

  return updated;
}
