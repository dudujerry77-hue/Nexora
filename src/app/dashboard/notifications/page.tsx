'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, AlertTriangle, AlertOctagon, ArrowRightLeft, type LucideIcon } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  readAt: string | null;
  createdAt: string;
  storeId: string | null;
  store: { id: string; name: string } | null;
}

const SEVERITY_ICON: Record<Notification['severity'], { icon: LucideIcon; className: string }> = {
  info: { icon: Bell, className: 'text-brand-600 dark:text-brand-400' },
  warning: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' },
  critical: { icon: AlertOctagon, className: 'text-red-500' },
};

// Same stable "selected store first" ordering the bell uses — see
// src/components/dashboard/NotificationBell.tsx for why this is a plain
// client-side sort rather than a server concern (selection is per-browser
// state; "which stores are visible at all" is the server's job instead,
// already enforced by GET /api/notifications).
function sortBySelectedStoreFirst(notifications: Notification[], selectedStoreId: string | null): Notification[] {
  return [...notifications].sort((a, b) => {
    const aFirst = a.storeId === selectedStoreId ? 0 : 1;
    const bFirst = b.storeId === selectedStoreId ? 0 : 1;
    return aFirst - bFirst;
  });
}

export default function NotificationsPage() {
  const router = useRouter();
  const { selectedStoreId, setSelectedStoreId } = useStoreScope();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllStores, setShowAllStores] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    // "This store only" vs the global (connected-stores-only) view — see
    // GET /api/notifications: an explicit storeId narrows to just that
    // store; omitting it returns every currently-connected store's
    // notifications, same as the bell.
    if (!showAllStores && selectedStoreId) params.set('storeId', selectedStoreId);
    apiFetch<Notification[]>(`/api/notifications?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setNotifications(res.data ?? []);
      setLoading(false);
    });
  }, [selectedStoreId, showAllStores]);

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  function switchToStore(storeId: string, event: React.MouseEvent) {
    event.stopPropagation();
    setSelectedStoreId(storeId);
    router.push(`/dashboard/stores/${storeId}`);
  }

  const ordered = showAllStores ? sortBySelectedStoreFirst(notifications, selectedStoreId) : notifications;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Notifications</h1>
          <p className="text-sm text-[rgb(var(--text-muted))]">New orders, low stock, and connection alerts.</p>
        </div>
        <button
          onClick={() => setShowAllStores((v) => !v)}
          className="shrink-0 rounded-lg border border-[rgb(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
        >
          {showAllStores ? 'Show selected store only' : 'Show all connected stores'}
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : ordered.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet" />
      ) : (
        <div className="card divide-y divide-[rgb(var(--border))]">
          {ordered.map((n) => {
            const severity = SEVERITY_ICON[n.severity];
            const isOtherStore = showAllStores && n.storeId !== null && n.storeId !== selectedStoreId;
            return (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 ${
                  !n.readAt ? 'bg-brand-50 dark:bg-brand-900/10' : ''
                }`}
              >
                <severity.icon className={`h-5 w-5 shrink-0 ${severity.className}`} strokeWidth={1.75} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {n.store && <p className="truncate text-xs font-semibold text-[rgb(var(--text-muted))]">{n.store.name}</p>}
                  <div className="flex items-center gap-2">
                    {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />}
                    <p className="truncate text-sm font-medium">{n.title}</p>
                  </div>
                  <p className="text-sm text-[rgb(var(--text-muted))]">{n.body}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <p className="text-xs text-[rgb(var(--text-muted))]">{new Date(n.createdAt).toLocaleString()}</p>
                    {isOtherStore && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => switchToStore(n.storeId!, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') switchToStore(n.storeId!, e as unknown as React.MouseEvent);
                        }}
                        className="flex items-center gap-1 text-xs font-medium text-brand-600 underline dark:text-brand-400"
                      >
                        <ArrowRightLeft className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        Switch to {n.store?.name}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
