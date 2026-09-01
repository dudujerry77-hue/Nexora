# Nexora

**One dashboard. Every store.**

Nexora is a multi-tenant SaaS control center for businesses that run more
than one storefront (website, app, or physical/restaurant point of sale).
Connected stores push orders, products, customers, and inventory into
Nexora over a documented API, signed webhooks, or a lightweight JS SDK —
Nexora never scrapes third-party sites.

Read the architecture before the code:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module layout, connector system, real-time design
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) — every table, FK, and index
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) — every REST endpoint
- [`docs/AUTH.md`](docs/AUTH.md) — sessions, RBAC, API keys, CSRF, rate limiting
- [`docs/WEBHOOKS.md`](docs/WEBHOOKS.md) — event envelope, signatures, idempotency
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — the 3 MVP integration paths + connector extensibility

## Quick start

```bash
npm install
cp .env.example .env
npm run db:push     # creates prisma/dev.db (SQLite, zero setup)
npm run db:seed      # 3 demo stores: Iya Kudinka Restaurant, Jeremiah Fashion, Tech Store
npm run dev
```

Open http://localhost:3000. Demo logins (password `password123` for all):

- Owner dashboard: `owner@demo.nexora.dev`
- Super admin (visit `/nexora-admin`, not linked from the nav): `admin@nexora.dev`

The seed script prints a fresh API key + webhook URL for each demo store —
use it to POST a signed webhook (see `docs/WEBHOOKS.md`) and watch the order
land in the dashboard in real time.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` / `npm run start` | Production build + serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Sync `prisma/schema.prisma` to the SQLite DB |
| `npm run db:seed` | Seed demo organization, stores, products, orders |
| `npm test` | Run the Vitest suite (auth, authorization/isolation, API keys, webhooks incl. duplicates & rate limiting, orders) |

## What's real vs. what's marked "planned"

Per the project's own anti-fake-functionality rule, everything in the UI
either works end-to-end against the database, or is explicitly labeled
"planned" (WooCommerce/Shopify connectors, a native Android SDK, staff
invite flow). See `docs/ARCHITECTURE.md`'s "What is intentionally NOT
implemented" section for the full list — nothing pretends to be connected
without a live account behind it.

## Known limitations (honest, not hidden)

- **Database**: ships on SQLite for zero-setup local dev/tests. The schema
  is Postgres-ready (swap the `datasource` provider + `DATABASE_URL`); a
  few JSON columns are stored as `TEXT` because Prisma's SQLite connector
  doesn't support a native `Json` type — see `docs/DATABASE_SCHEMA.md`.
- **Rate limiting** is in-memory (per-process) — fine for one instance,
  needs a shared store (Redis) behind multiple instances.
- **Next.js version**: pinned to the 14.2.x line. `npm audit` flags several
  advisories fixed only in Next 16, which is a breaking major upgrade out
  of scope for this MVP pass — track it as a follow-up before a public
  production deployment.
- **Staff invites**: the `Member`/`StoreAssignment` data model supports
  per-store staff permissions (tested in `tests/authorization.test.ts`),
  but there's no invite-by-email UI yet — staff rows are created directly
  today.
