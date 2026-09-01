import { Connector } from './types';

// The three implemented MVP integration paths (custom_api, custom_webhook,
// js_sdk) all speak Nexora's own canonical payload shape already — see
// docs/WEBHOOKS.md. This connector is effectively an identity mapping with
// light shape validation before it reaches the shared handler.

function makeNativeConnector(provider: string, label: string): Connector {
  return {
    provider,
    label,
    available: true,
    normalizeOrder(raw) {
      const data = raw as Record<string, unknown>;
      const customer = (data.customer ?? {}) as Record<string, unknown>;
      const items = Array.isArray(data.items) ? data.items : [];
      return {
        externalId: String(data.id ?? ''),
        customerName: String(customer.name ?? 'Unknown customer'),
        customerExternalId: customer.id ? String(customer.id) : undefined,
        items: items.map((item) => {
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
        deliveryAddress: data.delivery_address ? String(data.delivery_address) : undefined,
      };
    },
    normalizeProduct(raw) {
      const data = raw as Record<string, unknown>;
      return {
        sku: String(data.sku ?? ''),
        name: String(data.name ?? ''),
        price: Number(data.price ?? 0),
        currency: String(data.currency ?? 'NGN'),
        imageUrl: data.image_url ? String(data.image_url) : undefined,
        quantity: data.quantity !== undefined ? Number(data.quantity) : undefined,
      };
    },
  };
}

export const customApiConnector = makeNativeConnector('custom_api', 'Nexora API');
export const customWebhookConnector = makeNativeConnector('custom_webhook', 'Nexora Webhooks');
export const jsSdkConnector = makeNativeConnector('js_sdk', 'Nexora JavaScript SDK');
