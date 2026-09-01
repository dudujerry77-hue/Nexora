# Integration Architecture

Nexora supports exactly three MVP integration paths, per the project's own
anti-overreach rule. Nothing else is claimed to work.

## 1. Nexora API (custom websites/apps you control)

Your backend calls Nexora's REST API directly with a store-scoped API key:

```
Store Backend --HTTPS, Authorization: Bearer nx_live_xxx--> POST /api/orders
```

Use this when you already have a backend and want to push orders/products
directly rather than wait for a webhook-shaped event.

## 2. Nexora Webhooks (real-time events, any backend)

Your backend sends signed HTTP callbacks to Nexora whenever something
happens on your side — see `docs/WEBHOOKS.md` for the full contract.

```
Store Backend --HMAC-signed POST--> /api/webhooks/{orders|products|inventory|customers}
```

This is the recommended path for "push me events as they happen" and is
what the dashboard's real-time notification feed is built around.

## 3. Nexora JavaScript SDK (websites you control)

A small script (`public/sdk/nexora.js`) for client-side, safe operations
only:

```html
<script src="https://your-nexora-host/sdk/nexora.js"></script>
<script>
  Nexora.init({ storeId: "store_123", publicKey: "nx_public_xxxxx" });
  Nexora.trackPageView();
  Nexora.identify({ email: "shopper@example.com" });
</script>
```

**By design, the SDK cannot create orders.** A `publicKey` is intentionally
low-privilege (rate-limited, write-scope-free) so that even if it leaks in
page source — which it will, being client-side — it cannot be used to
forge orders, alter inventory, or read another store's data. Order creation
must go through the store's own backend using the full-privilege API key
(path 1 or 2 above). This is stated explicitly in the SDK's own README
(`public/sdk/README.md`) and enforced server-side: the `/api/webhooks/*`
and order-write paths reject public-key auth.

## Connector registry (how a 4th platform gets added later)

```ts
// src/lib/connectors/index.ts
export interface Connector {
  provider: string;                 // e.g. "shopify"
  normalizeOrder(raw: unknown): CanonicalOrder;
  normalizeProduct(raw: unknown): CanonicalProduct;
  verifySignature(req: NormalizedRequest, secret: string): boolean;
}
```

Each connector is one file under `src/lib/connectors/`, registered in
`connectorRegistry`. The webhook/API layer resolves
`connectorRegistry[integration.provider]` and calls its `normalize*`
methods — no other code needs to know a new platform exists. This repo
ships:

- `custom_api`, `custom_webhook`, `js_sdk` — fully implemented (the MVP).
- `woocommerce`, `shopify` — **stub connectors** that document the intended
  field mapping and are marked `status: "planned"` everywhere they surface
  in the UI/API (`GET /api/integrations` returns `available: false` for
  them). They are not wired to any live OAuth flow or webhook secret
  exchange — enabling them for real is future work, not part of this MVP.

## Android integration architecture (documented, SDK not yet built)

Nexora does not — and, respecting the Android application sandbox, cannot —
reach into a third-party Android app directly. The supported architecture
mirrors the website path:

```
Android Shopping App
        |  (in-app checkout / order flow)
        v
Store's own backend  (the developer's server, e.g. api.mystore.com)
        |  (HTTPS, Nexora API key or signed webhook — same contracts as above)
        v
Nexora API
```

A dedicated **Nexora Android SDK** (Kotlin, wrapping the same REST/webhook
contracts with retry + offline queuing) is planned but not implemented in
this MVP; the Integrations page marks it `status: "planned"` rather than
pretending an SDK artifact exists.

## Connection health

Each `Integration` tracks `lastRequestAt`, `lastWebhookAt`, `lastSyncAt`,
and a rolling `failedRequestCount`. Status is derived, not manually set:

- **Connected** — a successful request/webhook within the last 24h.
- **Warning** — nothing successful in 24h, or failures present, but not
  yet 72h silent.
- **Disconnected** — silent for 72h+, or manually disconnected.

See `src/lib/integrations.ts:computeStatus`.

## Product ownership modes

Every `Store` has a `productMode`:

- **`nexora_managed`** (default) — products are created and edited
  directly in the Nexora dashboard (Products page). This is the right
  choice for a developer who doesn't already have a product catalog and
  wants Nexora to be it.
- **`developer_owned`** — the developer's own system already owns the
  product catalog. Nexora doesn't force them to recreate it: products flow
  in through the *same* inbound paths orders already use — `POST
  /api/products` (path 1) or `POST /api/webhooks/products` (path 2). The
  Products page becomes read-only for that store, showing exactly what was
  pushed in.

Nexora deliberately never reaches out to "pull" from a developer's system
(no stored third-party OAuth tokens, no polling) — consistent with the
inbound-only architecture above. "Pull" in practice means: the developer's
existing backend, which already owns this data, pushes it to Nexora
whenever it changes, the same way it already pushes orders.

### Capability-based product adapters

Different platforms expose very different product shapes — Shopify's
products are built around variants, WooCommerce has REST-shaped
categories/meta_data, hand-rolled backends may have none of that. Rather
than assuming one shape, every `Connector` declares what it can actually
carry:

```ts
// src/lib/connectors/types.ts
interface ProductCapabilities {
  images: boolean;
  variants: boolean;
  categories: boolean;
  customFields: boolean;
}
```

`normalizeProduct()` maps whatever the connector's native payload looks
like onto Nexora's canonical `CanonicalProduct` (name, description, price,
`images[]`, `categories[]`, `status`, `variants[]`, and a value-restricted
`attributes` bag for anything developer-specific) — see
`src/lib/connectors/nexoraNative.ts`, `shopify.ts`, and `woocommerce.ts`
for three different real-world shapes mapping onto the same target.

## Automatic monitoring

The JS SDK auto-captures uncaught errors, unhandled promise rejections,
failed `fetch()` calls, and `console.error()` calls the moment
`Nexora.init()` runs (`autoCapture: false` to disable, or call
`Nexora.captureError`/`captureCrash`/`captureMessage` manually) and posts
them to `POST /api/monitoring/events`. A backend can post to the same
endpoint with its secret key for server-side exceptions and failed
upstream calls. See `docs/API_CONTRACTS.md` "Monitoring" for the
grouping/dedup rules and `public/sdk/README.md` for SDK usage.
