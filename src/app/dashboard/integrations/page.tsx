'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
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
  integrationLogs: { id: string; level: string; message: string; createdAt: string }[];
}

const PLANNED_CONNECTORS = [
  { label: 'WooCommerce', icon: '🛒' },
  { label: 'Shopify', icon: '🛍️' },
];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Integration[]>('/api/integrations').then((res) => {
      if (res.error) setError(res.error.message);
      else setIntegrations(res.data ?? []);
      setLoading(false);
    });
  }, []);

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
        <EmptyState icon="🔌" title="No integrations yet" body="Open a store and connect the Nexora API, Webhooks, or JS SDK." />
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
              {i.integrationLogs.length > 0 && (
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
              <span className="text-2xl">{c.icon}</span>
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
