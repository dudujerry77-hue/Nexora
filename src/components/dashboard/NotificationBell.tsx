'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';

interface Notification {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  readAt: string | null;
  createdAt: string;
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

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const { push } = useToast();
  const loadedOnce = useRef(false);

  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem('nexora-sound') !== 'off');
    } catch {
      // ignore
    }
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

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
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
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[rgb(var(--border))]"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 card p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold">Notifications</span>
            <button onClick={toggleSound} className="text-xs text-[rgb(var(--text-muted))]">
              Sound: {soundOn ? 'On' : 'Off'}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-[rgb(var(--text-muted))]">You&apos;re all caught up.</p>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
                  !n.readAt ? 'bg-brand-50 dark:bg-brand-900/20' : ''
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
                  {n.title}
                </div>
                <p className="mt-0.5 text-xs text-[rgb(var(--text-muted))]">{n.body}</p>
              </button>
            ))}
          </div>
          <Link href="/dashboard/notifications" className="mt-1 block px-2 py-2 text-center text-xs text-brand-600 dark:text-brand-400">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
