'use client';

import { useStoreScope } from '@/lib/useStores';

// There is no "All Stores" mode — a `<select>` here always represents a
// single real connected store. When the account has zero stores, the
// control is a disabled placeholder, never a selectable "no store" option.
export function StoreSwitcher() {
  const { stores, selectedStoreId, setSelectedStoreId, loading } = useStoreScope();

  if (loading) return <div className="skeleton h-9 w-40" />;

  if (stores.length === 0) {
    return (
      <select
        disabled
        value=""
        aria-label="Selected store"
        className="min-w-0 max-w-[6.5rem] truncate rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-2 text-sm text-[rgb(var(--text-muted))] xs:max-w-[9rem] sm:max-w-none sm:px-3"
      >
        <option value="">No stores</option>
      </select>
    );
  }

  return (
    <select
      value={selectedStoreId ?? ''}
      onChange={(e) => setSelectedStoreId(e.target.value)}
      aria-label="Selected store"
      className="min-w-0 max-w-[6.5rem] truncate rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-2 text-sm xs:max-w-[9rem] sm:max-w-none sm:px-3"
    >
      {!selectedStoreId && (
        <option value="" disabled>
          Select store
        </option>
      )}
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
