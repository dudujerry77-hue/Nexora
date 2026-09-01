'use client';

import { useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';
import { useStoreScope } from '@/lib/useStores';
import { EmptyState, LoadingSkeleton } from '@/components/dashboard/ui';
import { APP_VERSION } from '@/lib/appVersion';
import {
  REPORT_TYPES,
  REPORT_TYPE_LABELS,
  REPORT_SEVERITIES,
  categoriesForType,
  type ReportType,
} from '@/lib/reportCategories';

interface ReportRow {
  id: string;
  type: ReportType;
  category: string;
  title: string;
  description: string;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  severity: string | null;
  status: string;
  screenshotUrl: string | null;
  diagnostics: {
    route?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    userAgent?: string;
    appVersion?: string;
    errorMessage?: string;
  };
  store: { id: string; name: string } | null;
  author: { name: string; email: string } | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_review: 'In review',
  resolved: 'Resolved',
  closed: 'Closed',
};

function emptyFormState() {
  return {
    category: '',
    title: '',
    description: '',
    stepsToReproduce: '',
    expectedBehavior: '',
    actualBehavior: '',
    severity: 'medium',
    errorMessage: '',
    screenshotUrl: '',
    storeId: '',
  };
}

export function ReportsPanel() {
  const { push } = useToast();
  const { stores, selectedStoreId } = useStoreScope();
  const [activeType, setActiveType] = useState<ReportType>('bug');
  const [form, setForm] = useState(emptyFormState);
  const [submitting, setSubmitting] = useState(false);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const categories = categoriesForType(activeType);
  const selectedReport = reports?.find((r) => r.id === selectedReportId) ?? null;

  useEffect(() => {
    setForm((prev) => ({ ...emptyFormState(), category: categories[0]?.value ?? '', storeId: prev.storeId }));
  }, [activeType]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadReports(type: ReportType) {
    setReports(null);
    apiFetch<ReportRow[]>(`/api/reports?type=${type}`).then((res) => {
      setReports(res.data ?? []);
    });
  }

  useEffect(() => {
    loadReports(activeType);
  }, [activeType]);

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const diagnostics = {
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      appVersion: APP_VERSION,
      errorMessage: activeType === 'crash' && form.errorMessage.trim() ? form.errorMessage.trim() : undefined,
    };

    const body: Record<string, unknown> = {
      type: activeType,
      category: form.category,
      title: form.title.trim(),
      description: form.description.trim(),
      severity: activeType !== 'user' ? form.severity : undefined,
      screenshotUrl: form.screenshotUrl.trim() || undefined,
      diagnostics,
    };

    if (activeType === 'bug') {
      body.stepsToReproduce = form.stepsToReproduce.trim() || undefined;
      body.expectedBehavior = form.expectedBehavior.trim() || undefined;
      body.actualBehavior = form.actualBehavior.trim() || undefined;
      body.storeId = selectedStoreId ?? undefined;
    } else if (activeType === 'crash') {
      body.storeId = selectedStoreId ?? undefined;
    } else {
      body.storeId = form.storeId || undefined;
    }

    const res = await apiFetch<ReportRow>('/api/reports', { method: 'POST', body: JSON.stringify(body) });
    setSubmitting(false);
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Report submitted.', 'success');
    setForm((prev) => ({ ...emptyFormState(), category: categories[0]?.value ?? '', storeId: prev.storeId }));
    loadReports(activeType);
    if (res.data) setSelectedReportId(res.data.id);
  }

  return (
    <div id="reports" className="space-y-5 scroll-mt-20">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report type">
        {REPORT_TYPES.map((type) => (
          <button
            key={type}
            role="tab"
            aria-selected={activeType === type}
            onClick={() => {
              setActiveType(type);
              setSelectedReportId(null);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              activeType === type
                ? 'bg-brand-600 text-white'
                : 'border border-[rgb(var(--border))] text-[rgb(var(--text-muted))] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {REPORT_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <form onSubmit={submitReport} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Category</label>
          <select
            required
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {activeType !== 'user' && (
          <div>
            <label className="mb-1 block text-xs font-medium">Severity</label>
            <select
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
              className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            >
              {REPORT_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeType === 'user' && (
          <div>
            <label className="mb-1 block text-xs font-medium">Related store (optional)</label>
            <select
              value={form.storeId}
              onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}
              className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            >
              <option value="">Not related to a specific store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium">{activeType === 'user' ? 'Subject' : 'Title'}</label>
          <input
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium">Description</label>
          <textarea
            required
            rows={3}
            maxLength={5000}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        {activeType === 'bug' && (
          <>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Steps to reproduce</label>
              <textarea
                rows={2}
                maxLength={5000}
                value={form.stepsToReproduce}
                onChange={(e) => setForm((f) => ({ ...f, stepsToReproduce: e.target.value }))}
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Expected behavior</label>
              <textarea
                rows={2}
                maxLength={2000}
                value={form.expectedBehavior}
                onChange={(e) => setForm((f) => ({ ...f, expectedBehavior: e.target.value }))}
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Actual behavior</label>
              <textarea
                rows={2}
                maxLength={2000}
                value={form.actualBehavior}
                onChange={(e) => setForm((f) => ({ ...f, actualBehavior: e.target.value }))}
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </>
        )}

        {activeType === 'crash' && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium">Error message / stack trace (if any)</label>
            <textarea
              rows={2}
              maxLength={4000}
              value={form.errorMessage}
              onChange={(e) => setForm((f) => ({ ...f, errorMessage: e.target.value }))}
              placeholder="Paste any error text you saw — never paste passwords, API keys, or tokens."
              className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium">Screenshot URL (optional)</label>
          <input
            type="url"
            maxLength={2000}
            value={form.screenshotUrl}
            onChange={(e) => setForm((f) => ({ ...f, screenshotUrl: e.target.value }))}
            placeholder="https://…"
            className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <p className="text-xs text-[rgb(var(--text-muted))] sm:col-span-2">
          Automatically included: current page, selected store, viewport size, and browser info. Never include
          passwords, API keys, webhook secrets, or session tokens.
        </p>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting || !form.category || !form.title.trim() || !form.description.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </form>

      <div className="border-t border-[rgb(var(--border))] pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--text-muted))]">
          Recent {REPORT_TYPE_LABELS[activeType].toLowerCase()} reports
        </p>
        {reports === null ? (
          <LoadingSkeleton rows={2} />
        ) : reports.length === 0 ? (
          <p className="text-sm text-[rgb(var(--text-muted))]">No reports submitted yet.</p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedReportId(r.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  selectedReportId === r.id ? 'bg-brand-600 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <span className="min-w-0 truncate">{r.title}</span>
                <span className={`shrink-0 text-xs ${selectedReportId === r.id ? 'text-white/80' : 'text-[rgb(var(--text-muted))]'}`}>
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[rgb(var(--border))] pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--text-muted))]">
          Selected report details
        </p>
        {!selectedReport ? (
          <EmptyState icon={FileWarning} title="No report selected" body="Select a report to view its details." />
        ) : (
          <div className="card space-y-3 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{selectedReport.title}</p>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
                {STATUS_LABELS[selectedReport.status] ?? selectedReport.status}
              </span>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Type</dt>
                <dd>{REPORT_TYPE_LABELS[selectedReport.type]}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Severity</dt>
                <dd className="capitalize">{selectedReport.severity ?? 'n/a'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Store</dt>
                <dd>{selectedReport.store?.name ?? 'Not store-specific'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Route</dt>
                <dd className="truncate">{selectedReport.diagnostics.route ?? 'n/a'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Date</dt>
                <dd>{new Date(selectedReport.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Viewport</dt>
                <dd>
                  {selectedReport.diagnostics.viewportWidth && selectedReport.diagnostics.viewportHeight
                    ? `${selectedReport.diagnostics.viewportWidth} × ${selectedReport.diagnostics.viewportHeight}`
                    : 'n/a'}
                </dd>
              </div>
            </dl>
            <div>
              <dt className="text-xs text-[rgb(var(--text-muted))]">Description</dt>
              <dd className="whitespace-pre-wrap">{selectedReport.description}</dd>
            </div>
            {selectedReport.stepsToReproduce && (
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Steps to reproduce</dt>
                <dd className="whitespace-pre-wrap">{selectedReport.stepsToReproduce}</dd>
              </div>
            )}
            {selectedReport.diagnostics.errorMessage && (
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Error message</dt>
                <dd className="whitespace-pre-wrap break-all font-mono text-xs">{selectedReport.diagnostics.errorMessage}</dd>
              </div>
            )}
            {selectedReport.diagnostics.userAgent && (
              <div>
                <dt className="text-xs text-[rgb(var(--text-muted))]">Browser</dt>
                <dd className="truncate text-xs">{selectedReport.diagnostics.userAgent}</dd>
              </div>
            )}
            {selectedReport.screenshotUrl && (
              <div>
                <dt className="mb-1 text-xs text-[rgb(var(--text-muted))]">Screenshot</dt>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedReport.screenshotUrl} alt="Report screenshot" className="max-h-64 rounded-lg border border-[rgb(var(--border))]" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
