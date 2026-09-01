'use client';

import { createContext, useContext } from 'react';

export interface StoreSummary {
  id: string;
  name: string;
  logoUrl: string | null;
  type: string;
  status: string;
  // "nexora_managed": create/edit products in this dashboard.
  // "developer_owned": the developer's own system owns product data; it
  // arrives via the existing API/webhook push paths.
  productMode: 'nexora_managed' | 'developer_owned';
  lastSyncAt: string | null;
  orderCount: number;
  productCount: number;
  integrationCount: number;
}

export interface StoreScopeValue {
  stores: StoreSummary[];
  // A real connected store id, or null only when the account has zero
  // connected stores. There is no "All Stores" value — every dashboard
  // page operates on exactly one selected store.
  selectedStoreId: string | null;
  setSelectedStoreId: (id: string | null) => void;
  refresh: () => void;
  loading: boolean;
}

export const StoreScopeContext = createContext<StoreScopeValue | null>(null);

export function useStoreScope(): StoreScopeValue {
  const ctx = useContext(StoreScopeContext);
  if (!ctx) throw new Error('useStoreScope must be used within the dashboard layout');
  return ctx;
}
