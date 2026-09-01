'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface InventoryRow {
  id: string;
  productId: string;
  quantity: number;
  lowStockThreshold: number;
  product: { name: string; sku: string };
}

export default function InventoryPage() {
  const { selectedStoreId } = useStoreScope();
  const { push } = useToast();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    if (lowStockOnly) params.set('lowStockOnly', 'true');
    apiFetch<InventoryRow[]>(`/api/inventory?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setRows(res.data ?? []);
      setLoading(false);
    });
  }

  useEffect(load, [selectedStoreId, lowStockOnly]);

  async function updateQuantity(productId: string, quantity: number) {
    const res = await apiFetch(`/api/inventory/${productId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Inventory</h1>
          <p className="text-sm text-[rgb(var(--text-muted))]">Stock levels across your products.</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nothing to show" body="Inventory tracks automatically as products are created and orders come in." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border))] text-left text-xs uppercase text-[rgb(var(--text-muted))]">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Low stock threshold</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <td className="px-4 py-3">{r.product.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.product.sku}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      defaultValue={r.quantity}
                      onBlur={(e) => updateQuantity(r.productId, Number(e.target.value))}
                      className={`w-24 rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1 ${
                        r.quantity <= r.lowStockThreshold ? 'text-amber-500 font-semibold' : ''
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3">{r.lowStockThreshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
