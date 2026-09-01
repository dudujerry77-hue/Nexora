'use client';

import { useStoreScope } from '@/lib/useStores';

export function StoreSwitcher() {
  const { stores, selectedStoreId, setSelectedStoreId, loading } = useStoreScope();

  if (loading) return <div className="skeleton h-9 w-40" />;

  return (
    <select
      value={selectedStoreId ?? 'all'}
      onChange={(e) => setSelectedStoreId(e.target.value === 'all' ? null : e.target.value)}
      className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
    >
      <option value="all">All Stores</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
