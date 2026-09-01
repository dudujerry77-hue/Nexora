import { Connector } from './types';

// STUB CONNECTOR — documents the intended field mapping only.
//
// This connector is intentionally NOT wired to a live WooCommerce webhook
// or OAuth flow. `available: false` causes it to be filtered out of
// `GET /api/integrations` creation options and surfaced as "planned" in the
// dashboard, per the project's rule against faking functionality that only
// looks connected. A real implementation would:
//
//   1. Exchange a WooCommerce REST API consumer key/secret via OAuth1.0a.
//   2. Register `order.created`/`order.updated` topics against
//      WooCommerce's Webhooks API, pointed at /api/webhooks/orders.
//   3. Map WooCommerce's `line_items[]` -> CanonicalOrderItem, and
//      `billing.first_name + billing.last_name` -> customerName.
export const woocommerceConnector: Connector = {
  provider: 'woocommerce',
  label: 'WooCommerce (planned)',
  available: false,
  // WooCommerce products carry images[], variable-product variations,
  // categories[], and arbitrary meta_data — a real implementation would
  // have plenty to map onto every Nexora product field.
  productCapabilities: { images: true, variants: true, categories: true, customFields: true },
  normalizeOrder(raw) {
    const data = raw as Record<string, unknown>;
    const billing = (data.billing ?? {}) as Record<string, unknown>;
    const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
    return {
      externalId: String(data.id ?? ''),
      customerName: [billing.first_name, billing.last_name].filter(Boolean).join(' ') || 'Unknown customer',
      items: lineItems.map((item) => {
        const i = item as Record<string, unknown>;
        return {
          sku: i.sku ? String(i.sku) : undefined,
          name: String(i.name ?? 'Item'),
          quantity: Number(i.quantity ?? 1),
          price: Number(i.price ?? 0),
        };
      }),
      total: Number(data.total ?? 0),
      currency: String(data.currency ?? 'NGN'),
      status: data.status ? String(data.status) : undefined,
    };
  },
  normalizeProduct(raw) {
    const data = raw as Record<string, unknown>;
    const images = Array.isArray(data.images)
      ? (data.images as Record<string, unknown>[]).map((img) => String(img.src ?? '')).filter(Boolean)
      : undefined;
    const categories = Array.isArray(data.categories)
      ? (data.categories as Record<string, unknown>[]).map((c) => String(c.name ?? ''))
      : undefined;
    return {
      sku: String(data.sku ?? ''),
      name: String(data.name ?? ''),
      description: data.description ? String(data.description) : undefined,
      price: Number(data.price ?? 0),
      currency: 'NGN',
      images,
      categories,
    };
  },
};
