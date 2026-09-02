import { describe, it, expect } from 'vitest';
import { visibleSidebarStores } from '@/components/dashboard/Sidebar';
import type { StoreSummary } from '@/lib/useStores';

// visibleSidebarStores is the pure filter behind the Sidebar's "Connected
// stores" section — extracted specifically so this can be verified without
// a component-rendering harness (none exists in this repo; see
// tests/storeStatus.test.ts for the same pattern applied to the server-side
// deriveStoreStatus). It must reuse StoreSummary.status exactly as returned
// by GET /api/stores (already the canonical derived value — see
// src/lib/storeService.ts storeSummary()), never a second calculation.

function store(overrides: Partial<StoreSummary> & Pick<StoreSummary, 'id' | 'status'>): StoreSummary {
  return {
    name: 'Store',
    logoUrl: null,
    type: 'other',
    productMode: 'nexora_managed',
    lastSyncAt: null,
    orderCount: 0,
    productCount: 0,
    integrationCount: 0,
    ...overrides,
  };
}

describe('Sidebar "Connected stores" filtering', () => {
  it('includes a connected store', () => {
    const connected = store({ id: 'a', name: 'Iya Kudinka Restaurant', status: 'connected' });
    expect(visibleSidebarStores([connected])).toEqual([connected]);
  });

  it('excludes a disconnected store', () => {
    const disconnected = store({ id: 'b', name: 'Never Connected Store', status: 'disconnected' });
    expect(visibleSidebarStores([disconnected])).toEqual([]);
  });

  it('excludes a warning-status store', () => {
    const warning = store({ id: 'c', name: 'Stale Store', status: 'warning' });
    expect(visibleSidebarStores([warning])).toEqual([]);
  });

  it('returns only the connected subset from a mixed list, preserving each store\'s identity for downstream selected-store highlighting', () => {
    const connected = store({ id: 'connected-1', name: 'Connected', status: 'connected' });
    const disconnected = store({ id: 'disconnected-1', name: 'Disconnected', status: 'disconnected' });
    const warning = store({ id: 'warning-1', name: 'Warning', status: 'warning' });
    const otherConnected = store({ id: 'connected-2', name: 'Other Connected', status: 'connected' });

    const visible = visibleSidebarStores([connected, disconnected, warning, otherConnected]);

    expect(visible.map((s) => s.id)).toEqual(['connected-1', 'connected-2']);
    // The selected store's own object is passed through unchanged, so the
    // component's `store.id === selectedStoreId` highlight check downstream
    // still resolves correctly for whichever connected store is selected.
    const selectedStoreId = 'connected-2';
    expect(visible.find((s) => s.id === selectedStoreId)).toBe(otherConnected);
  });

  it('returns an empty array (clean empty state) when no store is connected', () => {
    const disconnected = store({ id: 'd', status: 'disconnected' });
    const warning = store({ id: 'e', status: 'warning' });
    expect(visibleSidebarStores([disconnected, warning])).toEqual([]);
  });
});
