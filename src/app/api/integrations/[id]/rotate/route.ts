import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { generateApiKey, generatePublicKey, hashApiKey } from '@/lib/apiKey';
import { toJson, fromJson } from '@/lib/json';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, member } = await requireSession(req);
    if (member.role !== 'OWNER') throw new ApiError('forbidden', 'Only owners can rotate API keys.');

    const integration = await prisma.integration.findFirst({
      where: { id: params.id, store: { organizationId: member.organizationId } },
      include: { apiKeys: { where: { revokedAt: null } } },
    });
    if (!integration) throw new ApiError('not_found', 'Integration not found.');
    await assertStoreAccess({ member, storeId: integration.storeId });

    const previousScopes = integration.apiKeys[0] ? fromJson<string[]>(integration.apiKeys[0].scopes, []) : [];

    const isPublic = integration.provider === 'js_sdk';
    const secret = isPublic ? generatePublicKey() : generateApiKey('live').fullKey;
    const keyHash = hashApiKey(secret);
    const keyPrefix = isPublic ? secret.slice(0, 14) : secret.slice(0, 12);

    await prisma.$transaction([
      prisma.apiKey.updateMany({
        where: { integrationId: integration.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.apiKey.create({
        data: {
          storeId: integration.storeId,
          integrationId: integration.id,
          name: `Rotated ${new Date().toISOString()}`,
          keyPrefix,
          keyHash,
          scopes: toJson(previousScopes),
        },
      }),
    ]);

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'integration.key_rotated',
      targetType: 'Integration',
      targetId: integration.id,
    });

    return ok({ apiKey: secret, keyType: isPublic ? 'public' : 'secret' });
  } catch (error) {
    return fail(error);
  }
}
