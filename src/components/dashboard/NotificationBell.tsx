'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, ArrowRightLeft } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';
import { useStoreScope } from '@/lib/useStores';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  readAt: string | null;
  createdAt: string;
  storeId: string | null;
  store: { id: string; name: string } | null;
}

function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio not available (autoplay policy, unsupported browser) — safe to skip.
  }
}

function formatType(type: string): string {
  return type.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Selected-store notifications first, then every other (already
 * connected-only, per GET /api/notifications) store's — a stable sort so
 * the API's newest-first order is preserved within each group. There is
 * no "All Stores" grouping to special-case (see docs on
 * src/lib/useStores.ts) — a notification either belongs to the selected
 * store or it doesn't.
 */
function sortBySelectedStoreFirst(notifications: Notification[], selectedStoreId: string | null): Notification[] {
  return [...notifications].sort((a, b) => {
    const aFirst = a.storeId === selectedStoreId ? 0 : 1;
    const bFirst = b.storeId === selectedStoreId ? 0 : 1;
    return aFirst - bFirst;
  });
}

interface NotificationBellProps {
  // Controlled by the dashboard header so opening this dropdown can close
  // the profile dropdown (and vice versa) — see ProfileMenuProps.open for
  // the same contract on the other side.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationBell({ open, onOpenChange }: NotificationBellProps) {
  const router = useRouter();
  const { selectedStoreId, setSelectedStoreId } = useStoreScope();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const { push } = useToast();
  const loadedOnce = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem('nexora-sound') !== 'off');
    } catch {
      // ignore
    }
  }, []);

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

  useEffect(() => {
    apiFetch<Notification[]>('/api/notifications').then((res) => {
      if (res.data) setNotifications(res.data);
      loadedOnce.current = true;
    });

    const source = new EventSource('/api/notifications/stream');
    source.addEventListener('notification.created', (event) => {
      const notification = JSON.parse((event as MessageEvent).data) as Notification;
      setNotifications((prev) => [notification, ...prev]);
      push(notification.title, notification.severity === 'critical' ? 'error' : 'info');
      if (soundOn) playChime();
    });
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn]);

  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const ordered = sortBySelectedStoreFirst(notifications, selectedStoreId);

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  function toggleExpand(n: Notification) {
    setExpandedId((prev) => (prev === n.id ? null : n.id));
    if (!n.readAt) markRead(n.id);
  }

  // Switching stores from a notification reuses exactly the same
  // selection + navigation the sidebar's store list already does
  // (Sidebar.tsx's selectStore) — no separate switching logic. Access is
  // already guaranteed here: GET /api/notifications only ever returns
  // notifications for stores in the caller's own organization (never
  // trusts a client-supplied store id for that), so any store.id present
  // in this list is already known-accessible.
  function switchToStore(storeId: string, event: React.MouseEvent) {
    event.stopPropagation();
    setSelectedStoreId(storeId);
    onOpenChange(false);
    router.push(`/dashboard/stores/${storeId}`);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem('nexora-sound', next ? 'on' : 'off');
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => onOpenChange(!open)}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[rgb(var(--border))]"
      >
        <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] card p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold">Notifications</span>
            <button onClick={toggleSound} className="text-xs text-[rgb(var(--text-muted))]">
              Sound: {soundOn ? 'On' : 'Off'}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {ordered.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-[rgb(var(--text-muted))]">You&apos;re all caught up.</p>
            )}
            {ordered.map((n) => {
              const isOtherStore = n.storeId !== null && n.storeId !== selectedStoreId;
              const expanded = expandedId === n.id;
              return (
                <div key={n.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <button
                    onClick={() => toggleExpand(n)}
                    className={`block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
                      !n.readAt ? 'bg-brand-50 dark:bg-brand-900/20' : ''
                    }`}
                  >
                    {n.store && (
                      <p className="mb-0.5 truncate text-xs font-semibold text-[rgb(var(--text-muted))]">{n.store.name}</p>
                    )}
                    <div className="flex items-center gap-2 font-medium">
                      {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />}
                      <span className="truncate">{n.title}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[rgb(var(--text-muted))]">{n.body}</p>
                  </button>

                  {expanded && (
                    <div className="space-y-2 px-2 pb-3 text-xs">
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <dt className="text-[rgb(var(--text-muted))]">Store</dt>
                        <dd className="truncate text-right">{n.store?.name ?? 'Organization-wide'}</dd>
                        <dt className="text-[rgb(var(--text-muted))]">Type</dt>
                        <dd className="truncate text-right">{formatType(n.type)}</dd>
                        <dt className="text-[rgb(var(--text-muted))]">Time</dt>
                        <dd className="text-right">{new Date(n.createdAt).toLocaleString()}</dd>
                        <dt className="text-[rgb(var(--text-muted))]">Status</dt>
                        <dd className="text-right">{n.readAt ? 'Read' : 'Unread'}</dd>
                      </dl>
                      {n.type === 'monitoring.issue' && n.storeId && (
                        <Link
                          href={n.storeId === selectedStoreId ? '/dashboard/settings?tab=reports' : '#'}
                          onClick={(e) => {
                            if (n.storeId !== selectedStoreId) {
                              e.preventDefault();
                              setSelectedStoreId(n.storeId!);
                              router.push('/dashboard/settings?tab=reports');
                              onOpenChange(false);
                            } else {
                              onOpenChange(false);
                            }
                          }}
                          className="block text-brand-600 underline dark:text-brand-400"
                        >
                          View full diagnostic details in Reports
                        </Link>
                      )}
                      {isOtherStore && (
                        <button
                          onClick={(e) => switchToStore(n.storeId!, e)}
                          className="flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))] px-2.5 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <ArrowRightLeft className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                          Switch to {n.store?.name}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Link href="/dashboard/notifications" className="mt-1 block px-2 py-2 text-center text-xs text-brand-600 dark:text-brand-400">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
