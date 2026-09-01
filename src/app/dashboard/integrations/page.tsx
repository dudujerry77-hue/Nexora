'use client';

import { useEffect, useState } from 'react';
import { Plug, ShoppingCart, ShoppingBag, type LucideIcon } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { ConnectionBadge, EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Integration {
  id: string;
  provider: string;
  providerLabel: string;
  status: string;
  lastRequestAt: string | null;
  lastWebhookAt: string | null;
  failedRequestCount: number;
  storeId: string;
  // Only populated by GET /api/integrations/:id — the list endpoint this
  // page uses doesn't include it, so it's absent on every row here.
  integrationLogs?: { id: string; level: string; message: string; createdAt: string }[];
}

const PLANNED_CONNECTORS: { label: string; icon: LucideIcon }[] = [
  { label: 'WooCommerce', icon: ShoppingCart },
  { label: 'Shopify', icon: ShoppingBag },
];

export default function IntegrationsPage() {
  const { selectedStoreId } = useStoreScope();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    apiFetch<Integration[]>(`/api/integrations?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setIntegrations(res.data ?? []);
      setLoading(false);
    });
  }, [selectedStoreId]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Integrations</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Connectors across every store. Manage credentials from a store&apos;s page.</p>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : integrations.length === 0 ? (
        <EmptyState icon={Plug} title="No integrations yet" body="Open a store and connect the Nexora API, Webhooks, or JS SDK." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {integrations.map((i) => (
            <div key={i.id} className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{i.providerLabel}</h3>
                <ConnectionBadge status={i.status} />
              </div>
              <div className="mt-3 space-y-1 text-xs text-[rgb(var(--text-muted))]">
                <p>Last request: {i.lastRequestAt ? new Date(i.lastRequestAt).toLocaleString() : 'never'}</p>
                <p>Last webhook: {i.lastWebhookAt ? new Date(i.lastWebhookAt).toLocaleString() : 'never'}</p>
                <p>Failed requests: {i.failedRequestCount}</p>
              </div>
              {i.integrationLogs && i.integrationLogs.length > 0 && (
                <div className="mt-3 border-t border-[rgb(var(--border))] pt-3">
                  <p className="mb-1 text-xs font-semibold">Recent logs</p>
                  <ul className="space-y-1 text-xs text-[rgb(var(--text-muted))]">
                    {i.integrationLogs.slice(0, 3).map((log) => (
                      <li key={log.id}>
                        [{log.level}] {log.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-3 font-semibold">Coming soon</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PLANNED_CONNECTORS.map((c) => (
            <div key={c.label} className="card flex items-center gap-3 p-5 opacity-60">
              <c.icon className="h-6 w-6 text-[rgb(var(--text-muted))]" strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-xs text-[rgb(var(--text-muted))]">Planned — not available in this MVP.</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
