export interface CanonicalOrderItem {
  sku?: string;
  name: string;
  quantity: number;
  price: number;
}

export interface CanonicalOrder {
  externalId: string;
  customerName: string;
  customerExternalId?: string;
  items: CanonicalOrderItem[];
  total: number;
  currency: string;
  status?: string;
  deliveryAddress?: string;
}

export interface CanonicalProductVariant {
  name: string;
  sku?: string;
  price?: number;
  quantity?: number;
}

export interface CanonicalProduct {
  sku: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  /** First entry is the cover image. May be http(s) URLs or data: URLs. */
  images?: string[];
  quantity?: number;
  categories?: string[];
  status?: string;
  variants?: CanonicalProductVariant[];
  /** Developer-defined extra fields — primitive values only, see validation.ts. */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * What a connector's own product shape can actually carry — lets the
 * Products UI show/hide fields per integration instead of pretending every
 * platform exposes the same structure. See docs/API_CONTRACTS.md
 * "Products" for the adapter model this supports.
 */
export interface ProductCapabilities {
  images: boolean;
  variants: boolean;
  categories: boolean;
  customFields: boolean;
}

/**
 * Thrown by a connector's pushProduct when the request may or may not have
 * succeeded but the destination's acceptance could not be confirmed (e.g. a
 * timeout, or a provider with no read-back/verification path) — distinct
 * from a genuine rejection. Orchestration (productPushService.ts) reports
 * this as "could not be verified", never as success and never identically
 * to an outright failure.
 */
export class PushVerificationError extends Error {}

/** What pushProduct returns after the destination has genuinely confirmed the write. */
export interface PushProductResult {
  /** An opaque identifier the destination assigned/confirmed for this product — never a secret. */
  destinationRef: string;
  /** Whether the destination reports this as a brand-new record or an update to one that already existed there. */
  action: 'created' | 'updated';
}

/**
 * Credentials/config needed to actually call the destination for a push —
 * deliberately narrow (never the full Integration/ApiKey row) so a
 * connector can't accidentally leak more than it needs. See
 * src/lib/productPushService.ts for how this is assembled server-side only.
 */
export interface PushProductContext {
  storeId: string;
  integrationId: string;
  config: Record<string, unknown>;
}

export interface Connector {
  provider: string;
  label: string;
  /** Whether this connector is wired up to a live integration flow. */
  available: boolean;
  productCapabilities: ProductCapabilities;
  normalizeOrder(raw: unknown): CanonicalOrder;
  normalizeProduct(raw: unknown): CanonicalProduct;
  /**
   * Real outbound "create/update this product on the destination
   * website/app" call — optional because most providers here are
   * inbound-only (the developer's system calls Nexora, not the other way
   * around) and have no destination to call. Its mere presence is the
   * capability flag the Products page's Push UI gates on (see
   * src/lib/productPushService.ts:resolveOutboundIntegration) — never
   * hardcode which providers "support push" anywhere else. A real
   * implementation must only resolve once the destination has confirmed
   * the write (see PushProductResult) — never resolve on a merely-sent
   * request.
   */
  pushProduct?(product: CanonicalProduct, context: PushProductContext): Promise<PushProductResult>;
}
