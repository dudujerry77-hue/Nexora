'use client';

import { useStoreScope } from '@/lib/useStores';

export function StoreSwitcher() {
  const { stores, selectedStoreId, setSelectedStoreId, loading } = useStoreScope();

  if (loading) return <div className="skeleton h-9 w-40" />;

  return (
    <select
      value={selectedStoreId ?? 'all'}
      onChange={(e) => setSelectedStoreId(e.target.value === 'all' ? null : e.target.value)}
      aria-label="Selected store"
      className="min-w-0 max-w-[6.5rem] truncate rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-2 text-sm xs:max-w-[9rem] sm:max-w-none sm:px-3"
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
