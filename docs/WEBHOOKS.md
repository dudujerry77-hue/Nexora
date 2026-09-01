# Webhook Contracts

Nexora receives events from a connected store's own backend (never the
other way around for the MVP — see `docs/INTEGRATIONS.md` for why the JS
SDK does not create orders directly).

## Envelope

```json
{
  "event": "order.created",
  "store_id": "store_123",
  "event_id": "evt_9f2c...",
  "occurred_at": "2026-09-01T10:15:00Z",
  "data": { "...": "event-specific payload" }
}
```

- `event_id` **must** be a stable, unique-per-store identifier chosen by the
  sender (e.g. their own event/log id). It is the idempotency key.
- `store_id` is Nexora's store id, obtained when the integration was
  created.

## Supported events

| Event | Route | `data` shape |
|---|---|---|
| `order.created` | `POST /api/webhooks/orders` | `{ id, customer: {name, email?, phone?}, items: [{sku?, name, quantity, price}], total, currency, status?, delivery_address? }` |
| `order.updated` | `POST /api/webhooks/orders` | `{ id, status?, payment_status? }` |
| `order.cancelled` | `POST /api/webhooks/orders` | `{ id, reason? }` |
| `product.created` | `POST /api/webhooks/products` | `{ sku, name, price, currency, image_url?, quantity? }` |
| `product.updated` | `POST /api/webhooks/products` | `{ sku, name?, price?, image_url? }` |
| `product.deleted` | `POST /api/webhooks/products` | `{ sku }` |
| `inventory.updated` | `POST /api/webhooks/inventory` | `{ sku, quantity, low_stock_threshold? }` |
| `customer.created` | `POST /api/webhooks/customers` | `{ id, name, email?, phone? }` |
| `customer.updated` | `POST /api/webhooks/customers` | `{ id, name?, email?, phone? }` |

## Signature verification

Every webhook request must include:

```
X-Nexora-Signature: sha256=<hex hmac>
X-Nexora-Timestamp: <unix seconds>
```

The signature is `HMAC_SHA256(webhookSecret, "${timestamp}.${rawBody}")`,
hex-encoded. The receiver:

1. Rejects requests where `abs(now - timestamp) > 300s` (replay window).
2. Recomputes the HMAC over the **raw** request body and compares it to the
   header using a constant-time comparison
   (`crypto.timingSafeEqual`) — never a `===` string compare.
3. Returns `401 { error: { code: "invalid_signature" } }` on mismatch,
   without processing the body.

The `webhookSecret` is generated per-store when a webhook-capable
integration is created (`POST /api/integrations`) and is shown once,
alongside the API key.

## Idempotency & duplicate protection

Every accepted webhook is written to `webhook_events` keyed by
`(storeId, eventId)` (unique index) **before** side effects are applied,
inside the same transaction:

- If the `(storeId, eventId)` pair already exists, the handler responds
  `200 { data: { status: "duplicate" } }` immediately and performs no
  further writes — this makes redelivery (the sender retrying after a
  timeout it thinks failed) safe.
- Order/customer ingestion additionally upserts on `(storeId, externalId)`
  as a second layer of protection even if a sender reuses an `event_id`
  incorrectly.

## Retry handling (outbound expectations documented for integrators)

Nexora's webhook receiver always responds within its request timeout and
returns a definitive status code:

- `2xx` — accepted (including `duplicate`), sender should stop retrying.
- `401` — bad signature, retrying with the same signature will never help.
- `422` — validation error, payload is malformed; fix before retrying.
- `429` — rate limited; sender should back off and retry later.
- `5xx` — Nexora-side failure; safe to retry with backoff (event id makes
  retries idempotent).

## Logging

Every inbound webhook (accepted, duplicate, invalid signature, or
validation failure) is written to `integration_logs` with a `direction`,
`level`, and `message`, visible on the store's **Integration Logs** page for
debugging, and it updates the parent `Integration`'s `lastWebhookAt` /
`failedRequestCount` counters that drive the 🟢/🟡/🔴 connection status.
