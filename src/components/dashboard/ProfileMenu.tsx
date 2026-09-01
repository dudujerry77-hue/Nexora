'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Settings, LogOut } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';

interface ProfileMenuProps {
  name: string;
  email: string;
  role: string | null;
  organizationName?: string | null;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProfileMenu({ name, email, role, organizationName }: ProfileMenuProps) {
  const router = useRouter();
  const { stores } = useStoreScope();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const avatarLabel = initials(name);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
      >
        {avatarLabel}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] card p-2 shadow-xl"
        >
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
              {avatarLabel}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-[rgb(var(--text-muted))]">{email}</p>
            </div>
          </div>

          <div className="my-2 border-t border-[rgb(var(--border))]" />

          <div className="space-y-1.5 px-2 py-1 text-sm">
            {role && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[rgb(var(--text-muted))]">Role</span>
                <span className="truncate font-medium capitalize">{role.toLowerCase()}</span>
              </div>
            )}
            {organizationName && (
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-[rgb(var(--text-muted))]">Organization</span>
                <span className="truncate font-medium">{organizationName}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[rgb(var(--text-muted))]">Connected stores</span>
              <span className="font-medium">{stores.length}</span>
            </div>
          </div>

          <div className="my-2 border-t border-[rgb(var(--border))]" />

          <Link
            href="/dashboard/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Settings className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Account settings
          </Link>
          <button
            onClick={logout}
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-red-500 hover:bg-red-500/10"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
