import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/authz';
import { monitoringEventSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { consume } from '@/lib/rateLimit';
import { ingestMonitoringEvent } from '@/lib/monitoring';
import { prisma } from '@/lib/db';

// A connected website/app reports raw occurrences here automatically (via
// the JS SDK's auto-capture, or a backend posting with its secret key) —
// see docs/API_CONTRACTS.md "Monitoring". Like /api/sdk/event, this only
// ever appends diagnostic logging (never mutates orders/products/
// customers), so — same reasoning as that endpoint — it accepts either key
// type (both carry the `read` scope) and opts in to open CORS the way a
// standard error-monitoring beacon would, since a real integration's
// errors can originate from any of the developer's own domains.
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

    const rl = consume(`monitoring:${apiKeyCtx.apiKeyId}`, 120, 60_000);
    if (!rl.allowed) throw new ApiError('rate_limited', 'Too many monitoring events from this key.');

    const body = monitoringEventSchema.parse(await req.json());
    const integration = await prisma.integration.findUnique({ where: { id: apiKeyCtx.integrationId } });
    if (!integration) throw new ApiError('not_found', 'Integration not found for this API key.');
    const store = await prisma.store.findUnique({ where: { id: apiKeyCtx.storeId } });
    if (!store) throw new ApiError('not_found', 'Store not found for this API key.');

    const issue = await ingestMonitoringEvent({
      organizationId: store.organizationId,
      storeId: apiKeyCtx.storeId,
      event: body,
    });

    await prisma.integration.update({
      where: { id: apiKeyCtx.integrationId },
      data: { lastRequestAt: new Date(), status: 'connected' },
    });

    response = ok({ received: true, issueId: issue.id }, 201);
  } catch (error) {
    response = fail(error);
  }
  Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
