import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  orgName: z.string().min(1).max(160),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createStoreSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(['restaurant', 'fashion', 'retail', 'electronics', 'other']).default('other'),
  logoUrl: z.string().url().max(500).optional(),
});

export const updateStoreSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  logoUrl: z.string().url().max(500).optional().nullable(),
  status: z.enum(['connected', 'warning', 'disconnected']).optional(),
  productMode: z.enum(['nexora_managed', 'developer_owned']).optional(),
});

export const orderItemSchema = z.object({
  sku: z.string().max(64).optional(),
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive(),
  price: z.number().int().nonnegative(),
});

export const createOrderSchema = z.object({
  storeId: z.string().min(1),
  externalId: z.string().min(1).max(120),
  customer: z.object({
    id: z.string().max(120).optional(),
    name: z.string().min(1).max(200),
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
  }),
  items: z.array(orderItemSchema).min(1),
  total: z.number().int().nonnegative(),
  currency: z.string().length(3).default('NGN'),
  status: z.enum(['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled']).optional(),
  deliveryAddress: z.string().max(500).optional(),
});

export const updateOrderSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled']).optional(),
  paymentStatus: z.enum(['unpaid', 'paid', 'refunded']).optional(),
});

// Products (see docs/API_CONTRACTS.md "Products" for the dual product-mode
// design). `attributes` is developer-defined but value-restricted (no
// nested objects/arrays) so a pushed payload can't smuggle arbitrary
// structures — or secrets — into storage under an unbounded key set.
export const productAttributesSchema = z
  .record(z.union([z.string().max(500), z.number(), z.boolean()]))
  .refine((obj) => Object.keys(obj).length <= 30, { message: 'A product may carry at most 30 custom attributes.' });

export const productVariantSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  sku: z.string().max(64).optional(),
  price: z.number().int().nonnegative().optional(),
  quantity: z.number().int().nonnegative().default(0),
});

const productImageSchema = z
  .string()
  .max(2_000_000)
  .refine((v) => /^https?:\/\//.test(v) || /^data:image\//.test(v), {
    message: 'Each image must be an http(s) URL or an uploaded image (data URL).',
  });

export const createProductSchema = z.object({
  storeId: z.string().min(1),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  price: z.number().int().nonnegative(),
  currency: z.string().length(3).default('NGN'),
  imageUrl: z.string().url().max(500).optional(),
  images: z.array(productImageSchema).max(8).optional(),
  categories: z.array(z.string().min(1).max(60)).max(20).optional(),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  attributes: productAttributesSchema.optional(),
  variants: z.array(productVariantSchema).max(50).optional(),
  quantity: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(5),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  price: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().max(500).optional().nullable(),
  images: z.array(productImageSchema).max(8).optional(),
  categories: z.array(z.string().min(1).max(60)).max(20).optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  attributes: productAttributesSchema.optional(),
  variants: z.array(productVariantSchema).max(50).optional(),
});

export const updateInventorySchema = z.object({
  quantity: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
});

export const createIntegrationSchema = z.object({
  storeId: z.string().min(1),
  provider: z.enum(['custom_api', 'custom_webhook', 'js_sdk', 'woocommerce', 'shopify']),
  name: z.string().min(1).max(120).optional(),
  scopes: z.array(z.enum(['read', 'orders:write', 'products:write', 'inventory:write', 'customers:write'])).optional(),
});

export const webhookOrderPayloadSchema = z.object({
  event: z.enum(['order.created', 'order.updated', 'order.cancelled']),
  store_id: z.string().min(1),
  event_id: z.string().min(1),
  occurred_at: z.string().optional(),
  data: z.record(z.unknown()),
});

export const webhookProductPayloadSchema = z.object({
  event: z.enum(['product.created', 'product.updated', 'product.deleted']),
  store_id: z.string().min(1),
  event_id: z.string().min(1),
  // Stricter than the other webhook envelopes' `occurred_at` (plain
  // optional string) — this one is actually compared against
  // Product.sourceUpdatedAt for stale/out-of-order detection, so a
  // malformed value must fail loudly (422) rather than silently becoming
  // an `Invalid Date` that always compares as "not stale".
  occurred_at: z.string().datetime().optional(),
  data: z.record(z.unknown()),
});

// A server-to-server sync payload never needs an embedded data: URL — the
// sender's own system already has these images hosted somewhere with a
// real URL. Unlike productImageSchema (used by the dashboard's own upload
// form, which does need data: URLs for drag/drop and device-picker
// uploads), this channel only accepts http(s) — both to close off an
// unbounded-size vector on an inbound integration path and because a
// backend integration has no legitimate reason to send binary image data.
const webhookProductImageSchema = z.string().max(2000).url().refine((v) => /^https?:\/\//.test(v), {
  message: 'Product images synced via webhook must be an http(s) URL — data: URLs are not accepted on this channel.',
});

// The actual `data` shape for product.created/product.updated/product.deleted
// (src/app/api/webhooks/products/route.ts), validated separately from the
// generic envelope above since the required fields differ per event (a
// delete only needs `sku`). Bounds mirror createProductSchema/
// updateProductSchema exactly, so a webhook-pushed product can't smuggle in
// anything the dashboard's own form wouldn't allow — see the http(s)-only
// image restriction above for the one deliberate difference.
export const webhookProductDataSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  price: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  image_url: z.string().url().max(500).optional(),
  images: z.array(webhookProductImageSchema).max(8).optional(),
  categories: z.array(z.string().min(1).max(60)).max(20).optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  attributes: productAttributesSchema.optional(),
  variants: z.array(productVariantSchema).max(50).optional(),
  quantity: z.number().int().nonnegative().optional(),
});

export const webhookInventoryPayloadSchema = z.object({
  event: z.literal('inventory.updated'),
  store_id: z.string().min(1),
  event_id: z.string().min(1),
  occurred_at: z.string().optional(),
  data: z.object({
    sku: z.string().min(1),
    quantity: z.number().int().nonnegative(),
    low_stock_threshold: z.number().int().nonnegative().optional(),
  }),
});

// Automatic monitoring event ingestion (src/app/api/monitoring/events).
// `diagnostics` is a strict allow-list of known-safe fields — zod drops
// any unrecognized key by default (no `.passthrough()`), so even a client
// bug that tried to stuff an API key, webhook secret, session token, or
// password into this object could never have it reach the database.
export const MONITORING_EVENT_TYPES = ['js_error', 'unhandled_rejection', 'console_error', 'network_error', 'crash'] as const;
export const MONITORING_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;

export const monitoringDiagnosticsSchema = z.object({
  viewportWidth: z.number().int().positive().max(20000).optional(),
  viewportHeight: z.number().int().positive().max(20000).optional(),
  userAgent: z.string().max(500).optional(),
  appVersion: z.string().max(60).optional(),
});

export const monitoringEventSchema = z.object({
  type: z.enum(MONITORING_EVENT_TYPES),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(300).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  severity: z.enum(MONITORING_SEVERITIES).optional(),
  diagnostics: monitoringDiagnosticsSchema.optional(),
});

export const updateMonitoringIssueSchema = z.object({
  status: z.enum(['unresolved', 'resolved', 'ignored']),
});

export const webhookCustomerPayloadSchema = z.object({
  event: z.enum(['customer.created', 'customer.updated']),
  store_id: z.string().min(1),
  event_id: z.string().min(1),
  occurred_at: z.string().optional(),
  data: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
  }),
});
