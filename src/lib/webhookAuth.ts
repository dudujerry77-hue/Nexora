import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from './db';
import { ApiError } from './errors';
import { requireApiKey, ApiKeyContext } from './authz';
import { verifyWebhookSignature } from './webhookSignature';
import { decryptSecret } from './crypto';
import { consume } from './rateLimit';
import { toJson } from './json';
import type { ApiKeyScope } from './apiKey';

export interface WebhookEnvelope {
  event: string;
  store_id: string;
  event_id: string;
  occurred_at?: string;
  data: unknown;
}

export interface WebhookContext<T extends WebhookEnvelope> {
  envelope: T;
  storeId: string;
  integrationId: string | null;
  apiKey: ApiKeyContext | null;
  isDuplicate: boolean;
}

const envelopeShapeSchema = z.object({
  event: z.string(),
  store_id: z.string().min(1),
  event_id: z.string().min(1),
  occurred_at: z.string().optional(),
  data: z.unknown(),
});

async function findWebhookIntegration(storeId: string) {
  return prisma.integration.findFirst({
    where: { storeId, provider: { in: ['custom_api', 'custom_webhook'] } },
    orderBy: { createdAt: 'asc' },
  });
}

async function logInbound(params: {
  storeId: string;
  integrationId: string | null;
  level: 'info' | 'warning' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.integrationLog.create({
    data: {
      storeId: params.storeId,
      integrationId: params.integrationId,
      direction: 'inbound',
      level: params.level,
      message: params.message,
      metadata: toJson(params.metadata ?? {}),
    },
  });
}

/**
 * Shared entry point for every /api/webhooks/* route: authenticates the
 * request (API key OR HMAC signature), validates the envelope shape,
 * enforces per-store rate limiting, and records idempotency via the
 * WebhookEvent unique (storeId, eventId) index — see docs/WEBHOOKS.md.
 */
export async function authenticateAndDedupeWebhook<T extends WebhookEnvelope>(
  req: NextRequest,
  schema: z.ZodType<T>,
  requiredScope: ApiKeyScope,
): Promise<WebhookContext<T>> {
  const rawBody = await req.text();

  let envelope: T;
  try {
    envelope = schema.parse(JSON.parse(rawBody));
  } catch {
    throw new ApiError('validation_error', 'Malformed webhook payload.');
  }
  envelopeShapeSchema.parse(envelope);

  const authHeader = req.headers.get('authorization');
  let storeId: string;
  let integrationId: string | null = null;
  let apiKey: ApiKeyContext | null = null;

  if (authHeader) {
    // Re-parse the header manually since requireApiKey doesn't consume the body.
    const fakeReq = req; // headers only are used by requireApiKey
    apiKey = await requireApiKey(fakeReq, requiredScope);
    if (apiKey.storeId !== envelope.store_id) {
      throw new ApiError('forbidden', 'API key is not authorized for this store.');
    }
    storeId = apiKey.storeId;
    integrationId = apiKey.integrationId;
  } else {
    const signatureHeader = req.headers.get('x-nexora-signature');
    const timestampHeader = req.headers.get('x-nexora-timestamp');

    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { storeId: envelope.store_id },
      orderBy: { createdAt: 'desc' },
    });
    if (!endpoint) {
      throw new ApiError('unauthorized', 'No webhook secret configured for this store.');
    }

    const secret = decryptSecret(endpoint.secretCiphertext);
    const verification = verifyWebhookSignature({ secret, timestampHeader, signatureHeader, rawBody });
    if (!verification.valid) {
      await logInbound({
        storeId: envelope.store_id,
        integrationId: null,
        level: 'error',
        message: `Rejected webhook: invalid signature (${verification.reason}).`,
      });
      throw new ApiError('invalid_signature', 'Webhook signature verification failed.');
    }
    storeId = envelope.store_id;
    const integration = await findWebhookIntegration(storeId);
    integrationId = integration?.id ?? null;
  }

  const rl = consume(`webhook:${storeId}`, 60, 60_000);
  if (!rl.allowed) {
    await logInbound({ storeId, integrationId, level: 'warning', message: 'Rate limited.' });
    throw new ApiError('rate_limited', 'Too many webhook requests for this store.');
  }

  // Idempotency: the unique (storeId, eventId) index is the source of
  // truth. We insert first, then branch on whether it already existed.
  let isDuplicate = false;
  try {
    await prisma.webhookEvent.create({
      data: {
        storeId,
        eventId: envelope.event_id,
        eventType: envelope.event,
        payload: rawBody,
        status: 'received',
      },
    });
  } catch (error) {
    const isUniqueViolation =
      typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
    if (!isUniqueViolation) throw error;
    isDuplicate = true;
    await logInbound({
      storeId,
      integrationId,
      level: 'info',
      message: `Duplicate webhook event ignored: ${envelope.event_id}.`,
      metadata: { event: envelope.event },
    });
  }

  if (integrationId) {
    await prisma.integration.update({
      where: { id: integrationId },
      data: { lastWebhookAt: new Date(), status: 'connected', failedRequestCount: 0 },
    });
  }

  return { envelope, storeId, integrationId, apiKey, isDuplicate };
}

export async function markWebhookProcessed(storeId: string, eventId: string) {
  await prisma.webhookEvent.updateMany({ where: { storeId, eventId }, data: { status: 'processed' } });
}

export async function markWebhookFailed(params: {
  storeId: string;
  eventId: string;
  integrationId: string | null;
  error: unknown;
}) {
  await prisma.webhookEvent.updateMany({
    where: { storeId: params.storeId, eventId: params.eventId },
    data: { status: 'failed' },
  });
  await logInbound({
    storeId: params.storeId,
    integrationId: params.integrationId,
    level: 'error',
    message: `Webhook processing failed: ${params.error instanceof Error ? params.error.message : String(params.error)}`,
  });
  if (params.integrationId) {
    await prisma.integration.update({
      where: { id: params.integrationId },
      data: { failedRequestCount: { increment: 1 } },
    });
  }
}
