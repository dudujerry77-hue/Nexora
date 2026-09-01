import { z } from 'zod';
import { REPORT_TYPES, categoryValuesForType } from './reportCategories';

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

export const createProductSchema = z.object({
  storeId: z.string().min(1),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  price: z.number().int().nonnegative(),
  currency: z.string().length(3).default('NGN'),
  imageUrl: z.string().url().max(500).optional(),
  quantity: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(5),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  price: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().max(500).optional().nullable(),
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
  occurred_at: z.string().optional(),
  data: z.record(z.unknown()),
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

// Diagnostics is a strict allow-list of known-safe fields — zod drops any
// unrecognized key by default (no `.passthrough()`), so even a client bug
// that tried to stuff an API key, webhook secret, or session token into
// this object could never have it reach the database.
export const reportDiagnosticsSchema = z.object({
  route: z.string().max(300).optional(),
  viewportWidth: z.number().int().positive().max(20000).optional(),
  viewportHeight: z.number().int().positive().max(20000).optional(),
  userAgent: z.string().max(500).optional(),
  appVersion: z.string().max(60).optional(),
  errorMessage: z.string().max(4000).optional(),
});

export const createReportSchema = z
  .object({
    type: z.enum(REPORT_TYPES),
    category: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(5000),
    stepsToReproduce: z.string().max(5000).optional(),
    expectedBehavior: z.string().max(2000).optional(),
    actualBehavior: z.string().max(2000).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    storeId: z.string().min(1).max(120).optional(),
    screenshotUrl: z.string().url().max(2000).optional(),
    diagnostics: reportDiagnosticsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!categoryValuesForType(data.type).includes(data.category)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: `Invalid category for a "${data.type}" report.` });
    }
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
