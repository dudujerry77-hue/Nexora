import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { pushProductsSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { consume } from '@/lib/rateLimit';
import { assertNexoraManagedProductWrites } from '@/lib/productService';
import { storeSummary } from '@/lib/storeService';
import { getPushCapability, pushProducts, MAX_PUSH_ALL_BATCH_SIZE, PRODUCT_PUSH_ITEMS_PER_MINUTE } from '@/lib/productPushService';
import { createNotification } from '@/lib/notifications';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

// GET ?storeId=... — capability check the Products page uses to decide
// whether to show a real Push control or the honest "unsupported" state.
// Session-only (dashboard concern, not part of any external API-key
// contract) and store-scoped like every other store-owned resource here.
export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');
    if (!storeId) throw new ApiError('validation_error', 'storeId is required.');

    const store = await assertStoreAccess({ member, storeId, permission: 'view_products' });
    // A developer-owned store never gets dashboard push controls at all —
    // no ambiguity to report either way.
    assertNexoraManagedProductWrites(store);

    const capability = await getPushCapability(store.id);
    return ok(capability);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const body = pushProductsSchema.parse(await req.json());
    const store = await assertStoreAccess({ member, storeId: body.storeId, permission: 'manage_products' });
    // Same ownership rule as creating/editing products — a developer-owned
    // store's catalog is never written to via the dashboard, and pushing
    // is a dashboard-only write concern (the developer's own system is
    // already the source of truth there, so there is nothing for a
    // Nexora-initiated "push" to mean for it).
    assertNexoraManagedProductWrites(store);

    // Same canonical connected-store gate as product creation (see
    // assertStoreEligibleForProductCreation) — outbound push must be
    // blocked whenever the store isn't connected, matching section 15.
    const { status } = await storeSummary(store.id);
    if (status !== 'connected') {
      throw new ApiError('forbidden', 'This store has no successfully connected integration — outbound push is unavailable.');
    }

    let productIds: string[];
    let truncated = false;
    let totalEligible: number;
    if (body.mode === 'all') {
      // "Push All" must never execute an unbounded catalog in one request
      // — see MAX_PUSH_ALL_BATCH_SIZE in productPushService.ts. Oldest
      // first, so repeated invocations systematically work through the
      // whole backlog rather than repeatedly re-picking the same items.
      const [allIds, eligibleCount] = await Promise.all([
        prisma.product.findMany({ where: { storeId: store.id }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: MAX_PUSH_ALL_BATCH_SIZE }),
        prisma.product.count({ where: { storeId: store.id } }),
      ]);
      productIds = allIds.map((p) => p.id);
      totalEligible = eligibleCount;
      truncated = eligibleCount > MAX_PUSH_ALL_BATCH_SIZE;
    } else {
      // Store isolation: only ids that actually belong to THIS store are
      // used — a client-supplied id for a different store (this org's or
      // another org's) is silently excluded, never pushed under the
      // authenticated store's identity.
      const owned = await prisma.product.findMany({
        where: { id: { in: body.productIds ?? [] }, storeId: store.id },
        select: { id: true },
      });
      productIds = owned.map((p) => p.id);
      totalEligible = productIds.length;
    }

    if (productIds.length === 0) {
      throw new ApiError('validation_error', 'No eligible products to push for this store.');
    }

    // Rate-limited by item count (same consume() token-bucket already used
    // for inbound catalog-sync traffic — see PRODUCT_PUSH_ITEMS_PER_MINUTE)
    // so "Push All" can't bypass the limit merely by requesting a large
    // batch; the batch cap above already bounds it further, but the two
    // protections are independent (this one stops rapid repeated requests,
    // not just oversized single ones). Charged after every authorization/
    // eligibility check and before any outbound network request.
    const rl = consume(`product-push:${store.id}`, PRODUCT_PUSH_ITEMS_PER_MINUTE, 60_000, productIds.length);
    if (!rl.allowed) {
      throw new ApiError('rate_limited', 'Too many product pushes requested for this store right now — try again shortly.');
    }

    const result = await pushProducts({ storeId: store.id, productIds });

    const succeeded = result.pushed + result.updated;
    const hasIssues = result.failed > 0 || result.unverifiable > 0 || result.status === 'unsupported';
    const summary =
      result.status === 'unsupported'
        ? `Product push skipped for ${store.name}: no connected integration supports outbound sync.`
        : hasIssues
          ? `Product push for ${store.name}: ${succeeded} succeeded, ${result.failed} failed, ${result.unverifiable} could not be verified.`
          : `${succeeded} product${succeeded === 1 ? '' : 's'} pushed to ${store.name}.`;

    await createNotification({
      organizationId: member.organizationId,
      storeId: store.id,
      type: 'product.push',
      title: hasIssues ? 'Product push had issues' : 'Products pushed',
      body: summary,
      severity: hasIssues ? 'warning' : 'info',
    });

    // truncated/totalEligible only ever apply to "all" mode — "selected"
    // always processes exactly the ids the caller supplied (already capped
    // at 500 by pushProductsSchema), so truncated is always false there.
    return ok({ ...result, truncated, totalEligible });
  } catch (error) {
    return fail(error);
  }
}
