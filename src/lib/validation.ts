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
  // Products page's main Push control's default behavior for this store —
  // see src/lib/productPushService.ts. Per-store, never global.
  pushDefaultMode: z.enum(['push_all', 'push_selected', 'push']).optional(),
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

// POST /api/products/push — "selected" requires at least one id (an empty
// selection can never push anything, matching the Products page's own
// "select at least one product" rule); "all" ignores productIds entirely
// (the route resolves the full eligible set itself, from the server's own
// data — a client-supplied id list is never trusted for "all").
export const pushProductsSchema = z
  .object({
    storeId: z.string().min(1),
    mode: z.enum(['all', 'selected']),
    productIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .refine((v) => v.mode !== 'selected' || (v.productIds && v.productIds.length > 0), {
    message: 'productIds must be a non-empty array when mode is "selected".',
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

// PATCH /api/integrations/[id] — configures a custom_webhook integration's
// real outbound push destination (src/lib/connectors/nexoraNative.ts). Only
// http(s) is accepted (never e.g. file:// or an internal-only scheme) —
// `.url()` alone doesn't rule out something like `javascript:`, so this
// mirrors the same http(s)-only restriction already used for product
// images/logos elsewhere in this file. `null` clears the configured
// destination (and its secret) entirely.
export const updateIntegrationSchema = z.object({
  outboundWebhookUrl: z
    .string()
    .url()
    .max(500)
    .refine((v) => /^https?:\/\//.test(v), { message: 'Outbound webhook URL must be an http(s) URL.' })
    .nullable(),
});

export const webhookOrderPayloadSchema = z.object({
  event: z.enum(['order.created', 'order.updated', 'order.cancelled']),
  store_id: z.string().min(1),
  event_id: z.string().min(1),
  occurred_at: z.string().optional(),
  data: z.record(z.unknown()),
});

export const webhookProductPayloadSchema = z.object({
  event: z.enum(['product.created', 'product.updated', 'product.deleted', 'product.sync']),
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

// Phase 1 batch catalog sync (product.sync). MAX_PRODUCT_SYNC_BATCH_SIZE is
// the one named constant governing batch size — referenced by the route,
// the rate limiter's cost calculation, and tests, so it's never duplicated
// as a bare number anywhere.
//
// Sized so it's mathematically guaranteed to fit under MAX_WEBHOOK_BODY_BYTES
// (webhookAuth.ts) even in the worst case — not just typical usage. A
// post-launch audit found the original value of 300 could reach ~14.7MB
// with every field at its schema maximum using single-byte characters;
// re-measuring with 3-byte-per-character filler (representative of
// CJK/Cyrillic/Arabic script — this app places no ASCII-only restriction
// on product names/descriptions, so a fully non-Latin-script batch is a
// legitimate case, not an edge case) puts one maximally-sized item at
// ~101,761 bytes. 40 * 101,761 ≈ 4.07MB, ~18% under the 5MB cap — so any
// batch that validates against this limit can never be surprised by the
// body-size check afterward. See "reconciles batch size against the
// body-size limit" in tests/productSync.test.ts, which re-derives this
// bound directly from the schema rather than trusting this comment to
// stay accurate as either constant changes.
export const MAX_PRODUCT_SYNC_BATCH_SIZE = 40;

// One item inside a product.sync batch. Field bounds are identical to
// webhookProductDataSchema above (same dashboard-equivalent limits,
// including the http(s)-only image restriction) plus `action` and a
// per-item `occurred_at` for this specific item's own staleness check —
// the top-level envelope's `occurred_at` is not used for batch items.
export const productSyncItemSchema = z.object({
  sku: z.string().min(1).max(64),
  action: z.enum(['upsert', 'delete']).default('upsert'),
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
  occurred_at: z.string().datetime().optional(),
});

// Whole-request shape check only — deliberately NOT z.array(productSyncItemSchema).
// Validating every item as part of one array schema would make a single bad
// item fail the entire parse, discarding every valid sibling with it. Each
// item is instead parsed independently, one at a time, inside
// syncProductBatch() (src/lib/productService.ts) so one bad item can only
// ever produce its own "failed" result.
export const productSyncBatchShapeSchema = z.object({
  products: z.array(z.unknown()).min(1).max(MAX_PRODUCT_SYNC_BATCH_SIZE),
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
