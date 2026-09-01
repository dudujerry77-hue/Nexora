import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { computeStatus } from '@/lib/integrations';

async function loadIntegration(organizationId: string, integrationId: string) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, store: { organizationId } },
    include: { store: true, apiKeys: true, integrationLogs: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!integration) throw new ApiError('not_found', 'Integration not found.');
  return integration;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const integration = await loadIntegration(member.organizationId, params.id);
    await assertStoreAccess({ member, storeId: integration.storeId });
    return ok({ ...integration, status: computeStatus(integration) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can disconnect integrations.');

    const integration = await loadIntegration(member.organizationId, params.id);
    await assertStoreAccess({ member, storeId: integration.storeId });

    await prisma.$transaction([
      prisma.apiKey.updateMany({ where: { integrationId: integration.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.integration.update({ where: { id: integration.id }, data: { status: 'disconnected' } }),
    ]);

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'integration.disconnected',
      targetType: 'Integration',
      targetId: integration.id,
    });

    return ok({ disconnected: true });
  } catch (error) {
    return fail(error);
  }
}
