'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Store,
  Receipt,
  Package,
  Users,
  BarChart3,
  Bell,
  TrendingUp,
  Plug,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useStoreScope, type StoreSummary } from '@/lib/useStores';

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/stores', label: 'Stores', icon: Store },
  { href: '/dashboard/orders', label: 'Orders', icon: Receipt },
  { href: '/dashboard/products', label: 'Products', icon: Package },
  { href: '/dashboard/customers', label: 'Customers', icon: Users },
  { href: '/dashboard/inventory', label: 'Inventory', icon: BarChart3 },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/analytics', label: 'Analytics', icon: TrendingUp },
  { href: '/dashboard/integrations', label: 'Integrations', icon: Plug },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

// The "Connected stores" section must show exactly that — never a
// disconnected or merely-warning store — using the same canonical derived
// status (StoreSummary.status, computed server-side by deriveStoreStatus /
// storeSummary in src/lib/storeService.ts) already used by the Stores page
// and the Profile dropdown's connected-store count. No separate connection
// calculation here.
export function visibleSidebarStores(stores: StoreSummary[]): StoreSummary[] {
  return stores.filter((s) => s.status === 'connected');
}

function storeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { stores, selectedStoreId, setSelectedStoreId, loading: storesLoading } = useStoreScope();
  const [hovering, setHovering] = useState(false);
  const connectedStores = visibleSidebarStores(stores);

  // The sidebar is fixed/overlaid (both on mobile as a drawer and on
  // desktop when hover-revealing a collapsed rail) so that revealing labels
  // on hover never shifts the main content — only the separate spacer
  // below (sized by `collapsed` alone) reserves in-flow layout space.
  const expanded = mobileOpen || !collapsed || hovering;
  const isOverlaying = collapsed && hovering && !mobileOpen;

  // Clicking a connected store both sets the global selection (so every
  // other page picks it up instantly via context) and takes the user to
  // that store's own dashboard route — a highlight-only change here would
  // leave the user looking at the previous store's page.
  function selectStore(id: string) {
    setSelectedStoreId(id);
    onCloseMobile();
    router.push(`/dashboard/stores/${id}`);
  }

  const navContent = (
    <>
      <div className="flex items-center justify-between p-4">
        <Link href="/dashboard" className="block truncate text-lg font-bold tracking-tight">
          {expanded ? 'NEXORA' : 'N'}
        </Link>
        <button
          aria-label="Close navigation menu"
          onClick={onCloseMobile}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5 md:hidden"
        >
          <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className="hidden h-8 w-8 items-center justify-center rounded-lg text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5 md:flex"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronsLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/dashboard' ? pathname === item.href : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              title={expanded ? undefined : item.label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <item.icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {expanded && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}

        <div className="my-3 border-t border-[rgb(var(--border))]" role="separator" />

        {expanded && (
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--text-muted))]">
            Connected stores
          </p>
        )}

        {storesLoading ? (
          <div className="space-y-1 px-3">
            <div className="skeleton h-8 w-full" />
            <div className="skeleton h-8 w-full" />
          </div>
        ) : stores.length === 0 ? (
          expanded && <p className="px-3 text-xs text-[rgb(var(--text-muted))]">No stores yet</p>
        ) : connectedStores.length === 0 ? (
          expanded && <p className="px-3 text-xs text-[rgb(var(--text-muted))]">No connected stores yet</p>
        ) : (
          connectedStores.map((store) => {
            const active = store.id === selectedStoreId;
            return (
              <button
                key={store.id}
                onClick={() => selectStore(store.id)}
                title={store.name}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  active
                    ? 'bg-brand-600 text-white'
                    : 'text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    active ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                  }`}
                >
                  {storeInitials(store.name)}
                </span>
                {expanded && <span className="truncate">{store.name}</span>}
              </button>
            );
          })
        )}
      </nav>
    </>
  );

  return (
    <>
      {/* Spacer: reserves in-flow layout space on desktop, sized only by the
          pinned `collapsed` preference so a mere hover never reflows the
          main content. Hidden entirely on mobile, where the sidebar is a
          full overlay drawer instead. */}
      <div className={`hidden shrink-0 transition-[width] duration-200 md:block ${collapsed ? 'md:w-[4.5rem]' : 'md:w-60'}`} />

      {mobileOpen && (
        <button
          aria-label="Close navigation overlay"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[rgb(var(--border))] bg-[rgb(var(--bg))] transition-transform duration-200 md:transition-[width] ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } ${expanded ? 'md:w-60' : 'md:w-[4.5rem]'} ${isOverlaying ? 'md:shadow-xl' : ''}`}
      >
        {navContent}
      </aside>
    </>
  );
}
