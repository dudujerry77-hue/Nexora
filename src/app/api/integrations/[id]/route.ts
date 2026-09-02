import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { computeStatus } from '@/lib/integrations';
import { updateIntegrationSchema } from '@/lib/validation';
import { generateWebhookSecret } from '@/lib/webhookSignature';
import { encryptSecret } from '@/lib/crypto';

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
    // The outbound webhook ciphertext never needs to leave the server —
    // same reasoning as keyHash above — even though it's encrypted, not a
    // one-way hash, there's no reason for the browser to ever see it.
    const { outboundWebhookSecretCiphertext, ...safeIntegration } = integration;
    return ok({ ...safeIntegration, status: computeStatus(integration) });
  } catch (error) {
    return fail(error);
  }
}

// Configures a custom_webhook integration's real outbound product-push
// destination (src/lib/connectors/nexoraNative.ts). Mirrors the
// connect-time pattern elsewhere in this codebase: a fresh secret is
// generated and returned exactly once, never stored or retrievable in
// plaintext again — only its ciphertext persists, decrypted server-side
// only when actually signing an outbound push (productPushService.ts).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can configure integrations.');

    const integration = await loadIntegration(member.organizationId, params.id);
    await assertStoreAccess({ member, storeId: integration.storeId });

    if (integration.provider !== 'custom_webhook') {
      throw new ApiError(
        'validation_error',
        'Outbound webhook configuration is only available for a "Nexora Webhooks" (custom_webhook) integration.',
      );
    }

    const body = updateIntegrationSchema.parse(await req.json());

    let outboundWebhookSecret: string | null = null;
    if (body.outboundWebhookUrl === null) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { outboundWebhookUrl: null, outboundWebhookSecretCiphertext: null },
      });
    } else {
      outboundWebhookSecret = generateWebhookSecret();
      await prisma.integration.update({
        where: { id: integration.id },
        data: { outboundWebhookUrl: body.outboundWebhookUrl, outboundWebhookSecretCiphertext: encryptSecret(outboundWebhookSecret) },
      });
    }

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'integration.outbound_webhook_configured',
      targetType: 'Integration',
      targetId: integration.id,
      metadata: { outboundWebhookUrl: body.outboundWebhookUrl },
    });

    return ok({
      outboundWebhookUrl: body.outboundWebhookUrl,
      outboundWebhookSecret, // shown once — never retrievable again
    });
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
