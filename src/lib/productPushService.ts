import type { Product, ProductVariant, Inventory } from '@prisma/client';
import { prisma } from './db';
import { toJson, fromJson } from './json';
import { decryptSecret } from './crypto';
import { storeSummary } from './storeService';
import { getConnector } from './connectors';
import { PushVerificationError, type CanonicalProduct, type Connector, type PushProductResult } from './connectors/types';

/**
 * The config a connector's pushProduct/isPushConfigured needs, assembled
 * server-side only — a secret, once decrypted here, is only ever handed to
 * the connector call in the same request; it is never returned from any API
 * route. Not every provider needs both fields (most need neither, since
 * pushProduct itself is undefined for them) — this is deliberately generic
 * rather than shaped around any one connector's specific needs.
 */
async function loadOutboundConfig(integrationId: string): Promise<Record<string, unknown>> {
  const row = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { outboundWebhookUrl: true, outboundWebhookSecretCiphertext: true },
  });
  return {
    outboundWebhookUrl: row?.outboundWebhookUrl ?? null,
    outboundWebhookSecret: row?.outboundWebhookSecretCiphertext ? decryptSecret(row.outboundWebhookSecretCiphertext) : null,
  };
}

interface OutboundCandidate {
  integrationId: string;
  provider: string;
  providerLabel: string;
  connector: Connector;
  config: Record<string, unknown>;
  /** Whether THIS integration instance is actually ready (see Connector.isPushConfigured) — a connector can support push in general while a specific store hasn't set it up yet. */
  configured: boolean;
}

/**
 * Every currently-connected, actively-keyed integration on this store whose
 * connector defines pushProduct at all — "currently connected" reuses the
 * exact same per-integration status the store summary already computes
 * (src/lib/storeService.ts), never a separate calculation. Capability
 * detection is purely `connector.pushProduct` presence — never a hardcoded
 * provider list — so a future connector needs no change here.
 */
async function findOutboundCandidates(storeId: string): Promise<OutboundCandidate[]> {
  const { integrations } = await storeSummary(storeId);
  const candidates: OutboundCandidate[] = [];
  for (const integration of integrations) {
    if (integration.status !== 'connected' || !integration.hasActiveKey) continue;
    const connector = getConnector(integration.provider);
    if (!connector?.pushProduct) continue;
    const config = await loadOutboundConfig(integration.id);
    const configured = connector.isPushConfigured
      ? connector.isPushConfigured({ storeId, integrationId: integration.id, config })
      : true;
    candidates.push({ integrationId: integration.id, provider: integration.provider, providerLabel: integration.providerLabel, connector, config, configured });
  }
  return candidates;
}

interface ResolvedOutboundIntegration {
  integrationId: string;
  provider: string;
  providerLabel: string;
  config: Record<string, unknown>;
  // Bound directly (rather than handing back the whole Connector) so
  // callers get a function TypeScript already knows is defined — Connector
  // itself still declares pushProduct as optional, since most connectors
  // never implement it.
  pushProduct: NonNullable<Connector['pushProduct']>;
}

/**
 * The first connected, actively-keyed, genuinely-configured integration
 * that can perform a real outbound push. If a store somehow has more than
 * one, the first wins; there is no UI to choose among several today.
 */
export async function resolveOutboundIntegration(storeId: string): Promise<ResolvedOutboundIntegration | null> {
  const candidate = (await findOutboundCandidates(storeId)).find((c) => c.configured);
  if (!candidate) return null;
  return {
    integrationId: candidate.integrationId,
    provider: candidate.provider,
    providerLabel: candidate.providerLabel,
    config: candidate.config,
    pushProduct: candidate.connector.pushProduct!.bind(candidate.connector),
  };
}

export interface PushCapability {
  supported: boolean;
  provider?: string;
  providerLabel?: string;
  reason?: string;
}

export async function getPushCapability(storeId: string): Promise<PushCapability> {
  const candidates = await findOutboundCandidates(storeId);
  const ready = candidates.find((c) => c.configured);
  if (ready) return { supported: true, provider: ready.provider, providerLabel: ready.providerLabel };

  const unconfigured = candidates.find((c) => !c.configured);
  if (unconfigured) {
    return {
      supported: false,
      provider: unconfigured.provider,
      providerLabel: unconfigured.providerLabel,
      reason: `${unconfigured.providerLabel} supports outbound product sync, but it isn't configured for this store yet — set a destination URL for it first.`,
    };
  }

  return {
    supported: false,
    reason: 'This connected integration does not currently support outbound product sync.',
  };
}

function toCanonicalProduct(product: Product & { variants: ProductVariant[]; inventory: Inventory | null }): CanonicalProduct {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? undefined,
    price: product.price,
    currency: product.currency,
    images: fromJson<string[]>(product.images, []),
    quantity: product.inventory?.quantity,
    categories: fromJson<string[]>(product.categories, []),
    status: product.status,
    variants: product.variants.map((v) => ({
      name: v.name,
      sku: v.sku ?? undefined,
      price: v.price ?? undefined,
      quantity: v.quantity,
    })),
    attributes: fromJson<Record<string, string | number | boolean>>(product.attributes, {}),
  };
}

