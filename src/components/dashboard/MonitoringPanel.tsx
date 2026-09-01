'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Info, ShieldAlert, FileWarning } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';
import { useStoreScope } from '@/lib/useStores';
import { EmptyState, LoadingSkeleton } from '@/components/dashboard/ui';

type IssueStatus = 'unresolved' | 'resolved' | 'ignored';

interface Issue {
  id: string;
  type: string;
  message: string;
  stack: string | null;
  route: string | null;
  severity: string;
  status: IssueStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastBrowser: string | null;
  lastStatusCode: number | null;
}

interface IssueDetail extends Issue {
  events: { id: string; occurredAt: string; message: string; route: string | null; statusCode: number | null; browser: string | null }[];
}

const TYPE_LABELS: Record<string, string> = {
  js_error: 'JS error',
  unhandled_rejection: 'Unhandled rejection',
  console_error: 'Console error',
  network_error: 'Network error',
  crash: 'Crash',
};

const SEVERITY_META: Record<string, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-blue-500' },
  warning: { icon: AlertTriangle, className: 'text-amber-500' },
  error: { icon: ShieldAlert, className: 'text-red-500' },
  critical: { icon: ShieldAlert, className: 'text-red-600' },
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

export function MonitoringPanel() {
  const { push } = useToast();
  const { selectedStoreId } = useStoreScope();
  const [statusFilter, setStatusFilter] = useState<'unresolved' | 'all'>('unresolved');
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const storeIdRef = useRef(selectedStoreId);
  storeIdRef.current = selectedStoreId;

  function loadIssues() {
    if (!selectedStoreId) {
      setIssues([]);
      return;
    }
    apiFetch<Issue[]>(`/api/monitoring/issues?storeId=${selectedStoreId}&status=${statusFilter}`).then((res) => {
      setIssues(res.data ?? []);
    });
  }

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId, statusFilter]);

  // Live updates: a connected website/app can report a new error at any
  // time, so this panel refreshes automatically instead of requiring a
  // manual reload — reusing the same SSE stream the notification bell uses.
  useEffect(() => {
    const source = new EventSource('/api/notifications/stream');
    const onIssueEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { id: string; storeId: string };
        if (payload.storeId !== storeIdRef.current) return;
        loadIssues();
        if (selectedId === payload.id) loadDetail(payload.id);
      } catch {
        // ignore malformed event payloads
      }
    };
    source.addEventListener('monitoring.issue_created', onIssueEvent);
    source.addEventListener('monitoring.issue_updated', onIssueEvent);
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function loadDetail(id: string) {
    setDetailLoading(true);
    apiFetch<IssueDetail>(`/api/monitoring/issues/${id}`).then((res) => {
      if (res.data) setDetail(res.data);
      setDetailLoading(false);
    });
  }

  function selectIssue(id: string) {
    setSelectedId(id);
    loadDetail(id);
  }

  async function updateStatus(id: string, status: IssueStatus) {
    const res = await apiFetch(`/api/monitoring/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push(status === 'resolved' ? 'Marked resolved.' : status === 'ignored' ? 'Issue ignored.' : 'Reopened.', 'success');
    loadIssues();
    loadDetail(id);
  }

  if (!selectedStoreId) {
    return <EmptyState icon={FileWarning} title="No store selected" body="Pick a connected store to see its monitoring feed." />;
  }

  return (
    <div id="reports" className="space-y-4 scroll-mt-20">
      <div className="rounded-lg border border-[rgb(var(--border))] bg-black/[0.02] p-3 text-xs text-[rgb(var(--text-muted))] dark:bg-white/[0.03]">
        Errors, crashes, and failed requests reported automatically by your connected website/app appear here — grouped,
        deduplicated, and updated live. Enable it with the JS SDK (<code className="rounded bg-black/5 px-1 dark:bg-white/10">Nexora.init(...)</code>,
        automatic by default) or by posting to <code className="rounded bg-black/5 px-1 dark:bg-white/10">POST /api/monitoring/events</code> from
        your backend. No passwords, tokens, or API keys are ever accepted here.
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Issue filter">
        {(['unresolved', 'all'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={statusFilter === f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-lg px-3 py-2 text-sm font-medium capitalize ${
              statusFilter === f
                ? 'bg-brand-600 text-white'
                : 'border border-[rgb(var(--border))] text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {issues === null ? (
        <LoadingSkeleton rows={3} />
      ) : issues.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={statusFilter === 'unresolved' ? 'No unresolved issues' : 'No issues yet'}
          body="Nothing reported for this store yet — that's a good sign."
        />
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {issues.map((issue) => {
            const meta = SEVERITY_META[issue.severity] ?? SEVERITY_META.error;
            const Icon = meta.icon;
            return (
              <button
                key={issue.id}
                onClick={() => selectIssue(issue.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  selectedId === issue.id ? 'bg-brand-600 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selectedId === issue.id ? 'text-white' : meta.className}`} strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{issue.message}</span>
                  <span className={`text-xs ${selectedId === issue.id ? 'text-white/80' : 'text-[rgb(var(--text-muted))]'}`}>
                    {TYPE_LABELS[issue.type] ?? issue.type} &middot; {issue.occurrenceCount}x &middot; last seen {formatRelativeTime(issue.lastSeenAt)}
                  </span>
                </span>
                {issue.status !== 'unresolved' && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${selectedId === issue.id ? 'bg-white/20' : 'bg-black/10 dark:bg-white/10'}`}>
                    {issue.status}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="border-t border-[rgb(var(--border))] pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--text-muted))]">Selected issue details</p>
        {detailLoading ? (
          <LoadingSkeleton rows={2} />
        ) : !detail ? (
          <EmptyState icon={FileWarning} title="No issue selected" body="Select an issue above to view its details." />
        ) : (
          <div className="card space-y-3 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 break-words font-semibold">{detail.message}</p>
              <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium capitalize dark:bg-white/10">{detail.status}</span>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Type</dt>
                <dd>{TYPE_LABELS[detail.type] ?? detail.type}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Severity</dt>
                <dd className="capitalize">{detail.severity}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Route</dt>
                <dd className="truncate">{detail.route ?? 'n/a'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Status code</dt>
                <dd>{detail.lastStatusCode ?? 'n/a'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Occurrences</dt>
                <dd>{detail.occurrenceCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Browser/device</dt>
                <dd className="truncate text-xs">{detail.lastBrowser ?? 'n/a'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">First seen</dt>
                <dd>{new Date(detail.firstSeenAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Last seen</dt>
                <dd>{new Date(detail.lastSeenAt).toLocaleString()}</dd>
              </div>
            </dl>
            {detail.stack && (
              <div>
                <dt className="mb-1 text-xs text-[rgb(var(--text-muted))]">Stack trace</dt>
                <pre className="max-h-48 overflow-auto rounded-lg bg-black/5 p-3 text-xs dark:bg-white/10">{detail.stack}</pre>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-[rgb(var(--border))] pt-3">
              {detail.status !== 'resolved' && (
                <button
                  onClick={() => updateStatus(detail.id, 'resolved')}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Mark resolved
                </button>
              )}
              {detail.status !== 'ignored' && (
                <button
                  onClick={() => updateStatus(detail.id, 'ignored')}
                  className="flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))] px-3 py-1.5 text-xs font-medium"
                >
                  <CircleSlash className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Ignore
                </button>
              )}
              {detail.status !== 'unresolved' && (
                <button
                  onClick={() => updateStatus(detail.id, 'unresolved')}
                  className="rounded-lg border border-[rgb(var(--border))] px-3 py-1.5 text-xs font-medium"
                >
                  Reopen
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
