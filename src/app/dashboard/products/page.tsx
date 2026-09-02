'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Package, Plug, Pencil, Trash2, CloudOff, ChevronDown, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';
import { ProductFormModal, type EditableProduct } from '@/components/dashboard/ProductFormModal';

type PushStatus = 'not_pushed' | 'pushing' | 'pushed' | 'failed' | 'unverifiable' | 'unsupported';
type PushMode = 'push_all' | 'push_selected' | 'push';

interface Product extends EditableProduct {
  currency: string;
  pushStatus: PushStatus;
  lastPushedAt: string | null;
  lastPushError: string | null;
}

interface PushCapability {
  supported: boolean;
  provider?: string;
  providerLabel?: string;
  reason?: string;
  pushDefaultMode: PushMode;
}

interface PushItemResult {
  productId: string;
  sku: string;
  status: 'pushed' | 'failed' | 'unverifiable' | 'unsupported';
  action?: 'created' | 'updated';
  error?: string;
}

interface PushBatchResult {
  status: 'processed' | 'partial' | 'failed' | 'unsupported';
  total: number;
  pushed: number;
  updated: number;
  failed: number;
  unverifiable: number;
  results: PushItemResult[];
}

// If there are more than this many products, "Push All" asks for
// confirmation first (section 19) — a single explicitly-selected product
// never does, matching the existing delete-confirmation convention.
const PUSH_ALL_CONFIRM_THRESHOLD = 10;

const PUSH_MODE_OPTIONS: { value: PushMode; label: string; description: string }[] = [
  { value: 'push_all', label: 'Push All', description: 'Push all eligible products to the connected website/app.' },
  { value: 'push_selected', label: 'Push Selected', description: 'Select product cards first, then push only the selected products.' },
  { value: 'push', label: 'Push', description: 'Open push options so you can choose Push All or Push Selected.' },
];

