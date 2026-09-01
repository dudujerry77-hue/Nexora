# Nexora JavaScript SDK

```html
<script src="https://your-nexora-host/sdk/nexora.js"></script>
<script>
  Nexora.init({ storeId: "store_123", publicKey: "nx_public_xxxxx" });
  Nexora.trackPageView();
  Nexora.identify({ email: "shopper@example.com" });
</script>
```

## What this SDK can and cannot do

- **Can**: send lightweight, low-privilege client-side signals
  (`trackPageView`, `identify`) authenticated with a `publicKey` that only
  ever carries a `read` scope.
- **Cannot**: create orders, write products/inventory/customers, or read
  any data at all. This is enforced server-side
  (`src/app/api/sdk/event/route.ts` requires the `read` scope; every
  write endpoint rejects it), not just left out of this file — so a
  `publicKey` leaking in your page source (which it always will, being
  client-side) can never be used to forge business data.

## Why order creation isn't here

Nexora's MVP rule is that a browser should never be trusted with a secret
API key. Creating an order requires a store-scoped secret key
(`nx_live_...`), so your own backend — which does hold that secret — should
call `POST /api/orders` or `POST /api/webhooks/orders` directly. See
`docs/INTEGRATIONS.md` in the main repository for the three supported
integration paths.
