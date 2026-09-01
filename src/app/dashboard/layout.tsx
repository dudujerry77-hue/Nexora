'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { StoreSwitcher } from '@/components/dashboard/StoreSwitcher';
import { NotificationBell } from '@/components/dashboard/NotificationBell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { StoreScopeContext, StoreSummary } from '@/lib/useStores';
import { useSession } from '@/lib/useSession';
import { apiFetch } from '@/lib/apiClient';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [storesLoading, setStoresLoading] = useState(true);

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

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
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
        <Sidebar />
        <div className="flex-1">
          <header className="flex items-center justify-between border-b border-[rgb(var(--border))] px-6 py-3">
            <StoreSwitcher />
            <div className="flex items-center gap-3">
              <NotificationBell />
              <ThemeToggle />
              <div className="flex items-center gap-2 pl-2">
                <span className="hidden text-sm font-medium sm:inline">{session.user.name}</span>
                <button onClick={logout} className="text-sm text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]">
                  Log out
                </button>
              </div>
            </div>
          </header>
          <main className="p-6">{children}</main>
        </div>
      </div>
    </StoreScopeContext.Provider>
  );
}
