'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';
import { ConnectionBadge, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Integration {
  id: string;
  provider: string;
  providerLabel: string;
  status: string;
  lastRequestAt: string | null;
  lastWebhookAt: string | null;
}

interface StoreDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  orderCount: number;
  productCount: number;
  integrations: Integration[];
  lastSyncAt: string | null;
}

const AVAILABLE_PROVIDERS = [
  { value: 'custom_api', label: 'Nexora API' },
  { value: 'custom_webhook', label: 'Nexora Webhooks' },
  { value: 'js_sdk', label: 'Nexora JavaScript SDK' },
];

export default function StoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { push } = useToast();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('custom_api');
  const [newSecret, setNewSecret] = useState<{ apiKey: string; webhookUrl: string | null; webhookSecret: string | null } | null>(null);

  function load() {
    setLoading(true);
    apiFetch<StoreDetail>(`/api/stores/${id}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setStore(res.data ?? null);
      setLoading(false);
    });
  }

  useEffect(load, [id]);

  async function createIntegration(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch<{ apiKey: string; webhookUrl: string | null; webhookSecret: string | null }>(
      '/api/integrations',
      { method: 'POST', body: JSON.stringify({ storeId: id, provider }) },
    );
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    setNewSecret(res.data ?? null);
    push('Integration created.', 'success');
    load();
  }

  async function disconnect(integrationId: string) {
    const res = await apiFetch(`/api/integrations/${integrationId}`, { method: 'DELETE' });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Integration disconnected.', 'success');
    load();
  }

  async function deleteStore() {
    if (!confirm(`Delete "${store?.name}"? This removes all its orders, products, and integrations.`)) return;
    const res = await apiFetch(`/api/stores/${id}`, { method: 'DELETE' });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Store deleted.', 'success');
    router.push('/dashboard/stores');
  }

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} />;
  if (!store) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{store.name}</h1>
          <p className="text-sm capitalize text-[rgb(var(--text-muted))]">{store.type}</p>
        </div>
        <button onClick={deleteStore} className="rounded-lg border border-red-400/50 px-3 py-2 text-sm text-red-500">
          Delete store
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-[rgb(var(--text-muted))]">Orders</p>
          <p className="text-xl font-bold">{store.orderCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[rgb(var(--text-muted))]">Products</p>
          <p className="text-xl font-bold">{store.productCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[rgb(var(--text-muted))]">Last sync</p>
          <p className="text-sm font-medium">{store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString() : 'Never'}</p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Integrations</h2>
        {store.integrations.length === 0 ? (
          <p className="text-sm text-[rgb(var(--text-muted))]">No integrations yet — connect one below.</p>
        ) : (
          <div className="space-y-2">
            {store.integrations.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-[rgb(var(--border))] px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{i.providerLabel}</p>
                  <p className="text-xs text-[rgb(var(--text-muted))]">
                    Last webhook: {i.lastWebhookAt ? new Date(i.lastWebhookAt).toLocaleString() : 'never'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <ConnectionBadge status={i.status} />
                  <button onClick={() => disconnect(i.id)} className="text-xs text-red-500">
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={createIntegration} className="mt-4 flex flex-wrap items-end gap-3 border-t border-[rgb(var(--border))] pt-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Connect a new integration</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            >
              {AVAILABLE_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Generate credentials
          </button>
        </form>

        {newSecret && (
          <div className="mt-4 rounded-lg border border-amber-400/50 bg-amber-50 p-4 text-sm dark:bg-amber-900/20">
            <p className="font-semibold">Save these now — they won&apos;t be shown again.</p>
            <p className="mt-2 font-mono text-xs break-all">API key: {newSecret.apiKey}</p>
            {newSecret.webhookUrl && <p className="mt-1 font-mono text-xs break-all">Webhook URL: {newSecret.webhookUrl}</p>}
            {newSecret.webhookSecret && (
              <p className="mt-1 font-mono text-xs break-all">Webhook secret: {newSecret.webhookSecret}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
