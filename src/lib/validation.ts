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
