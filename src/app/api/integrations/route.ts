import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { createIntegrationSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { generateApiKey, generatePublicKey, hashApiKey } from '@/lib/apiKey';
import { generateWebhookSecret } from '@/lib/webhookSignature';
import { encryptSecret } from '@/lib/crypto';
import { getConnector } from '@/lib/connectors';
import { computeStatus, PROVIDER_LABELS } from '@/lib/integrations';
import { toJson } from '@/lib/json';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId') ?? undefined;

    if (storeId) await assertStoreAccess({ member, storeId });

    const orgStores = await prisma.store.findMany({
      where: { organizationId: member.organizationId, ...(storeId ? { id: storeId } : {}) },
      select: { id: true },
    });
    const storeIds = orgStores.map((s) => s.id);

    const integrations = await prisma.integration.findMany({
      where: { storeId: { in: storeIds } },
      include: { apiKeys: { select: { id: true, name: true, keyPrefix: true, revokedAt: true, lastUsedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = integrations.map((i) => ({
      ...i,
      status: computeStatus(i),
      providerLabel: PROVIDER_LABELS[i.provider]?.label ?? i.provider,
    }));

    return ok(enriched);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can create integrations.');

    const body = createIntegrationSchema.parse(await req.json());
    const store = await assertStoreAccess({ member, storeId: body.storeId });

    const connector = getConnector(body.provider);
    if (!connector || !connector.available) {
      throw new ApiError(
        'validation_error',
        `The "${body.provider}" connector is planned but not yet available. Use custom_api, custom_webhook, or js_sdk for this MVP.`,
      );
    }

    const integration = await prisma.integration.create({
      data: { storeId: store.id, provider: body.provider, status: 'disconnected' },
    });

    const scopes =
      body.provider === 'js_sdk' ? ['read'] : body.scopes ?? ['orders:write', 'products:write', 'inventory:write', 'customers:write', 'read'];

    let secret: { fullKey: string; keyPrefix: string; keyHash: string };
    if (body.provider === 'js_sdk') {
      const publicKey = generatePublicKey();
      secret = { fullKey: publicKey, keyPrefix: publicKey.slice(0, 14), keyHash: hashApiKey(publicKey) };
    } else {
      secret = generateApiKey('live');
    }

    await prisma.apiKey.create({
      data: {
        storeId: store.id,
        integrationId: integration.id,
        name: body.name ?? `${PROVIDER_LABELS[body.provider]?.label ?? body.provider} key`,
        keyPrefix: secret.keyPrefix,
        keyHash: secret.keyHash,
        scopes: toJson(scopes),
      },
    });

    let webhookSecret: string | null = null;
    if (body.provider === 'custom_api' || body.provider === 'custom_webhook') {
      webhookSecret = generateWebhookSecret();
      await prisma.webhookEndpoint.create({
        data: { storeId: store.id, secretCiphertext: encryptSecret(webhookSecret) },
      });
    }

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'integration.created',
      targetType: 'Integration',
      targetId: integration.id,
      metadata: { provider: body.provider, storeId: store.id },
    });

    return ok(
      {
        integration,
        apiKey: secret.fullKey, // shown once — never retrievable again
        keyType: body.provider === 'js_sdk' ? 'public' : 'secret',
        webhookSecret, // shown once, only for webhook-capable providers
        webhookUrl:
          body.provider === 'custom_api' || body.provider === 'custom_webhook'
            ? `${new URL(req.url).origin}/api/webhooks/orders`
            : null,
      },
      201,
    );
  } catch (error) {
    return fail(error);
  }
}
