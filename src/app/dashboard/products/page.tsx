'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, Plug, Pencil, Trash2, CloudOff } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';
import { ProductFormModal, type EditableProduct } from '@/components/dashboard/ProductFormModal';

interface Product extends EditableProduct {
  currency: string;
}

// No connector in this codebase (custom_api, custom_webhook, js_sdk — see
// src/lib/connectors) exposes an outbound "push this product to the
// developer's own website" capability; the whole integration architecture
// is inbound-only (developer's system -> Nexora), and there is nowhere to
// even store a destination URL to push to. Rather than fake a push button
// that can never actually succeed, the "Push to website" action is shown
// disabled with an honest explanation until a real outbound capability
// exists. Flip this — and wire up a real endpoint — if that ever changes.
const OUTBOUND_PRODUCT_PUSH_SUPPORTED = false;

export default function ProductsPage() {
  const { selectedStoreId, stores } = useStoreScope();
  const { push } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<EditableProduct | null | undefined>(undefined);

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
            return (
              <div key={p.id} className="card overflow-hidden">
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
                      <button
                        type="button"
                        disabled={!OUTBOUND_PRODUCT_PUSH_SUPPORTED}
                        title="Outbound sync isn't supported by any connected integration yet — products created here stay in Nexora only."
                        className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-[rgb(var(--border))] py-1.5 text-xs font-medium text-[rgb(var(--text-muted))] opacity-70"
                      >
                        <CloudOff className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                        Outbound sync not supported yet
                      </button>
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
