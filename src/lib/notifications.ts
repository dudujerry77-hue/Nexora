import { prisma } from './db';
import { eventBus } from './events';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export async function createNotification(params: {
  organizationId: string;
  storeId?: string | null;
  type: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
}) {
  const notification = await prisma.notification.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      severity: params.severity ?? 'info',
    },
    // The live SSE payload needs the originating store's name too — the
    // notification bell renders it immediately, not just after the next
    // GET /api/notifications fetch (see NotificationBell.tsx).
    include: { store: { select: { id: true, name: true } } },
  });

  eventBus.publish({
    type: 'notification.created',
    organizationId: params.organizationId,
    payload: notification,
  });

  return notification;
}
