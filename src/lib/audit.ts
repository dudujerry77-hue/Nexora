import { prisma } from './db';
import { toJson } from './json';

export async function writeAuditLog(params: {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: params.organizationId ?? null,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      metadata: toJson(params.metadata ?? {}),
    },
  });
}
