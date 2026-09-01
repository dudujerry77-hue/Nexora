# Nexora JavaScript SDK

```html
<script src="https://your-nexora-host/sdk/nexora.js"></script>
<script>
  Nexora.init({ storeId: "store_123", publicKey: "nx_public_xxxxx" });
  Nexora.trackPageView();
  Nexora.identify({ email: "shopper@example.com" });
</script>
```

## Automatic monitoring (on by default)

Once `init()` runs, the SDK automatically reports to Nexora's Monitoring
feed (Settings → Reports in the dashboard) without any extra code:

- uncaught JS errors (`window.onerror`)
- unhandled promise rejections
- failed `fetch()` calls (non-2xx responses and network failures)
- `console.error()` calls

Pass `autoCapture: false` to `init()` to disable this and report manually
instead:

```js
Nexora.captureError(error); // an Error instance you caught yourself
Nexora.captureCrash("Checkout flow became unresponsive");
Nexora.captureMessage("Unexpected empty cart", "warning");
```

Nexora groups repeated occurrences of the same problem into one issue
(deduplicated by error type + message + page), so a busy loop won't flood
the dashboard — it just increments an occurrence counter.

**Never pass sensitive data** into `captureError`/`captureMessage` extras —
passwords, tokens, API keys, and card numbers are not something Nexora's
diagnostics schema accepts, and stack traces should never contain secrets
in the first place. The automatic `fetch()` failure capture already strips
the query string and any embedded credentials from a failed request's URL
(some APIs put tokens in `?params`) before reporting it — only the origin
and path are ever sent.

## What this SDK can and cannot do

- **Can**: send lightweight, low-privilege client-side signals
  (`trackPageView`, `identify`, and the automatic/manual monitoring events
  above) authenticated with a `publicKey` that only ever carries a `read`
  scope.
- **Cannot**: create orders, write products/inventory/customers, or read
  any data at all. This is enforced server-side
  (`src/app/api/sdk/event/route.ts` and `src/app/api/monitoring/events/route.ts`
  both require only the `read` scope; every write endpoint rejects it),
  not just left out of this file — so a `publicKey` leaking in your page
  source (which it always will, being client-side) can never be used to
  forge business data.

## Why order creation isn't here

Nexora's MVP rule is that a browser should never be trusted with a secret
API key. Creating an order requires a store-scoped secret key
(`nx_live_...`), so your own backend — which does hold that secret — should
call `POST /api/orders` or `POST /api/webhooks/orders` directly. See
`docs/INTEGRATIONS.md` in the main repository for the three supported
integration paths.
