import { Connector } from './types';

// STUB CONNECTOR — documents the intended field mapping only. See the
// equivalent note in woocommerce.ts; the same "not wired to a live
// integration" rule applies. A real implementation would use Shopify's
// Admin API OAuth flow and register `orders/create` / `orders/updated`
// webhook topics, verifying `X-Shopify-Hmac-Sha256` instead of Nexora's own
// signature scheme.
export const shopifyConnector: Connector = {
  provider: 'shopify',
  label: 'Shopify (planned)',
  available: false,
  normalizeOrder(raw) {
    const data = raw as Record<string, unknown>;
    const customer = (data.customer ?? {}) as Record<string, unknown>;
    const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
    return {
      externalId: String(data.id ?? data.order_number ?? ''),
      customerName:
        [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown customer',
      items: lineItems.map((item) => {
        const i = item as Record<string, unknown>;
        return {
          sku: i.sku ? String(i.sku) : undefined,
          name: String(i.name ?? i.title ?? 'Item'),
          quantity: Number(i.quantity ?? 1),
          price: Number(i.price ?? 0),
        };
      }),
      total: Number(data.total_price ?? 0),
      currency: String(data.currency ?? 'USD'),
    };
  },
  normalizeProduct(raw) {
    const data = raw as Record<string, unknown>;
    const variants = Array.isArray(data.variants) ? data.variants : [{}];
    const firstVariant = (variants[0] ?? {}) as Record<string, unknown>;
    return {
      sku: String(firstVariant.sku ?? ''),
      name: String(data.title ?? ''),
      price: Number(firstVariant.price ?? 0),
      currency: 'USD',
      imageUrl: undefined,
    };
  },
};
