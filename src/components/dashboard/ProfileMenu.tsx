'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Settings, LogOut, FileWarning } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';

interface ProfileMenuProps {
  name: string;
  email: string;
  role: string | null;
  organizationName?: string | null;
  avatarUrl?: string | null;
  // Controlled by the dashboard header so opening this dropdown can close
  // the notification dropdown (and vice versa) — see NotificationBellProps.open
  // for the same contract on the other side.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// How long a hover-close is delayed after the pointer leaves the
// avatar/dropdown area — long enough to bridge the small gap between the
// avatar button and the dropdown below it (so moving the mouse from one to
// the other doesn't flicker-close), short enough that the menu doesn't
// linger once the pointer is genuinely gone. Touch devices never fire
// mouseenter/mouseleave at all, so this only ever affects desktop hover —
// tap-to-toggle (the existing onClick) remains the only way to open/close
// on mobile, unchanged.
const HOVER_CLOSE_GRACE_MS = 250;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProfileMenu({ name, email, role, organizationName, avatarUrl, open, onOpenChange }: ProfileMenuProps) {
  const router = useRouter();
  const { stores } = useStoreScope();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (openRef.current && containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && openRef.current) onOpenChange(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel any pending close if the component unmounts mid-timer.
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function openNow() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    onOpenChange(true);
  }

  function closeWithGrace() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Guarded by openRef so a stale timer (e.g. left over from a hover that
    // ended right as the notification bell was opened, stealing this
    // dropdown's "open" slot) can't clobber whatever is open now — it only
    // closes this dropdown if this dropdown is still the one that's open.
    closeTimer.current = setTimeout(() => {
      if (openRef.current) onOpenChange(false);
    }, HOVER_CLOSE_GRACE_MS);
  }

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const avatarLabel = initials(name);

  return (
    <div className="relative" ref={containerRef} onMouseEnter={openNow} onMouseLeave={closeWithGrace}>
      <button
        onClick={() => onOpenChange(!open)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          avatarLabel
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] card p-2 shadow-xl"
        >
          <Link
            href="/dashboard/settings"
            role="menuitem"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-sm font-semibold text-white">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                avatarLabel
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-[rgb(var(--text-muted))]">{email}</p>
            </div>
          </Link>

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
              {/* Derived status, same as the Stores page (deriveStoreStatus via
                  GET /api/stores) — a merely-created store with no active
                  integration is not "connected". */}
              <span className="font-medium">{stores.filter((s) => s.status === 'connected').length}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[rgb(var(--text-muted))]">Total stores</span>
              <span className="font-medium">{stores.length}</span>
            </div>
          </div>

          <div className="my-2 border-t border-[rgb(var(--border))]" />

          <Link
            href="/dashboard/settings"
            role="menuitem"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Settings className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Account settings
          </Link>
          <Link
            href="/dashboard/settings?tab=reports"
            role="menuitem"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <FileWarning className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Reports
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
