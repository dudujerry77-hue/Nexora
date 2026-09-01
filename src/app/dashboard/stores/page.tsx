'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { ConnectionBadge, EmptyState, LoadingSkeleton } from '@/components/dashboard/ui';

const STORE_TYPES = ['restaurant', 'fashion', 'retail', 'electronics', 'other'] as const;

export default function StoresPage() {
  const { stores, loading, refresh } = useStoreScope();
  const { push } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof STORE_TYPES)[number]>('other');
  const [submitting, setSubmitting] = useState(false);

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await apiFetch('/api/stores', { method: 'POST', body: JSON.stringify({ name, type }) });
    setSubmitting(false);
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Store created.', 'success');
    setName('');
    setShowForm(false);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Stores</h1>
          <p className="text-sm text-[rgb(var(--text-muted))]">Every website or app connected to Nexora.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New store
        </button>
      </div>

      {showForm && (
        <form onSubmit={createStore} className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Store name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Iya Kudinka Restaurant"
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as (typeof STORE_TYPES)[number])}
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm capitalize"
            >
              {STORE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : stores.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No stores connected yet"
          body='Create a store like "Iya Kudinka Restaurant" to get an API key, webhook URL, and SDK snippet.'
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((store) => (
            <Link key={store.id} href={`/dashboard/stores/${store.id}`} className="card block p-5 hover:border-brand-500">
              <div className="flex items-center justify-between gap-2">
                <h3 className="min-w-0 truncate font-semibold">{store.name}</h3>
                <ConnectionBadge status={store.status} />
              </div>
              <p className="mt-1 text-xs capitalize text-[rgb(var(--text-muted))]">{store.type}</p>
              <div className="mt-4 flex gap-4 text-sm">
                <span>{store.orderCount} orders</span>
                <span>{store.productCount} products</span>
                <span>{store.integrationCount} integrations</span>
              </div>
              <p className="mt-2 text-xs text-[rgb(var(--text-muted))]">
                Last sync: {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString() : 'Never'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
