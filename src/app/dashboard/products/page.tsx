'use client';

import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
  currency: string;
  inventory: { quantity: number; lowStockThreshold: number } | null;
}

export default function ProductsPage() {
  const { selectedStoreId, stores } = useStoreScope();
  const { push } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', price: '', quantity: '' });

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

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    const targetStoreId = selectedStoreId ?? stores[0]?.id;
    if (!targetStoreId) {
      push('Create a store first.', 'error');
      return;
    }
    const res = await apiFetch('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        storeId: targetStoreId,
        sku: form.sku,
        name: form.name,
        price: Number(form.price),
        quantity: Number(form.quantity || 0),
      }),
    });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Product created.', 'success');
    setForm({ sku: '', name: '', price: '', quantity: '' });
    setShowForm(false);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm text-[rgb(var(--text-muted))]">Products synced from your connected stores.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          + New product
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProduct} className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium">SKU</label>
            <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Price</label>
            <input required type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-28 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Stock</label>
            <input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-24 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Create
          </button>
        </form>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" body="Products created here or pushed via the API/webhooks show up in this list." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border))] text-left text-xs uppercase text-[rgb(var(--text-muted))]">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Stock</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3">
                    {p.currency} {p.price.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {p.inventory ? (
                      <span className={p.inventory.quantity <= p.inventory.lowStockThreshold ? 'font-semibold text-amber-500' : ''}>
                        {p.inventory.quantity}
                        {p.inventory.quantity <= p.inventory.lowStockThreshold ? ' · low stock' : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
