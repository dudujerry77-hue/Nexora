# Nexora Architecture

Nexora is a multi-tenant SaaS control center that lets a business connect
multiple stores (websites, apps, or storefronts) to one dashboard. Stores
push data **to** Nexora through APIs/webhooks that Nexora owns — Nexora never
scrapes or reverse-engineers third-party sites.

## High-level flow

```
Customer
   |
Connected Website/App (store-owned backend)
   |
Nexora API  (POST /api/webhooks/*  or  POST /api/orders with an API key)
   |
Integration Manager -> Webhook Manager -> Auth/API-key check -> Validation
   |
Database (Postgres/Prisma, tenant-scoped)
   |
Event Bus (in-process pub/sub)
   |
SSE stream  ->  Dashboard (live update, no refresh) + Notification Center
```

## Modules

| Module | Responsibility | Code |
|---|---|---|
| **Integration Manager** | CRUD for `Integration` records (one per store+connector), lifecycle (connected/warning/disconnected), status tracking | `src/lib/integrations.ts` |
| **API Manager** | Public REST API (`/api/*`) for dashboard + first-party clients, session-cookie authenticated | `src/app/api/**` |
| **Webhook Manager** | Inbound webhook endpoints, signature verification, idempotency, retries/logging | `src/app/api/webhooks/**`, `src/lib/webhooks.ts` |
| **Authentication** | Password auth for dashboard users (JWT in httpOnly cookie) + API-key auth for machine clients | `src/lib/auth.ts`, `src/lib/apiKey.ts` |
| **Connector System** | Pluggable adapters that normalize a source platform's payload into Nexora's canonical event shape | `src/lib/connectors/*` |

## Connector system (extensibility)

Every inbound integration goes through a **connector** — a small adapter that
knows how to turn a platform-specific payload into Nexora's canonical event
shape (`order.created`, `product.updated`, etc.). The webhook/API layer never
special-cases a platform directly; it resolves a connector by
`integration.provider` and calls `connector.normalize(payload)`.

```
ConnectorRegistry
  ├── custom_api      (Nexora API / generic backend integration)   implemented
  ├── custom_webhook  (Nexora Webhooks, signed HMAC payload)       implemented
  ├── js_sdk          (Nexora JavaScript SDK, browser-safe events) implemented
  ├── woocommerce     (maps WooCommerce webhook payloads)          stub, not wired to a live store
  ├── shopify         (maps Shopify webhook payloads)              stub, not wired to a live store
  └── <future>        add a new file in src/lib/connectors/ and register it
```

See `src/lib/connectors/index.ts`. Adding a platform means writing one file
that implements the `Connector` interface — no changes to the database
schema, API routes, or dashboard are required. WooCommerce/Shopify connectors
in this repo are **stubs that document the mapping only** — they are clearly
marked `status: "planned"` in the UI and are not claimed as working
integrations, per the project's anti-fake-functionality rule.

## Multi-tenancy & isolation

Every store-owned row (`Order`, `Product`, `Customer`, `Inventory`,
`Integration`, `ApiKey`, `Notification`, `IntegrationLog`) carries a
`storeId`, and every `Store` carries an `organizationId`. All API/webhook
handlers resolve the acting principal (dashboard session or API key) to an
`organizationId` first, then filter every query by it — see
`src/lib/authz.ts:assertStoreAccess`. IDs are never trusted from the client
without an ownership check. This is what prevents "User A edits User B's
store by changing the URL id" (tested in `tests/authorization.test.ts`).

## Real-time updates

MVP uses **Server-Sent Events** (`GET /api/notifications/stream`), fed by an
in-process event emitter (`src/lib/events.ts`). This is sufficient for a
single-instance deployment. Scaling to multiple app instances only requires
swapping the in-process emitter for a shared pub/sub (Redis, NATS) behind the
same `publish()`/`subscribe()` interface — the rest of the app is unaffected.

## What is intentionally NOT implemented (MVP honesty)

Per the project's own MVP rule, the following are explicitly marked
"planned" in the UI and code rather than faked:

- WooCommerce / Shopify live connectors (mapping logic exists as a stub;
  no OAuth flow or live sync is implemented).
- Native Android SDK (architecture documented in `docs/INTEGRATIONS.md`;
  the JS SDK and server-to-server API are the implemented MVP paths).
- Multi-instance real-time fan-out (works today for one server process).
- Outbound webhook retry queue with exponential backoff is implemented
  synchronously with a bounded retry counter, not a durable job queue.

## Tech stack

- **Framework**: Next.js 14 (App Router) — one codebase for the dashboard,
  landing page, and API routes.
- **Language**: TypeScript, strict mode.
- **Database**: Prisma ORM. Ships with SQLite for zero-setup local dev; the
  schema is written to be Postgres-compatible (`DATABASE_URL` swap + change
  the `provider` in `prisma/schema.prisma`) for production.
- **Auth**: JWT (HS256) in an httpOnly, `SameSite=Lax`, `Secure` cookie for
  humans; hashed API keys (`nx_live_...`) for machines.
- **Styling**: Tailwind CSS, class-based dark mode.
- **Tests**: Vitest, calling route handlers directly (no network hop needed).
