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

- 🟢 **Connected** — a successful request/webhook within the last 24h.
- 🟡 **Warning** — nothing successful in 24h, or failures present, but not
  yet 72h silent.
- 🔴 **Disconnected** — silent for 72h+, or manually disconnected.

See `src/lib/integrations.ts:computeStatus`.
