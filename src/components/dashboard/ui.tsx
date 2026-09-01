'use client';

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--text-muted))]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-[rgb(var(--text-muted))]">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon = '📭', title, body, action }: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 p-12 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="font-medium">{title}</p>
      {body && <p className="max-w-sm text-sm text-[rgb(var(--text-muted))]">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-12 text-center">
      <span className="text-3xl">⚠️</span>
      <p className="font-medium text-red-500">{message}</p>
    </div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full" />
      ))}
    </div>
  );
}

const CONNECTION_LABEL: Record<string, { icon: string; label: string; className: string }> = {
  connected: { icon: '🟢', label: 'Connected', className: 'text-emerald-600 dark:text-emerald-400' },
  warning: { icon: '🟡', label: 'Warning', className: 'text-amber-600 dark:text-amber-400' },
  disconnected: { icon: '🔴', label: 'Disconnected', className: 'text-red-500' },
};

export function ConnectionBadge({ status }: { status: string }) {
  const meta = CONNECTION_LABEL[status] ?? CONNECTION_LABEL.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${meta.className}`}>
      <span>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  preparing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  shipped: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${ORDER_STATUS_STYLES[status] ?? ''}`}>
      {status}
    </span>
  );
}
