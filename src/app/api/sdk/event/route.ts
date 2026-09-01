import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiKey } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { consume } from '@/lib/rateLimit';
import { ApiError } from '@/lib/errors';
import { toJson } from '@/lib/json';

// Receives the Nexora JS SDK's client-side, safe-only events (page views,
// lightweight identify calls). By design this endpoint only accepts the
// `read`-scoped public key (see docs/INTEGRATIONS.md) and never writes
// orders/products/customers — a leaked public key can only ever generate
// log noise, never forge business data.
const eventSchema = z.object({
  type: z.enum(['page_view', 'identify']),
  payload: z.record(z.unknown()).optional(),
});

// The SDK runs on a store owner's own website — a different origin than
// this API — so this one public-key-only, read-scoped endpoint opts in to
// cross-origin requests explicitly, the way a standard analytics beacon
// endpoint would.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  let response: NextResponse;
  try {
    const apiKeyCtx = await requireApiKey(req, 'read');

    const rl = consume(`sdk:${apiKeyCtx.apiKeyId}`, 120, 60_000);
    if (!rl.allowed) throw new ApiError('rate_limited', 'Too many SDK events from this key.');

    const body = eventSchema.parse(await req.json());

    await prisma.integrationLog.create({
      data: {
        storeId: apiKeyCtx.storeId,
        integrationId: apiKeyCtx.integrationId,
        direction: 'inbound',
        level: 'info',
        message: `SDK event: ${body.type}`,
        metadata: toJson(body.payload ?? {}),
      },
    });
    await prisma.integration.update({
      where: { id: apiKeyCtx.integrationId },
      data: { lastRequestAt: new Date(), status: 'connected' },
    });

    response = ok({ received: true });
  } catch (error) {
    response = fail(error);
  }
  Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
