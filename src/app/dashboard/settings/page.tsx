'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock, FileText, Store as StoreIcon } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useSession } from '@/lib/useSession';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { EmptyState, LoadingSkeleton } from '@/components/dashboard/ui';
import { MonitoringPanel } from '@/components/dashboard/MonitoringPanel';

interface AuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

function SelectedStoreSettings() {
  const { stores, selectedStoreId, refresh } = useStoreScope();
  const { session } = useSession();
  const { push } = useToast();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingProductMode, setSavingProductMode] = useState(false);

  const store = stores.find((s) => s.id === selectedStoreId) ?? null;
  const isOwner = session?.memberRole === 'OWNER';

  useEffect(() => {
    setName(store?.name ?? '');
  }, [store?.id, store?.name]);

  if (!store) {
    return (
      <EmptyState
        icon={StoreIcon}
        title="No store selected"
        body='Pick a store from the switcher at the top of the dashboard, or from "Connected stores" in the sidebar, to manage it here.'
      />
    );
  }

  async function renameStore(e: React.FormEvent) {
    e.preventDefault();
    if (!store || !name.trim() || name.trim() === store.name) return;
    setRenaming(true);
    const res = await apiFetch(`/api/stores/${store.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
    setRenaming(false);
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Store renamed.', 'success');
    refresh();
  }

  async function changeProductMode(mode: 'nexora_managed' | 'developer_owned') {
    if (!store || mode === store.productMode) return;
    setSavingProductMode(true);
    const res = await apiFetch(`/api/stores/${store.id}`, { method: 'PATCH', body: JSON.stringify({ productMode: mode }) });
    setSavingProductMode(false);
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Product system updated.', 'success');
    refresh();
  }

  async function deleteStore() {
    if (!store) return;
    if (!confirm(`Delete "${store.name}"? This permanently removes its orders, products, customers, and integrations.`)) return;
    setDeleting(true);
    const res = await apiFetch(`/api/stores/${store.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Store deleted.', 'success');
    refresh();
  }

  return (
    <div className="space-y-5">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[rgb(var(--text-muted))]">Type</dt>
          <dd className="capitalize">{store.type}</dd>
        </div>
        <div>
          <dt className="text-xs text-[rgb(var(--text-muted))]">Status</dt>
          <dd className="capitalize">{store.status}</dd>
        </div>
        <div>
          <dt className="text-xs text-[rgb(var(--text-muted))]">Orders</dt>
          <dd>{store.orderCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-[rgb(var(--text-muted))]">Products</dt>
          <dd>{store.productCount}</dd>
        </div>
      </dl>

      <div className="border-t border-[rgb(var(--border))] pt-4">
        <p className="mb-1 text-sm font-medium">Product system</p>
        <p className="mb-3 text-xs text-[rgb(var(--text-muted))]">
          Choose who owns this store&apos;s product catalog.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={!isOwner || savingProductMode}
            onClick={() => changeProductMode('nexora_managed')}
            className={`rounded-lg border p-3 text-left text-sm disabled:opacity-60 ${
              store.productMode === 'nexora_managed' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[rgb(var(--border))]'
            }`}
          >
            <span className="block font-medium">Nexora-managed</span>
            <span className="block text-xs text-[rgb(var(--text-muted))]">Create and edit products in this dashboard.</span>
          </button>
          <button
            type="button"
            disabled={!isOwner || savingProductMode}
            onClick={() => changeProductMode('developer_owned')}
            className={`rounded-lg border p-3 text-left text-sm disabled:opacity-60 ${
              store.productMode === 'developer_owned' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[rgb(var(--border))]'
            }`}
          >
            <span className="block font-medium">Developer-owned</span>
            <span className="block text-xs text-[rgb(var(--text-muted))]">Products sync in via your API key or webhook.</span>
          </button>
        </div>
      </div>

      {!isOwner ? (
        <p className="text-sm text-[rgb(var(--text-muted))]">Only owners can rename or delete a store.</p>
      ) : (
        <>
          <form onSubmit={renameStore} className="flex flex-wrap items-end gap-3 border-t border-[rgb(var(--border))] pt-4">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium">Store name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full min-w-0 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={renaming || !name.trim() || name.trim() === store.name}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {renaming ? 'Saving…' : 'Rename'}
            </button>
          </form>

          <div className="border-t border-[rgb(var(--border))] pt-4">
            <p className="mb-2 text-sm font-medium text-red-500">Danger zone</p>
            <p className="mb-3 text-xs text-[rgb(var(--text-muted))]">
              Deleting a store permanently removes its orders, products, customers, and integrations. This cannot be undone.
            </p>
            <button
              onClick={deleteStore}
              disabled={deleting}
              className="rounded-lg border border-red-400/50 px-4 py-2 text-sm text-red-500 disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : `Delete "${store.name}"`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent() {
  const { session } = useSession();
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session?.memberRole !== 'OWNER') return;
    apiFetch<AuditLog[]>('/api/audit-logs').then((res) => {
      if (res.data) setLogs(res.data);
      else setNotice(res.error?.message ?? null);
    });
  }, [session]);

  // Deep-link support for ProfileMenu's "Reports" item
  // (/dashboard/settings?tab=reports) — Reports lives inline on this page
  // rather than as a separate route, so linking to it just scrolls here.
  useEffect(() => {
    if (searchParams.get('tab') === 'reports') {
      document.getElementById('reports')?.scrollIntoView({ block: 'start' });
    }
  }, [searchParams]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Your account and organization.</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Account</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Name</dt>
            <dd>{session?.user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Email</dt>
            <dd>{session?.user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Organization</dt>
            <dd>{session?.organization?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Role</dt>
            <dd className="capitalize">{session?.memberRole?.toLowerCase()}</dd>
          </div>
        </dl>
      </div>

      <div className="card p-5">
        <h2 className="mb-1 font-semibold">Selected store</h2>
        <p className="mb-4 text-sm text-[rgb(var(--text-muted))]">
          Manage the store currently selected in the switcher at the top of the dashboard.
        </p>
        <SelectedStoreSettings />
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-semibold">Staff & permissions</h2>
        <p className="text-sm text-[rgb(var(--text-muted))]">
          Inviting staff and assigning per-store permissions is planned for a future release — the data model
          (<code className="rounded bg-black/5 px-1 dark:bg-white/10">Member</code> /
          <code className="rounded bg-black/5 px-1 dark:bg-white/10"> StoreAssignment</code>) already supports it, but
          there is no invite flow in this MVP yet.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="mb-1 font-semibold">Reports</h2>
        <p className="mb-4 text-sm text-[rgb(var(--text-muted))]">
          Automatic monitoring for the selected store — errors, crashes, and failed requests reported by your
          connected website/app, grouped and updated live.
        </p>
        <MonitoringPanel />
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Audit log</h2>
        {session?.memberRole !== 'OWNER' ? (
          <EmptyState icon={Lock} title="Owners only" body="Ask an owner on your team to view the audit log." />
        ) : logs === null && !notice ? (
          <LoadingSkeleton rows={3} />
        ) : notice ? (
          <p className="text-sm text-[rgb(var(--text-muted))]">{notice}</p>
        ) : logs && logs.length === 0 ? (
          <EmptyState icon={FileText} title="No audit events yet" />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {logs?.map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border))] py-2 last:border-0">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{log.actor?.name ?? 'System'}</span> {log.action.replace(/\./g, ' ')}
                  {log.targetType ? ` (${log.targetType})` : ''}
                </span>
                <span className="shrink-0 text-xs text-[rgb(var(--text-muted))]">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
