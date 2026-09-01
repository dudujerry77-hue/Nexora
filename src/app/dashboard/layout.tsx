'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { StoreSwitcher } from '@/components/dashboard/StoreSwitcher';
import { NotificationBell } from '@/components/dashboard/NotificationBell';
import { ProfileMenu } from '@/components/dashboard/ProfileMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { StoreScopeContext, StoreSummary } from '@/lib/useStores';
import { useSession } from '@/lib/useSession';
import { apiFetch } from '@/lib/apiClient';

const SELECTED_STORE_KEY = 'nexora-selected-store';
const SIDEBAR_COLLAPSED_KEY = 'nexora-sidebar-collapsed';

// There is no "All Stores" mode: `selectedStoreId` is either a real,
// currently-connected store id, or null (only possible when the account
// has zero connected stores, or before the store list has loaded once).
// The stored value is either a real id or absent — never a sentinel.
function readStoredStoreId(): string | null {
  try {
    return localStorage.getItem(SELECTED_STORE_KEY);
  } catch {
    return null;
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const [stores, setStores] = useState<StoreSummary[]>([]);
  // Lazy-initialized from localStorage so the selected store survives a
  // full page refresh, not just client-side navigation. Validated against
  // the loaded store list below once it arrives (e.g. a store since
  // deleted, or belonging to a different account, falls back to another
  // real connected store — never to a no-op "All Stores" state).
  const [selectedStoreId, setSelectedStoreIdState] = useState<string | null>(readStoredStoreId);
  const [storesLoading, setStoresLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
    } catch {
      // ignore — default to expanded
    }
  }, []);

  // `id` must be a real store id — there is no "all stores" value to pass
  // here. Passing null clears the selection entirely (only meaningful when
  // the account has zero connected stores).
  const setSelectedStoreId = useCallback((id: string | null) => {
    setSelectedStoreIdState(id);
    try {
      if (id) localStorage.setItem(SELECTED_STORE_KEY, id);
      else localStorage.removeItem(SELECTED_STORE_KEY);
    } catch {
      // localStorage unavailable — selection still works for this session.
    }
  }, []);

  const refresh = useCallback(() => {
    setStoresLoading(true);
    apiFetch<StoreSummary[]>('/api/stores').then((res) => {
      if (res.data) setStores(res.data);
      setStoresLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!sessionLoading && session?.user.role === 'SUPER_ADMIN') {
      router.push('/nexora-admin');
      return;
    }
    if (!sessionLoading) refresh();
  }, [sessionLoading, session, router, refresh]);

  // Once the real store list loads, `selectedStoreId` must always resolve
  // to a real connected store when one exists — there is no valid "no
  // selection while stores exist" state to leave it in:
  //   - A persisted id that no longer refers to a store this account can
  //     see (deleted, revoked access, or restored from a different
  //     account's browser profile) is replaced with a real store.
  //   - No selection at all (first-ever login, nothing in localStorage) is
  //     resolved the same way, to the first connected store.
  // Only when the account has zero connected stores does this leave
  // `selectedStoreId` as null, which is the sole legitimate "no store"
  // state (rendered as a neutral placeholder, never as "All Stores").
  useEffect(() => {
    if (storesLoading) return;
    const stillValid = selectedStoreId && stores.some((s) => s.id === selectedStoreId);
    if (!stillValid) {
      setSelectedStoreId(stores[0]?.id ?? null);
    }
  }, [storesLoading, stores, selectedStoreId, setSelectedStoreId]);

  function toggleSidebarCollapsed() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch {
      // ignore
    }
  }

  if (sessionLoading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="skeleton h-8 w-40" />
      </div>
    );
  }

  return (
    <StoreScopeContext.Provider value={{ stores, selectedStoreId, setSelectedStoreId, refresh, loading: storesLoading }}>
      <div className="flex min-h-screen">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                aria-label="Open navigation menu"
                onClick={() => setMobileNavOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--border))] md:hidden"
              >
                <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </button>
              <StoreSwitcher />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              <NotificationBell />
              <ThemeToggle />
              <ProfileMenu
                name={session.user.name}
                email={session.user.email}
                role={session.memberRole}
                organizationName={session.organization?.name}
              />
            </div>
          </header>
          <main className="max-w-full overflow-x-hidden p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </StoreScopeContext.Provider>
  );
}
