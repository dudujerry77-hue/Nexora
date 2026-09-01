'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: '🏠' },
  { href: '/dashboard/stores', label: 'Stores', icon: '🏬' },
  { href: '/dashboard/orders', label: 'Orders', icon: '🧾' },
  { href: '/dashboard/products', label: 'Products', icon: '📦' },
  { href: '/dashboard/customers', label: 'Customers', icon: '👥' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '📊' },
  { href: '/dashboard/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '📈' },
  { href: '/dashboard/integrations', label: 'Integrations', icon: '🔌' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
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
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
