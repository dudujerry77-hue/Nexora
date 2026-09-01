'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  type LucideIcon,
} from 'lucide-react';

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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-[rgb(var(--border))] p-4 md:block">
      <Link href="/dashboard" className="mb-8 block px-2 text-lg font-bold tracking-tight">
        NEXORA
      </Link>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/dashboard' ? pathname === item.href : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <item.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
