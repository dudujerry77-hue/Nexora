import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { updateStoreSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { storeSummary } from '@/lib/storeService';
import { deleteStoreCascade } from '@/lib/storeService';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const store = await assertStoreAccess({ member, storeId: params.id });
    const { orderCount, productCount, integrations, status } = await storeSummary(store.id);
    // outboundWebhookSecretCiphertext never needs to leave the server — even
    // though it's encrypted (never a one-way hash), the browser has no
    // legitimate use for it. Only src/lib/productPushService.ts reads it
    // directly from the database when actually signing an outbound push.
    const safeIntegrations = integrations.map(({ outboundWebhookSecretCiphertext, ...safe }) => safe);
    return ok({ ...store, status, orderCount, productCount, integrations: safeIntegrations });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can edit stores.');
    const store = await assertStoreAccess({ member, storeId: params.id });

    const body = updateStoreSchema.parse(await req.json());
    const updated = await prisma.store.update({
      where: { id: store.id },
      data: body,
    });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'store.updated',
      targetType: 'Store',
      targetId: store.id,
      metadata: body,
    });

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can delete stores.');
    const store = await assertStoreAccess({ member, storeId: params.id });

    await deleteStoreCascade(store.id);

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'store.deleted',
      targetType: 'Store',
      targetId: store.id,
      metadata: { name: store.name },
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
