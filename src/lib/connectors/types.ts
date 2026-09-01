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

export interface CanonicalProduct {
  sku: string;
  name: string;
  price: number;
  currency: string;
  imageUrl?: string;
  quantity?: number;
}

export interface Connector {
  provider: string;
  label: string;
  /** Whether this connector is wired up to a live integration flow. */
  available: boolean;
  normalizeOrder(raw: unknown): CanonicalOrder;
  normalizeProduct(raw: unknown): CanonicalProduct;
}
