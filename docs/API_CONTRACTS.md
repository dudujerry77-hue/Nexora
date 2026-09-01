# Nexora API Contracts

Base URL (self-hosted): `https://<your-deployment>/api`

## Auth model

Two independent auth mechanisms, both accepted by the "core" resource
routes where noted:

1. **Dashboard session** — httpOnly JWT cookie (`nexora_session`), set by
   `/api/auth/login`. Used by the Next.js dashboard itself.
2. **API key** — `Authorization: Bearer nx_live_...` header. Used by a
   store's own backend to push data into Nexora server-to-server. Scoped to
   exactly one store, with explicit permission scopes (see
   `docs/AUTH.md`).

Every response is JSON: `{ "data": ... }` on success, or
`{ "error": { "code": "...", "message": "..." } }` on failure. Standard
HTTP status codes are used (400/401/403/404/409/422/429/500).

## Auth

```
POST /api/auth/register        { name, email, password, orgName }        -> creates User(OWNER) + Organization
POST /api/auth/login           { email, password }                       -> sets session cookie
POST /api/auth/logout          (session)                                  -> clears cookie
GET  /api/auth/me              (session)                                  -> current user + org + role
```

## Stores

```
GET    /api/stores                          (session)            -> stores in caller's org (or assigned stores if STAFF)
POST   /api/stores             { name, type, logoUrl? }  (OWNER)  -> create store
GET    /api/stores/:id                       (session, store access) -> store detail incl. counts + integrations
PATCH  /api/stores/:id         { name?, logoUrl?, status? } (OWNER)
DELETE /api/stores/:id                       (OWNER)              -> soft-disconnect + cascade-archive
```

## Orders

```
GET    /api/orders?storeId=&status=&page=&pageSize=   (session)   -> paginated, store-scoped
GET    /api/orders/:id                                  (session, store access)
POST   /api/orders             { storeId, externalId, customer, items[], total, currency, deliveryAddress? }
                                (API key: orders:write, OR session OWNER for manual entry)
PATCH  /api/orders/:id         { status?, paymentStatus? }  (session, store access + manage_orders)
```

## Products

Every store runs in one of two ownership modes (`Store.productMode`,
changeable in Settings, OWNER only):

- **`nexora_managed`** (default) — products are created/edited in this
  dashboard (`POST`/`PATCH` below, or the Products page's UI, including
  drag/drop, device-upload, or URL images).
- **`developer_owned`** — the developer's own system is the source of
  truth; the Products page becomes read-only and products arrive the same
  way orders do: pushed in via the API key or a webhook. Nexora never
  polls or reaches into a third-party system to "pull" products — see
  `docs/INTEGRATIONS.md` "Product ownership modes".

Every connector declares a `productCapabilities` descriptor (`images`,
`variants`, `categories`, `customFields` — `src/lib/connectors/types.ts`)
so the UI/API can adapt to what a given developer's system can actually
express, rather than assuming every integration exposes the same product
shape.

```
GET    /api/products?storeId=&search=&page=            (session, OR API key: `read` scope — own store only)
POST   /api/products           { storeId, sku, name, description?, price, currency,
                                  imageUrl?, images?, categories?, status?, attributes?,
                                  variants?, quantity? }
                                (API key: products:write, OR session OWNER/manage_products)
PATCH  /api/products/:id       { name?, description?, price?, imageUrl?, images?,
                                  categories?, status?, attributes?, variants? }
DELETE /api/products/:id
```

- The `read`-scoped GET (available to a public *or* secret key) lets a
  developer's own storefront pull Nexora-managed product data back out —
  the "Nexora-managed → product data → developer integration" direction.
  A product catalog is customer-facing data, unlike orders/customers, so
  this is safe even for a public key; it is always scoped to the calling
  key's own store.
- The session-authenticated POST/PATCH/DELETE (dashboard) paths are
  rejected with `forbidden` for a `developer_owned` store — enforced
  server-side, not just hidden in the UI — since that store's products may
  only change via the API-key/webhook push path below. The API-key POST
  keeps working regardless of `productMode` (it *is* that push path).
- POST/PATCH bodies are capped at 20MB (`assertRequestSizeWithin`,
  `src/lib/requestLimits.ts`) — generous enough for 8 base64 images, far
  below unbounded.
- `images` is a JSON array of URLs (`http(s)://`) or uploaded images
  (`data:image/...` URLs from drag/drop or a device file picker) —
  `images[0]` is the cover image, mirrored onto the legacy `imageUrl`
  field for backward compatibility.
- `attributes` is developer-defined but value-restricted (string/number/
  boolean only, max 30 keys) — see `productAttributesSchema` in
  `src/lib/validation.ts` — so a pushed payload can't smuggle nested
  structures or secrets into storage. The same cap applies to a webhook
  push's normalized output (`canonicalProductSchema`), not just this
  direct API — a connector's `normalizeProduct()` only coerces types and
  places no size limit on its own.
- `variants` fully replaces a product's variant set on each write (create
  or update) — the source system is expected to push its complete current
  state, matching how `upsertProduct` already treats every other field for
  webhook-pushed products.

## Inventory