export default function ProductsPage() {
  const { selectedStoreId, stores } = useStoreScope();
  const { push } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<EditableProduct | null | undefined>(undefined);

  const [capability, setCapability] = useState<PushCapability | null>(null);
  const [pushMode, setPushMode] = useState<PushMode>('push');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pushingIds, setPushingIds] = useState<Set<string>>(new Set());
  const [batchPushing, setBatchPushing] = useState(false);
  const [lastResult, setLastResult] = useState<PushBatchResult | null>(null);
  const pushControlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (pushControlRef.current && !pushControlRef.current.contains(event.target as Node)) {
        setModeMenuOpen(false);
        setActionMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const store = stores.find((s) => s.id === selectedStoreId);
  const developerOwned = store?.productMode === 'developer_owned';
  // Same canonical derived status shown on the Stores page and Profile
  // dropdown (GET /api/stores' deriveStoreStatus) — a store with zero (or
  // only stale/failing) integrations is not "connected", regardless of
  // productMode. Creation requires both nexora_managed AND connected; see
  // assertStoreEligibleForProductCreation in src/lib/productService.ts for
  // the server-side twin of this check.
  const notConnected = Boolean(store) && !developerOwned && store!.status !== 'connected';
  const canCreate = Boolean(selectedStoreId) && !developerOwned && !notConnected;

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    apiFetch<Product[]>(`/api/products?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setProducts(res.data ?? []);
      setLoading(false);
    });
  }

  useEffect(load, [selectedStoreId]);

  // Outbound push capability is genuinely per-store (which integration is
  // connected, and whether that connector implements it — see
  // src/lib/productPushService.ts) — never assumed, never hardcoded.
  useEffect(() => {
    setCapability(null);
    setSelectionMode(false);
    setSelectedIds(new Set());
    setLastResult(null);
    if (!selectedStoreId || developerOwned) return;
    apiFetch<PushCapability>(`/api/products/push?storeId=${selectedStoreId}`).then((res) => {
      if (res.data) {
        setCapability(res.data);
        setPushMode(res.data.pushDefaultMode);
      }
    });
  }, [selectedStoreId, developerOwned]);

  async function deleteProduct(product: Product) {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/api/products/${product.id}`, { method: 'DELETE' });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Product deleted.', 'success');
    load();
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function executePush(mode: 'all' | 'selected', ids?: string[]) {
    if (!selectedStoreId) return;
    if (mode === 'all' && products.length > PUSH_ALL_CONFIRM_THRESHOLD) {
      if (!confirm(`Push ${products.length} products?\n\nThis will send the products to the connected website/app.`)) return;
    }
    if (mode === 'selected' && (!ids || ids.length === 0)) {
      push('Select at least one product.', 'error');
      return;
    }

    setBatchPushing(true);
    if (mode === 'selected' && ids) setPushingIds(new Set(ids));
    setLastResult(null);

    const res = await apiFetch<PushBatchResult>('/api/products/push', {
      method: 'POST',
      body: JSON.stringify({ storeId: selectedStoreId, mode, ...(mode === 'selected' ? { productIds: ids } : {}) }),
    });

    setBatchPushing(false);
    setPushingIds(new Set());

    if (res.error) {
      push(res.error.message, 'error');
      return;
    }

    const result = res.data!;
    setLastResult(result);
    const succeeded = result.pushed + result.updated;
    if (result.status === 'unsupported') {
      push('Outbound sync is not supported by this store\'s connected integration.', 'error');
    } else if (result.failed > 0 || result.unverifiable > 0) {
      push(`Push complete: ${succeeded} succeeded, ${result.failed} failed, ${result.unverifiable} could not be verified.`, 'error');
    } else {
      push(`${succeeded} product${succeeded === 1 ? '' : 's'} pushed successfully.`, 'success');
    }

    exitSelectionMode();
    load();
  }

  function handleMainButtonClick() {
    if (!capability?.supported || batchPushing) return;
    if (selectionMode) {
      if (selectedIds.size === 0) {
        push('Select at least one product.', 'error');
        return;
      }
      executePush('selected', Array.from(selectedIds));
      return;
    }
    if (pushMode === 'push_all') {
      executePush('all');
      return;
    }
    if (pushMode === 'push_selected') {
      setSelectionMode(true);
      return;
    }
    setActionMenuOpen((v) => !v);
  }

  async function setDefaultMode(mode: PushMode) {
    setModeMenuOpen(false);
    setPushMode(mode);
    setCapability((prev) => (prev ? { ...prev, pushDefaultMode: mode } : prev));
    if (!selectedStoreId) return;
    const res = await apiFetch(`/api/stores/${selectedStoreId}`, { method: 'PATCH', body: JSON.stringify({ pushDefaultMode: mode }) });
    if (res.error) push(res.error.message, 'error');
  }

  function mainButtonLabel(): string {
    if (batchPushing) return 'Pushing…';
    if (selectionMode) return `Push Selected (${selectedIds.size})`;
    if (pushMode === 'push_all') return 'Push All';
    if (pushMode === 'push_selected') return 'Push Selected';
    return 'Push';
  }

  function pushSingle(productId: string) {
    executePush('selected', [productId]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm text-[rgb(var(--text-muted))]">
            {developerOwned ? 'Synced from your connected integration.' : 'Products managed in this dashboard.'}
          </p>
        </div>
        {!developerOwned && (
          <button
            onClick={() => setModalProduct(null)}
            disabled={!canCreate}
            title={!selectedStoreId ? 'Create or select a store first.' : notConnected ? 'This store has no connected integration yet.' : undefined}
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            + New product
          </button>
        )}
      </div>

      {!developerOwned && !selectedStoreId && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/50 bg-amber-50 p-4 text-sm dark:bg-amber-900/20">
          <Package className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.75} aria-hidden="true" />
          <p>
            You don&apos;t have a store yet.{' '}
            <Link href="/dashboard/stores" className="font-medium underline">
              Create one
            </Link>{' '}
            before adding products — every product must belong to a specific store.
          </p>
        </div>
      )}

      {!developerOwned && notConnected && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/50 bg-amber-50 p-4 text-sm dark:bg-amber-900/20">
          <Package className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.75} aria-hidden="true" />
          <p>
            <span className="font-medium">{store!.name}</span> has no connected integration yet.{' '}
            <Link href="/dashboard/integrations" className="font-medium underline">
              Connect one
            </Link>{' '}
            before creating products for this store.
          </p>
        </div>
      )}

      {developerOwned && (
        <div className="flex items-start gap-3 rounded-lg border border-[rgb(var(--border))] bg-black/[0.02] p-4 text-sm dark:bg-white/[0.03]">
          <Plug className="mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--text-muted))]" strokeWidth={1.75} aria-hidden="true" />
          <div>
            <p className="font-medium">This store owns its own product system.</p>
            <p className="mt-1 text-[rgb(var(--text-muted))]">
              Products here are pushed in automatically from your connected integration (API key or webhook) — see the{' '}
              <a href="/dashboard/integrations" className="text-brand-600 underline dark:text-brand-400">
                Integrations
              </a>{' '}
              page for credentials. Switch back to Nexora-managed products anytime from Settings.
            </p>
          </div>
        </div>
      )}

      {!developerOwned && selectedStoreId && !notConnected && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          {capability === null ? (
            <p className="text-sm text-[rgb(var(--text-muted))]">Checking outbound push capability…</p>
          ) : !capability.supported ? (
            <div className="flex items-start gap-3 text-sm">
              <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--text-muted))]" strokeWidth={1.75} aria-hidden="true" />
              <p className="text-[rgb(var(--text-muted))]">
                <span className="font-medium text-[rgb(var(--text))]">Outbound sync not supported yet.</span>{' '}
                {capability.reason ?? 'This connected integration does not currently support outbound product sync.'}
              </p>
            </div>
          ) : (
            <>
              <div className="relative flex" ref={pushControlRef}>
                <button
                  onClick={handleMainButtonClick}
                  disabled={batchPushing || (selectionMode && selectedIds.size === 0)}
                  className="rounded-l-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mainButtonLabel()}
                </button>
                <button
                  type="button"
                  aria-label="Set default push behavior"
                  aria-expanded={modeMenuOpen}
                  onClick={() => setModeMenuOpen((v) => !v)}
                  className="rounded-r-lg border-l border-brand-700 bg-brand-600 px-2 text-white"
                >
                  <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>

                {modeMenuOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-72 card p-1 shadow-xl">
                    {PUSH_MODE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setDefaultMode(opt.value)}
                        className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
                          pushMode === opt.value ? 'text-brand-600 dark:text-brand-400' : ''
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                        <span className="block text-xs font-normal text-[rgb(var(--text-muted))]">{opt.description}</span>
                      </button>
                    ))}
                  </div>
                )}

                {actionMenuOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-52 card p-1 shadow-xl">
                    <button
                      onClick={() => {
                        setActionMenuOpen(false);
                        executePush('all');
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      Push All
                    </button>
                    <button
                      onClick={() => {
                        setActionMenuOpen(false);
                        setSelectionMode(true);
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      Push Selected
                    </button>
                  </div>
                )}
              </div>

              {selectionMode && (
                <>
                  <span className="text-sm text-[rgb(var(--text-muted))]">Selected: {selectedIds.size}</span>
                  <button onClick={exitSelectionMode} className="text-sm text-[rgb(var(--text-muted))] underline">
                    Cancel
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {lastResult && (
        <div className="card space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">
              Push complete — {lastResult.pushed} pushed, {lastResult.updated} updated, {lastResult.failed} failed,{' '}
              {lastResult.unverifiable} could not be verified
            </p>
            <button onClick={() => setLastResult(null)} className="text-xs text-[rgb(var(--text-muted))] underline">
              Dismiss
            </button>
          </div>
          {lastResult.results.some((r) => r.status !== 'pushed') && (
            <ul className="space-y-1 text-xs text-[rgb(var(--text-muted))]">
              {lastResult.results
                .filter((r) => r.status !== 'pushed')
                .map((r) => (
                  <li key={r.productId}>
                    <span className="font-mono">{r.sku}</span>: {r.status === 'unsupported' ? 'not supported' : r.status} — {r.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          body={
            developerOwned
              ? 'Push a product from your connected integration to see it here.'
              : 'Create a product, or push one via the API/webhooks.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const cover = p.images?.[0];
            const lowStock = p.inventory && p.inventory.quantity <= p.inventory.lowStockThreshold;
            const canSelect = !developerOwned && selectionMode && capability?.supported;
            return (
              <div key={p.id} className="card relative overflow-hidden">
                {canSelect && (
                  <label className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow dark:bg-black/70">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      aria-label={`Select ${p.name} for push`}
                      className="h-4 w-4"
                    />
                  </label>
                )}
                <div className="flex h-36 items-center justify-center bg-black/5 dark:bg-white/5">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-10 w-10 text-[rgb(var(--text-muted))]" strokeWidth={1.5} aria-hidden="true" />
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate font-semibold">{p.name}</h3>
                    <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase dark:bg-white/10">{p.status}</span>
                  </div>
                  <p className="font-mono text-xs text-[rgb(var(--text-muted))]">{p.sku}</p>
                  <p className="text-sm font-medium">
                    {p.currency} {p.price.toLocaleString()}
                  </p>
                  {p.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.categories.slice(0, 3).map((c) => (
                        <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-[rgb(var(--text-muted))]">
                    {p.variants.length > 0 ? (
                      `${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}`
                    ) : p.inventory ? (
                      <span className={lowStock ? 'font-semibold text-amber-500' : ''}>
                        {p.inventory.quantity} in stock{lowStock ? ' · low stock' : ''}
                      </span>
                    ) : (
                      'No stock tracked'
                    )}
                  </p>

                  {!developerOwned && (
                    <div className="space-y-2 border-t border-[rgb(var(--border))] pt-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setModalProduct(p)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[rgb(var(--border))] py-1.5 text-xs font-medium"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          onClick={() => deleteProduct(p)}
                          aria-label={`Delete ${p.name}`}
                          className="flex items-center justify-center rounded-lg border border-red-400/50 px-2 text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </div>
                      <PushStatusControl
                        product={p}
                        capability={capability}
                        pushing={pushingIds.has(p.id)}
                        onPush={() => pushSingle(p.id)}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalProduct !== undefined && selectedStoreId && (
        <ProductFormModal
          storeId={selectedStoreId}
          product={modalProduct}
          onClose={() => setModalProduct(undefined)}
          onSaved={() => {
            setModalProduct(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}

// Per-card outbound status/action — kept as its own component since it has
// five real states (section 11) and needs to stay honest in each: it must
// never say "Pushed" unless pushStatus really is 'pushed' (set only after
// productPushService.ts records a confirmed destination response), and it
// must stay a plainly-disabled "not supported yet" area — never a fake
// enabled button — when this store's connected integration doesn't
// implement pushProduct at all (see the Connector interface's doc comment
// in src/lib/connectors/types.ts for why that's the case for every
// provider today).
function PushStatusControl({
  product,
  capability,
  pushing,
  onPush,
}: {
  product: Product;
  capability: PushCapability | null;
  pushing: boolean;
  onPush: () => void;
}) {
  if (!capability?.supported) {
    return (
      <button
        type="button"
        disabled
        title="Outbound sync isn't supported by any connected integration yet — products created here stay in Nexora only."
        className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-[rgb(var(--border))] py-1.5 text-xs font-medium text-[rgb(var(--text-muted))] opacity-70"
      >
        <CloudOff className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        Outbound sync not supported yet
      </button>
    );
  }

  if (pushing || product.pushStatus === 'pushing') {
    return (
      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[rgb(var(--border))] py-1.5 text-xs font-medium text-[rgb(var(--text-muted))]"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
        Pushing…
      </button>
    );
  }

  if (product.pushStatus === 'pushed') {
    return (
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Pushed{product.lastPushedAt ? ` · ${new Date(product.lastPushedAt).toLocaleDateString()}` : ''}
        </span>
        <button onClick={onPush} className="shrink-0 text-[rgb(var(--text-muted))] underline">
          Push again
        </button>
      </div>
    );
  }

  if (product.pushStatus === 'failed' || product.pushStatus === 'unverifiable') {
    const isUnverifiable = product.pushStatus === 'unverifiable';
    return (
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={`flex min-w-0 items-center gap-1.5 font-medium ${isUnverifiable ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}
          title={product.lastPushError ?? undefined}
        >
          {isUnverifiable ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className="truncate">{isUnverifiable ? 'Could not be verified' : 'Push failed'}</span>
        </span>
        <button onClick={onPush} className="shrink-0 font-medium text-brand-600 underline dark:text-brand-400">
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPush}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[rgb(var(--border))] py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
    >
      Push to website
    </button>
  );
}
