# External-site integration test harness

A standalone static page that plays the role of an external storefront
sending a real order into Nexora, for local CORS/integration testing only.
It is not part of the Next.js app (nothing under `dev-tools/` is imported
by `src/`) and is not built or deployed with the app.

## Setup

1. Copy `config.example.js` to `config.local.js` in this same folder.
   `config.local.js` is gitignored, so a real API key never gets committed.
2. In Nexora (`http://localhost:3000`), open a store → Integrations →
   "Generate credentials" (provider: Nexora API). Copy the `storeId` and
   the `apiKey` it shows once into `config.local.js`.
3. Serve this folder on port 5500:
   - VS Code "Live Server" extension (defaults to `127.0.0.1:5500`), or
   - `npx serve -l 5500 dev-tools/external-site-simulator`
4. Open `http://127.0.0.1:5500` or `http://localhost:5500` — these are the
   two origins Nexora's dev-only CORS allowlist accepts
   (`src/lib/cors.ts`). Any other origin gets no CORS headers and the
   browser blocks the request, by design.
5. Click "Send test order to Nexora". You should see `HTTP 201 (success)`
   and the created order JSON.

## What this proves

- The browser preflight (`OPTIONS /api/orders`) succeeds for this origin.
- The real `POST /api/orders` request (with `Authorization: Bearer
  <apiKey>` and `createOrderSchema` body) succeeds cross-origin.
- Nothing about authentication, CSRF, or rate limiting changed — the API
  key is still required and still validated exactly as it is for a
  server-to-server caller; CORS only decides whether a *browser* is
  allowed to read the response.
