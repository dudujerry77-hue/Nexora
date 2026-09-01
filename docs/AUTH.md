# Authentication & Authorization

## Human authentication (dashboard)

- Passwords hashed with **bcrypt** (cost factor 12), never stored/logged in
  plaintext.
- On login, a JWT (`HS256`, signed with `NEXORA_JWT_SECRET`) containing
  `{ sub: userId, role }` is issued with a 7-day expiry and set as an
  **httpOnly, SameSite=Lax, Secure (in production)** cookie
  (`nexora_session`). httpOnly defeats XSS token theft; SameSite=Lax
  mitigates CSRF for the cookie itself.
- State-changing dashboard requests (`POST`/`PATCH`/`DELETE` from the
  browser) additionally require a `x-nexora-csrf` header matching a
  non-httpOnly `nexora_csrf` cookie issued at login (double-submit CSRF
  pattern) — see `src/lib/csrf.ts`. API-key authenticated requests are
  exempt (no ambient cookie/browser session to forge).
- `GET /api/auth/me` resolves the cookie -> user -> organization membership
  on every request; nothing about identity is trusted from the client body.

## Roles

| Role | Scope | Notes |
|---|---|---|
| `OWNER` | Full control of their Organization: stores, integrations, staff, billing-level settings | One organization can have exactly one `owner` `User`, but the `Member` table allows more than one user with `role=OWNER` membership if the account owner wants to promote a co-owner. |
| `STAFF` | Only the stores listed in their `StoreAssignment` rows, with per-assignment permission flags (`view_orders`, `manage_orders`, `view_products`, `manage_products`, `view_customers`) | Cannot manage integrations, API keys, or other staff. |
| `SUPER_ADMIN` | Nexora's own operators. Cross-tenant read access + suspension powers over the whole platform | Never created via `/api/auth/register`. Seeded directly in the database (see `prisma/seed.ts`) or promoted by another `SUPER_ADMIN` through the admin-only API. The `/nexora-admin` UI is not linked from any user-facing nav and its layout independently re-checks the role server-side on every request. |

## Store-level authorization

`src/lib/authz.ts` exposes two functions used by **every** resource route:

- `requireSession(req)` — resolves the JWT cookie into `{ user, member }` or
  throws `unauthorized`.
- `assertStoreAccess({ member, storeId, permission })` — loads the store,
  confirms it belongs to the member's organization, and (for `STAFF`) that a
  `StoreAssignment` exists with the required permission flag. Throws
  `forbidden`/`not_found` otherwise.

Because every query is additionally filtered by the resolved
`organizationId`/`storeId` at the Prisma level (not just checked-then-
trusted), changing an `:id` in the URL to another tenant's resource returns
`404 not_found` — see `tests/authorization.test.ts` for the isolation
tests ("User A cannot access User B's store/orders/api key").

## Machine authentication (API keys)

- Generated as `nx_live_<32 random url-safe chars>` (or `nx_test_...` for a
  future sandbox mode). Only a SHA-256 hash of the full key plus a short
  display prefix (`nx_live_ab12`) are persisted — the full value is
  returned exactly once, at creation/regeneration time, and never
  retrievable again (mirrors how Stripe/GitHub tokens work).
- Each key is bound to exactly one `storeId` and carries an explicit
  `scopes` array (e.g. `["orders:write", "products:write"]`). A request
  authenticated with an API key can only touch that one store and only the
  actions its scopes allow.
- Revocation sets `revokedAt`; revoked keys fail auth immediately.
  Regeneration revokes the old key and issues a new one atomically.
- Never exposed to frontend/browser code — the JS SDK only ever uses a
  `publicKey` (see `docs/INTEGRATIONS.md`), which has no write scopes and
  cannot authenticate server-to-server calls.

## Rate limiting

A token-bucket limiter (`src/lib/rateLimit.ts`, in-memory for the MVP) keyed
by `(ip, route)` for anonymous/session routes and by `apiKeyId` for
API-key routes. Defaults: 100 req/min for dashboard session routes, 60
req/min per API key for webhook/API ingestion. Exceeding the limit returns
`429` with `{ error: { code: "rate_limited" } }`. Documented as in-memory
(per-process) for the MVP; production would move this to Redis so it holds
across instances.

## Audit logging

Every sensitive mutation (login, registration, store create/delete,
integration create/rotate/revoke, staff role change, order status change)
writes an `AuditLog` row with the actor, action, target, and metadata —
queryable by `SUPER_ADMIN` at `/api/admin/audit-logs` and by an `OWNER` for
their own organization at `/dashboard/settings`.

## Input validation & injection protection

- All request bodies are parsed through **Zod** schemas (`src/lib/validation.ts`)
  before touching the database — unknown/malformed fields are rejected
  (`422 validation_error`), not silently coerced.
- All database access goes through **Prisma**'s parameterized query builder
  — no raw string-concatenated SQL anywhere in the app, which eliminates
  SQL injection by construction.
- All dashboard-rendered user content goes through React's default
  escaping (no `dangerouslySetInnerHTML` is used), which prevents stored
  XSS from customer/product names etc.
- Strict `Content-Security-Policy` and other security headers are set
  globally in `next.config.js`.
