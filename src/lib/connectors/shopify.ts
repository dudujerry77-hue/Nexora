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
  // Shopify's product model is built around variants (every product has
  // at least one), images[], product_type/tags for categorization, and
  // metafields for custom data.
  productCapabilities: { images: true, variants: true, categories: true, customFields: true },
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
    const rawVariants = Array.isArray(data.variants) ? data.variants : [{}];
    const firstVariant = (rawVariants[0] ?? {}) as Record<string, unknown>;
    const images = Array.isArray(data.images)
      ? (data.images as Record<string, unknown>[]).map((img) => String(img.src ?? '')).filter(Boolean)
      : undefined;
    const variants = rawVariants.length > 1
      ? rawVariants.map((v) => {
          const variant = v as Record<string, unknown>;
          return {
            name: String(variant.title ?? ''),
            sku: variant.sku ? String(variant.sku) : undefined,
            price: variant.price !== undefined ? Number(variant.price) : undefined,
            quantity: variant.inventory_quantity !== undefined ? Number(variant.inventory_quantity) : undefined,
          };
        })
      : undefined;
    return {
      sku: String(firstVariant.sku ?? ''),
      name: String(data.title ?? ''),
      description: data.body_html ? String(data.body_html) : undefined,
      price: Number(firstVariant.price ?? 0),
      currency: 'USD',
      images,
      categories: data.product_type ? [String(data.product_type)] : undefined,
      variants,
    };
  },
};