```
GET    /api/inventory?storeId=&lowStockOnly=           (session)
PATCH  /api/inventory/:productId  { quantity?, lowStockThreshold? }
```

## Customers

```
GET    /api/customers?storeId=&search=                 (session)
GET    /api/customers/:id
```

## Integrations & API keys

```
GET    /api/integrations?storeId=                       (session)
POST   /api/integrations       { storeId, provider }     (OWNER) -> creates Integration + first ApiKey (secret returned ONCE)
GET    /api/integrations/:id                             (session, store access)
DELETE /api/integrations/:id                             (OWNER) -> disconnect, revoke keys
POST   /api/integrations/:id/rotate                      (OWNER) -> revoke old key(s), issue a new one (secret returned ONCE)
```

## Webhooks (inbound, from a connected store's backend)

```
POST /api/webhooks/orders       (API key or HMAC signature)  events: order.created | order.updated | order.cancelled
POST /api/webhooks/products     events: product.created | product.updated | product.deleted
POST /api/webhooks/inventory    events: inventory.updated
POST /api/webhooks/customers    events: customer.created | customer.updated
```

See `docs/WEBHOOKS.md` for the envelope, signature scheme, and idempotency
rules.

### CORS (development only)

`POST /api/orders` and `POST /api/webhooks/orders` answer a CORS preflight
and echo `Access-Control-Allow-Origin` only when `NODE_ENV !== 'production'`
and the request's `Origin` is `http://127.0.0.1:5500` or
`http://localhost:5500` (see `src/lib/cors.ts`) — enough to drive these
endpoints from a browser-based local test page (e.g. VS Code "Live
Server"). A real integration is expected to call these endpoints
server-to-server, where CORS never applies; this allowlist is never `*`
and never active in production, and it does not relax API-key validation,
CSRF, rate limiting, or signature verification in any way.

## SDK collector (public key only, read-scope, CORS-enabled)

```
POST /api/sdk/event   { type: "page_view" | "identify", payload? }   (Authorization: Bearer nx_public_...)
```

Never accepts a secret key, and only ever logs to `integration_logs` — see
`public/sdk/README.md`.

## Notifications

```
GET  /api/notifications?unreadOnly=&storeId=  (session)
POST /api/notifications/:id/read             (session)
GET  /api/notifications/stream               (session, Server-Sent Events)  -> live push
```

## Monitoring (automatic observability — not a user-submitted form)

A connected website/app reports raw occurrences automatically (the JS SDK's
built-in auto-capture, or a backend posting with its own secret key);
Nexora groups them into deduplicated issues per store and shows them live
in Settings → Reports.

```
POST /api/monitoring/events   { type, message, stack?, route?, statusCode?,
                                 severity?, diagnostics? }
                               (API key: public or secret, `read` scope — CORS-enabled, like /api/sdk/event)
GET  /api/monitoring/issues?storeId=&status=unresolved|resolved|ignored|all   (session, view_monitoring)
GET  /api/monitoring/issues/:id                                              (session, view_monitoring) -> issue + last 20 raw events
PATCH /api/monitoring/issues/:id   { status: "unresolved"|"resolved"|"ignored" }   (session, manage_monitoring)
```

- `type` is one of `js_error | unhandled_rejection | console_error |
  network_error | crash`.
- Occurrences are grouped by a fingerprint of `type + normalized message +
  route` (`src/lib/monitoring.ts`) — a repeat of the same problem
  increments `occurrenceCount` and bumps `lastSeenAt` rather than creating
  a new issue; a new occurrence on a `resolved` issue reopens it.
- `diagnostics` is validated against a strict allow-list (`viewportWidth`,
  `viewportHeight`, `userAgent`, `appVersion`) — zod drops any other key,
  so API keys, webhook secrets, passwords, or session tokens can never be
  persisted through this endpoint even by mistake.
- A brand-new issue (or a resolved one reopening) also raises a
  Notification; every occurrence publishes a `monitoring.issue_created` /
  `monitoring.issue_updated` event over the existing notification SSE
  stream, which is what makes the dashboard update live.

## Audit log (organization-scoped, OWNER only)

```
GET /api/audit-logs                          (session, OWNER)  -> last 100 audit events for the caller's org
```

## Analytics

```
GET /api/analytics/overview?storeId=&range=7d|30d|90d   (session) -> revenue, order counts, low stock, etc.
```

## Super Admin (never linked from normal nav; role-gated)

```
GET  /api/admin/organizations        (SUPER_ADMIN)
GET  /api/admin/users                (SUPER_ADMIN)
POST /api/admin/organizations/:id/suspend   (SUPER_ADMIN)
GET  /api/admin/audit-logs           (SUPER_ADMIN)
```

## Error codes

| code | meaning |
|---|---|
| `unauthorized` | missing/invalid session or API key |
| `forbidden` | authenticated, but not allowed to touch this resource (RBAC or store isolation) |
| `not_found` | resource does not exist *or* isn't yours (never distinguished, to avoid leaking existence) |
| `validation_error` | request body failed schema validation (Zod) |
| `conflict` | duplicate resource (e.g. `(storeId, externalId)` already exists) |
| `rate_limited` | too many requests |
| `invalid_signature` | webhook signature failed verification |
