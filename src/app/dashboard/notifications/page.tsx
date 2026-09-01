'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Notification {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  readAt: string | null;
  createdAt: string;
}

const SEVERITY_ICON: Record<Notification['severity'], string> = { info: '🔔', warning: '⚠️', critical: '🚨' };

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Notification[]>('/api/notifications').then((res) => {
      if (res.error) setError(res.error.message);
      else setNotifications(res.data ?? []);
      setLoading(false);
    });
  }, []);

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Notifications</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">New orders, low stock, and connection alerts.</p>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : notifications.length === 0 ? (
        <EmptyState icon="🔔" title="No notifications yet" />
      ) : (
        <div className="card divide-y divide-[rgb(var(--border))]">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => markRead(n.id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 ${
                !n.readAt ? 'bg-brand-50 dark:bg-brand-900/10' : ''
              }`}
            >
              <span className="text-lg">{SEVERITY_ICON[n.severity]}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
                  <p className="text-sm font-medium">{n.title}</p>
                </div>
                <p className="text-sm text-[rgb(var(--text-muted))]">{n.body}</p>
                <p className="mt-1 text-xs text-[rgb(var(--text-muted))]">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
