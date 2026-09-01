'use client';

import { createContext, useContext } from 'react';

export interface StoreSummary {
  id: string;
  name: string;
  logoUrl: string | null;
  type: string;
  status: string;
  lastSyncAt: string | null;
  orderCount: number;
  productCount: number;
  integrationCount: number;
}

export interface StoreScopeValue {
  stores: StoreSummary[];
  selectedStoreId: string | null; // null = "All Stores"
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
