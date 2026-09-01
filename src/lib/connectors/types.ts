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

export interface Connector {
  provider: string;
  label: string;
  /** Whether this connector is wired up to a live integration flow. */
  available: boolean;
  productCapabilities: ProductCapabilities;
  normalizeOrder(raw: unknown): CanonicalOrder;
  normalizeProduct(raw: unknown): CanonicalProduct;
}