export interface PushItemResult {
  productId: string;
  sku: string;
  status: 'pushed' | 'failed' | 'unverifiable' | 'unsupported';
  action?: 'created' | 'updated';
  error?: string;
}

export interface PushBatchResult {
  status: 'processed' | 'partial' | 'failed' | 'unsupported';
  total: number;
  pushed: number;
  updated: number;
  failed: number;
  unverifiable: number;
  results: PushItemResult[];
}

/**
 * Pushes exactly the given product ids (already verified by the caller to
 * belong to `storeId` — this function does not re-check store ownership).
 * Every branch is honest about what actually happened:
 *
 *   - No connector on this store supports outbound push at all: every
 *     product is reported (and persisted) as "unsupported" — never
 *     attempted, never silently marked pushed.
 *   - The connector's pushProduct call resolves: per the Connector
 *     interface's contract, that resolution IS the destination's
 *     confirmation (see PushProductResult / pushProduct doc comments in
 *     connectors/types.ts) — this is what "pushed" means here. This
 *     function does not invent its own separate verification step on top,
 *     since what "confirmed" means is provider-specific (some APIs return
 *     the created object synchronously, others need a follow-up read) —
 *     that belongs inside the connector, not duplicated here.
 *   - The connector throws PushVerificationError: reported as
 *     "unverifiable" (⚠ could not be verified) — deliberately distinct
 *     from a genuine rejection, and never counted as success.
 *   - The connector throws anything else: reported as "failed" (✕), with
 *     the error message surfaced (never a secret — connectors must not put
 *     credentials in their thrown error messages).
 */
export async function pushProducts(params: { storeId: string; productIds: string[] }): Promise<PushBatchResult> {
  const { storeId, productIds } = params;
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId },
    include: { variants: true, inventory: true },
  });

  const resolved = await resolveOutboundIntegration(storeId);

  if (!resolved) {
    const reason = 'No connected integration on this store supports outbound product sync.';
    await prisma.product.updateMany({
      where: { id: { in: products.map((p) => p.id) } },
      data: { pushStatus: 'unsupported', lastPushError: reason },
    });
    return {
      status: 'unsupported',
      total: products.length,
      pushed: 0,
      updated: 0,
      failed: 0,
      unverifiable: 0,
      results: products.map((p) => ({ productId: p.id, sku: p.sku, status: 'unsupported' as const, error: reason })),
    };
  }

  const results: PushItemResult[] = [];
  let pushed = 0;
  let updated = 0;
  let failed = 0;
  let unverifiable = 0;

  for (const product of products) {
    await prisma.product.update({ where: { id: product.id }, data: { pushStatus: 'pushing' } });
    try {
      const canonical = toCanonicalProduct(product);
      const result: PushProductResult = await resolved.pushProduct(canonical, {
        storeId,
        integrationId: resolved.integrationId,
        config: resolved.config,
      });

      await prisma.product.update({
        where: { id: product.id },
        data: { pushStatus: 'pushed', lastPushedAt: new Date(), lastPushError: null, pushDestinationRef: result.destinationRef },
      });
      await prisma.integrationLog.create({
        data: {
          storeId,
          integrationId: resolved.integrationId,
          direction: 'outbound',
          level: 'info',
          message: `Product pushed: ${product.sku} (${result.action})`,
          metadata: toJson({ productId: product.id, destinationRef: result.destinationRef, action: result.action }),
        },
      });

      if (result.action === 'created') pushed++;
      else updated++;
      results.push({ productId: product.id, sku: product.sku, status: 'pushed', action: result.action });
    } catch (error) {
      const isUnverifiable = error instanceof PushVerificationError;
      const message = error instanceof Error ? error.message : 'Push failed.';
      await prisma.product.update({
        where: { id: product.id },
        data: { pushStatus: isUnverifiable ? 'unverifiable' : 'failed', lastPushError: message },
      });
      await prisma.integrationLog.create({
        data: {
          storeId,
          integrationId: resolved.integrationId,
          direction: 'outbound',
          level: 'error',
          message: `Product push ${isUnverifiable ? 'could not be verified' : 'failed'}: ${product.sku}`,
          metadata: toJson({ productId: product.id, error: message }),
        },
      });
      if (isUnverifiable) unverifiable++;
      else failed++;
      results.push({ productId: product.id, sku: product.sku, status: isUnverifiable ? 'unverifiable' : 'failed', error: message });
    }
  }

  const status: PushBatchResult['status'] =
    failed === 0 && unverifiable === 0 ? 'processed' : pushed + updated > 0 ? 'partial' : 'failed';
  return { status, total: products.length, pushed, updated, failed, unverifiable, results };
}

/**
 * Stable "not-yet-successfully-pushed first, pushed last" ordering for the
 * Products page (section 12) — a plain post-query sort rather than a SQL
 * ORDER BY, since "pushed vs everything else" isn't a naturally sortable
 * column value. Stable sort preserves the incoming (createdAt desc) order
 * within each group.
 */
export function sortByPushStatus<T extends { pushStatus: string }>(products: T[]): T[] {
  return [...products].sort((a, b) => (a.pushStatus === 'pushed' ? 1 : 0) - (b.pushStatus === 'pushed' ? 1 : 0));
}
