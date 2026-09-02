import { Connector, CanonicalProduct, PushProductContext, PushProductResult, PushVerificationError } from './types';
import { signWebhookBody } from '../webhookSignature';

// The three implemented MVP integration paths (custom_api, custom_webhook,
// js_sdk) all speak Nexora's own canonical payload shape already — see
// docs/WEBHOOKS.md. This connector is effectively an identity mapping with
// light shape validation before it reaches the shared handler.

function makeNativeConnector(provider: string, label: string): Connector {
  return {
    provider,
    label,
    available: true,
    // Nexora's own payload shape supports every field the Products model
    // has, since it IS the canonical shape everything else maps onto.
    productCapabilities: { images: true, variants: true, categories: true, customFields: true },
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
      const images = Array.isArray(data.images)
        ? data.images.map(String)
        : data.image_url
          ? [String(data.image_url)]
          : undefined;
      const variants = Array.isArray(data.variants)
        ? data.variants.map((v) => {
            const variant = v as Record<string, unknown>;
            return {
              name: String(variant.name ?? ''),
              sku: variant.sku ? String(variant.sku) : undefined,
              price: variant.price !== undefined ? Number(variant.price) : undefined,
              quantity: variant.quantity !== undefined ? Number(variant.quantity) : undefined,
            };
          })
        : undefined;
      const attributes =
        data.attributes && typeof data.attributes === 'object'
          ? (data.attributes as Record<string, string | number | boolean>)
          : undefined;

      return {
        sku: String(data.sku ?? ''),
        name: String(data.name ?? ''),
        description: data.description ? String(data.description) : undefined,
        price: Number(data.price ?? 0),
        currency: String(data.currency ?? 'NGN'),
        images,
        quantity: data.quantity !== undefined ? Number(data.quantity) : undefined,
        categories: Array.isArray(data.categories) ? data.categories.map(String) : undefined,
        status: data.status ? String(data.status) : undefined,
        variants,
        attributes,
      };
    },
  };
}

export const customApiConnector = makeNativeConnector('custom_api', 'Nexora API');
export const jsSdkConnector = makeNativeConnector('js_sdk', 'Nexora JavaScript SDK');

// Real outbound push (Phase 2) — custom_webhook is the one provider whose
// whole concept is "Nexora talks to a URL the merchant controls", so it's
// also the natural fit for the reverse direction: the merchant configures a
// receiving URL (PATCH /api/integrations/[id]) and Nexora signs each push
// exactly like an inbound webhook, just reversed (see signWebhookBody /
// verifyWebhookSignature in ../webhookSignature.ts — the destination is
// expected to verify the signature the same way Nexora's own inbound
// webhook routes do). The destination must respond 200 with
// `{ status: "ok", action: "created" | "updated", productRef? }` to count
// as a genuinely confirmed push — anything else (non-2xx, unparseable
// body, missing/invalid status or action, or the request never landing at
// all) is reported honestly as failed or unverifiable, never as success.
const OUTBOUND_PUSH_TIMEOUT_MS = 10_000;

function isCustomWebhookPushConfigured(context: PushProductContext): boolean {
  return typeof context.config.outboundWebhookUrl === 'string' && context.config.outboundWebhookUrl.length > 0;
}

async function pushProductViaCustomWebhook(product: CanonicalProduct, context: PushProductContext): Promise<PushProductResult> {
  const url = context.config.outboundWebhookUrl as string | undefined;
  const secret = context.config.outboundWebhookSecret as string | undefined;
  if (!url || !secret) {
    throw new Error('Outbound webhook is not configured for this integration — set a destination URL first.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({ event: 'product.push', data: product });
  const signature = signWebhookBody(secret, timestamp, rawBody);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nexora-signature': signature,
        'x-nexora-timestamp': String(timestamp),
      },
      body: rawBody,
      signal: AbortSignal.timeout(OUTBOUND_PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failure/timeout — we genuinely don't know whether the
    // destination received and acted on this before the connection died.
    throw new PushVerificationError(
      `Could not reach the destination webhook: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  if (!response.ok) {
    let message = `Destination responded with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      // Non-JSON error body — keep the generic HTTP-status message.
    }
    throw new Error(message);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PushVerificationError('Destination returned a 2xx response but no parseable confirmation body.');
  }

  const parsed = body as { status?: string; action?: string; productRef?: string };
  if (parsed.status !== 'ok') {
    throw new PushVerificationError('Destination response did not confirm acceptance (expected status: "ok").');
  }
  if (parsed.action !== 'created' && parsed.action !== 'updated') {
    throw new PushVerificationError(
      'Destination confirmed acceptance but did not specify whether the product was created or updated.',
    );
  }

  return { destinationRef: parsed.productRef ?? product.sku, action: parsed.action };
}

export const customWebhookConnector: Connector = {
  ...makeNativeConnector('custom_webhook', 'Nexora Webhooks'),
  isPushConfigured: isCustomWebhookPushConfigured,
  pushProduct: pushProductViaCustomWebhook,
};
