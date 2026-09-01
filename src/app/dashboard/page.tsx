'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { StatCard, ErrorState, LoadingSkeleton, EmptyState, OrderStatusBadge } from '@/components/dashboard/ui';

interface Overview {
  totalStores: number;
  connectedStores: number;
  ordersToday: number;
  pendingOrders: number;
  revenue: number;
  lowStockCount: number;
  lowStockProducts: { id: string; name: string }[];
  recentOrders: { id: string; externalId: string; customerName: string; total: number; currency: string; status: string; store: { name: string } }[];
  recentNotifications: { id: string; title: string; body: string; createdAt: string }[];
}

export default function OverviewPage() {
  const { selectedStoreId } = useStoreScope();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = selectedStoreId ? `?storeId=${selectedStoreId}` : '';
    apiFetch<Overview>(`/api/analytics/overview${qs}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setOverview(res.data ?? null);
      setLoading(false);
    });
  }, [selectedStoreId]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error) return <ErrorState message={error} />;
  if (!overview) return null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Overview</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Everything happening across your stores, right now.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total stores" value={overview.totalStores} />
        <StatCard label="Connected stores" value={overview.connectedStores} />
        <StatCard label="Orders today" value={overview.ordersToday} />
        <StatCard label="Pending orders" value={overview.pendingOrders} />
        <StatCard label="Revenue (7d)" value={`₦${overview.revenue.toLocaleString()}`} />
        <StatCard label="Low-stock products" value={overview.lowStockCount} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Recent orders</h2>
          {overview.recentOrders.length === 0 ? (
            <EmptyState icon="🧾" title="No orders yet" body="Orders from your connected stores will show up here." />
          ) : (
            <div className="space-y-3">
              {overview.recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/dashboard/orders`}
                  className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <div>
                    <p className="font-medium">#{o.externalId} · {o.customerName}</p>
                    <p className="text-xs text-[rgb(var(--text-muted))]">{o.store.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">
                      {o.currency} {o.total.toLocaleString()}
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Recent notifications</h2>
          {overview.recentNotifications.length === 0 ? (
            <EmptyState icon="🔔" title="No notifications yet" />
          ) : (
            <div className="space-y-3">
              {overview.recentNotifications.map((n) => (
                <div key={n.id} className="rounded-lg px-2 py-2 text-sm">
                  <p className="font-medium">{n.title}</p>
                  <p className="text-xs text-[rgb(var(--text-muted))]">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
