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

```
GET    /api/products?storeId=&search=&page=            (session)
POST   /api/products           { storeId, sku, name, price, currency, imageUrl?, quantity? }
                                (API key: products:write, OR session OWNER/manage_products)
PATCH  /api/products/:id       { name?, price?, imageUrl? }
DELETE /api/products/:id
```

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

## Reports (organization-scoped, any active member)

```
GET  /api/reports?type=bug|crash|user       (session) -> reports in caller's org, newest first
POST /api/reports  { type, category, title, description, stepsToReproduce?,
                      expectedBehavior?, actualBehavior?, severity?, storeId?,
                      screenshotUrl?, diagnostics? }          (session)
GET  /api/reports/:id                        (session, org-scoped)
```

`category` must be one of the values `src/lib/reportCategories.ts` lists for
the given `type`. `diagnostics` is validated against a strict allow-list
(`route`, `viewportWidth`, `viewportHeight`, `userAgent`, `appVersion`,
`errorMessage`) — zod drops any other key, so API keys, webhook secrets,
passwords, or session tokens can never be persisted through this endpoint
even by mistake.

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
