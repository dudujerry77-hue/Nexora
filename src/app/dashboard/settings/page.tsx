'use client';

import { useEffect, useState } from 'react';
import { Lock, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useSession } from '@/lib/useSession';
import { EmptyState, LoadingSkeleton } from '@/components/dashboard/ui';

interface AuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

export default function SettingsPage() {
  const { session } = useSession();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session?.memberRole !== 'OWNER') return;
    apiFetch<AuditLog[]>('/api/audit-logs').then((res) => {
      if (res.data) setLogs(res.data);
      else setNotice(res.error?.message ?? null);
    });
  }, [session]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Your account and organization.</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Account</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Name</dt>
            <dd>{session?.user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Email</dt>
            <dd>{session?.user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Organization</dt>
            <dd>{session?.organization?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--text-muted))]">Role</dt>
            <dd className="capitalize">{session?.memberRole?.toLowerCase()}</dd>
          </div>
        </dl>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-semibold">Staff & permissions</h2>
        <p className="text-sm text-[rgb(var(--text-muted))]">
          Inviting staff and assigning per-store permissions is planned for a future release — the data model
          (<code className="rounded bg-black/5 px-1 dark:bg-white/10">Member</code> /
          <code className="rounded bg-black/5 px-1 dark:bg-white/10"> StoreAssignment</code>) already supports it, but
          there is no invite flow in this MVP yet.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Audit log</h2>
        {session?.memberRole !== 'OWNER' ? (
          <EmptyState icon={Lock} title="Owners only" body="Ask an owner on your team to view the audit log." />
        ) : logs === null && !notice ? (
          <LoadingSkeleton rows={3} />
        ) : notice ? (
          <p className="text-sm text-[rgb(var(--text-muted))]">{notice}</p>
        ) : logs && logs.length === 0 ? (
          <EmptyState icon={FileText} title="No audit events yet" />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {logs?.map((log) => (
              <div key={log.id} className="flex items-center justify-between border-b border-[rgb(var(--border))] py-2 last:border-0">
                <span>
                  <span className="font-medium">{log.actor?.name ?? 'System'}</span> {log.action.replace(/\./g, ' ')}
                  {log.targetType ? ` (${log.targetType})` : ''}
                </span>
                <span className="text-xs text-[rgb(var(--text-muted))]">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
