import { prisma } from './db';
import { computeStatus, PROVIDER_LABELS } from './integrations';

/**
 * Cascading hard-delete for a store. Prisma (on SQLite, without native FK
 * cascade in this schema) requires deleting children before parents; this
 * runs the whole thing in one transaction so it's all-or-nothing.
 */
export async function deleteStoreCascade(storeId: string): Promise<void> {
  await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { order: { storeId } } }),
    prisma.order.deleteMany({ where: { storeId } }),
    prisma.inventory.deleteMany({ where: { storeId } }),
    prisma.productVariant.deleteMany({ where: { product: { storeId } } }),
    prisma.product.deleteMany({ where: { storeId } }),
    prisma.monitoringEvent.deleteMany({ where: { storeId } }),
    prisma.monitoringIssue.deleteMany({ where: { storeId } }),
    prisma.customer.deleteMany({ where: { storeId } }),
    prisma.integrationLog.deleteMany({ where: { storeId } }),
    prisma.apiKey.deleteMany({ where: { storeId } }),
    prisma.webhookEvent.deleteMany({ where: { storeId } }),
    prisma.webhookEndpoint.deleteMany({ where: { storeId } }),
    prisma.integration.deleteMany({ where: { storeId } }),
    prisma.storeAssignment.deleteMany({ where: { storeId } }),
    prisma.notification.updateMany({ where: { storeId }, data: { storeId: null } }),
    prisma.store.delete({ where: { id: storeId } }),
  ]);
}

export async function storeSummary(storeId: string) {
  const [orderCount, productCount, rawIntegrations] = await Promise.all([
    prisma.order.count({ where: { storeId } }),
    prisma.product.count({ where: { storeId } }),
    prisma.integration.findMany({ where: { storeId } }),
  ]);
  const integrations = rawIntegrations.map((i) => ({
    ...i,
    status: computeStatus(i),
    providerLabel: PROVIDER_LABELS[i.provider]?.label ?? i.provider,
  }));
  return { orderCount, productCount, integrations };
}
