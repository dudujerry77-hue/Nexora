export type ConnectionStatus = 'connected' | 'warning' | 'disconnected';

const WARNING_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const DISCONNECTED_AFTER_MS = 72 * 60 * 60 * 1000; // 72h

/**
 * Status is derived from activity, not manually toggled — see
 * docs/INTEGRATIONS.md "Connection health".
 */
export function computeStatus(params: {
  lastRequestAt: Date | null;
  lastWebhookAt: Date | null;
  failedRequestCount: number;
  now?: Date;
}): ConnectionStatus {
  const now = params.now ?? new Date();
  const lastActivity = [params.lastRequestAt, params.lastWebhookAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (!lastActivity) return 'disconnected';

  const age = now.getTime() - lastActivity.getTime();
  if (age >= DISCONNECTED_AFTER_MS) return 'disconnected';
  if (age >= WARNING_AFTER_MS || params.failedRequestCount > 0) return 'warning';
  return 'connected';
}

export const PROVIDER_LABELS: Record<string, { label: string; available: boolean }> = {
  custom_api: { label: 'Nexora API', available: true },
  custom_webhook: { label: 'Nexora Webhooks', available: true },
  js_sdk: { label: 'Nexora JavaScript SDK', available: true },
  woocommerce: { label: 'WooCommerce (planned)', available: false },
  shopify: { label: 'Shopify (planned)', available: false },
};
