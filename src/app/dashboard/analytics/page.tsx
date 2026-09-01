'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { StatCard, ErrorState, LoadingSkeleton, EmptyState } from '@/components/dashboard/ui';

const RANGES = ['7d', '30d', '90d'] as const;

interface Overview {
  totalStores: number;
  connectedStores: number;
  ordersToday: number;
  pendingOrders: number;
  revenue: number;
  revenueRangeDays: number;
  lowStockCount: number;
  lowStockProducts: { id: string; name: string }[];
}

export default function AnalyticsPage() {
  const { selectedStoreId } = useStoreScope();
  const [range, setRange] = useState<(typeof RANGES)[number]>('7d');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ range });
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    apiFetch<Overview>(`/api/analytics/overview?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setOverview(res.data ?? null);
      setLoading(false);
    });
  }, [selectedStoreId, range]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Analytics</h1>
          <p className="text-sm text-[rgb(var(--text-muted))]">Revenue and health across your stores.</p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                range === r ? 'bg-brand-600 text-white' : 'border border-[rgb(var(--border))]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={2} />
      ) : error ? (
        <ErrorState message={error} />
      ) : overview ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={`Revenue (${range})`} value={`₦${overview.revenue.toLocaleString()}`} />
            <StatCard label="Orders today" value={overview.ordersToday} />
            <StatCard label="Pending orders" value={overview.pendingOrders} />
            <StatCard label="Connected stores" value={`${overview.connectedStores}/${overview.totalStores}`} />
          </div>
          <div className="card p-5">
            <h2 className="mb-4 font-semibold">Low-stock products</h2>
            {overview.lowStockProducts.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing running low" />
            ) : (
              <ul className="space-y-2 text-sm">
                {overview.lowStockProducts.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.75} aria-hidden="true" />
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
