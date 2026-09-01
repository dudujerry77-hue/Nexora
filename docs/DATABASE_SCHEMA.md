# Database Schema

Relational schema (Prisma, see `prisma/schema.prisma` for the source of
truth). `total`/`price` are stored as `Int` representing whole currency
units (e.g. Naira), which keeps the MVP demo simple; a production system
handling fractional-currency markets would store minor units (cents) instead.

**JSON columns**: Prisma's SQLite connector does not support a native
`Json` column type, so fields documented below as JSON (`permissions`,
`config`, `scopes`, `payload`, `metadata`) are declared as `String` in
`prisma/schema.prisma` and JSON-encoded/decoded at the application boundary
(`src/lib/json.ts`). Switching to Postgres in production, these can be
promoted to native `Json` columns without changing any application code
that goes through `src/lib/json.ts`.

## Entities

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email (unique), passwordHash, name, role (`OWNER`\|`STAFF`\|`SUPER_ADMIN`), createdAt | Global account. `SUPER_ADMIN` is never assignable via public signup. |
| `organizations` | id, name, ownerId -> users.id | The billing/tenant boundary. Created automatically when an `OWNER` registers. |
| `members` | id, userId -> users, organizationId -> organizations, role (`OWNER`\|`STAFF`), status | Join table; lets staff belong to an org without owning it. Unique (`userId`,`organizationId`). |
| `store_assignments` | id, memberId -> members, storeId -> stores, permissions (JSON: view_orders, manage_orders, view_products, manage_products, view_customers) | Scopes staff access to specific stores. |
| `stores` | id, organizationId -> organizations, name, logoUrl, type (`restaurant`\|`fashion`\|`retail`\|`electronics`\|`other`), status (`connected`\|`warning`\|`disconnected`), lastSyncAt | One row per connected storefront. |
| `integrations` | id, storeId -> stores, provider (`custom_api`\|`custom_webhook`\|`js_sdk`\|`woocommerce`\|`shopify`), status, lastRequestAt, lastWebhookAt, lastSyncAt, failedRequestCount, config (JSON) | A store can have more than one integration (e.g. API + SDK). |
| `api_keys` | id, storeId -> stores, integrationId -> integrations, name, keyPrefix, keyHash, scopes (JSON array), revokedAt, lastUsedAt | Only `keyHash` (SHA-256) and a display `keyPrefix` (`nx_live_ab12`) are stored; the full secret is shown once at creation/regeneration. |
| `webhook_endpoints` | id, storeId -> stores, secretCiphertext, description, createdAt | The signing secret used to verify inbound webhook signatures for a store. Stored **encrypted** (AES-256-GCM), not hashed — verifying an HMAC requires the plaintext secret back, unlike API keys/passwords. |
| `webhook_events` | id, storeId -> stores, eventId (unique per store), eventType, payload (JSON), status (`received`\|`processed`\|`failed`\|`duplicate`), receivedAt | Append-only log; `(storeId, eventId)` unique index gives idempotency / duplicate protection. |
| `orders` | id, storeId -> stores, externalId, customerId -> customers (nullable), customerName, status (`pending`\|`confirmed`\|`preparing`\|`shipped`\|`delivered`\|`cancelled`), paymentStatus (`unpaid`\|`paid`\|`refunded`), total, currency, deliveryAddress, createdAt, updatedAt | Unique (`storeId`,`externalId`) prevents duplicate order ingestion. |
| `order_items` | id, orderId -> orders, productId -> products (nullable), name, quantity, price | Line items. |
| `products` | id, storeId -> stores, sku, name, price, currency, imageUrl, createdAt, updatedAt | Unique (`storeId`,`sku`). |
| `inventory` | id, productId -> products (unique), storeId -> stores, quantity, lowStockThreshold, updatedAt | 1:1 with product; `quantity <= lowStockThreshold` drives the low-stock widget. |
| `customers` | id, storeId -> stores, externalId, name, email, phone, createdAt | Unique (`storeId`,`externalId`). |
| `notifications` | id, organizationId -> organizations, storeId -> stores (nullable), type, title, body, severity (`info`\|`warning`\|`critical`), readAt, createdAt | Feeds the notification center + SSE stream. |
| `audit_logs` | id, organizationId, actorUserId (nullable), action, targetType, targetId, metadata (JSON), createdAt | Every sensitive mutation (login, key rotation, role change, store delete...) is recorded. |
| `integration_logs` | id, storeId -> stores, integrationId -> integrations (nullable), direction (`inbound`\|`outbound`), level (`info`\|`warning`\|`error`), message, metadata (JSON), createdAt | Feeds the Integration Logs debugging page. |

## Indexing strategy

- Every foreign key column is indexed (Prisma `@@index` / implicit index on
  relation scalar fields).
- Tenant-scoping columns (`organizationId`, `storeId`) are indexed since
  every query filters by them first.
- `(storeId, eventId)` unique on `webhook_events` for idempotency.
- `(storeId, externalId)` unique on `orders` and `customers` to make
  re-delivery of the same external record a safe upsert.
- `(storeId, sku)` unique on `products`.
- `email` unique on `users`.

## Ownership chain

```
User --owns--> Organization --has--> Store --has--> Integration --has--> ApiKey
                                        |--has--> Order/Product/Customer/Inventory
Member (User <-> Organization) --scoped by--> StoreAssignment --> Store
```

Every authorization check walks this chain server-side; nothing is inferred
from a client-supplied `organizationId`/`storeId` without verifying the
session's user (or the API key's store) actually owns it.
