'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

const STATUSES = ['all', 'pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] as const;

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  externalId: string;
  customerName: string;
  status: string;
  paymentStatus: string;
  total: number;
  currency: string;
  createdAt: string;
  deliveryAddress: string | null;
  items: OrderItem[];
  store: { id: string; name: string };
}

export default function OrdersPage() {
  const { selectedStoreId } = useStoreScope();
  const { push } = useToast();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    if (status !== 'all') params.set('status', status);
    apiFetch<{ orders: Order[] }>(`/api/orders?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setOrders(res.data?.orders ?? []);
      setLoading(false);
    });
  }

  useEffect(load, [selectedStoreId, status]);

  async function updateStatus(orderId: string, newStatus: string) {
    const res = await apiFetch(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Order updated.', 'success');
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Orders</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Every order across your connected stores.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium capitalize ${
              status === s ? 'bg-brand-600 text-white' : 'border border-[rgb(var(--border))]'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : orders.length === 0 ? (
        <EmptyState icon="🧾" title="No orders" body="Orders sent via the API, webhooks, or SDK will appear here." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border))] text-left text-xs uppercase text-[rgb(var(--text-muted))]">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <td className="px-4 py-3 font-medium">#{o.externalId}</td>
                  <td className="px-4 py-3">{o.store.name}</td>
                  <td className="px-4 py-3">{o.customerName}</td>
                  <td className="px-4 py-3 text-xs text-[rgb(var(--text-muted))]">
                    {o.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {o.currency} {o.total.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 capitalize">{o.paymentStatus}</td>
                  <td className="px-4 py-3">
                    <select
                      value={o.status}
                      onChange={(e) => updateStatus(o.id, e.target.value)}
                      className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1 text-xs capitalize"
                    >
                      {STATUSES.filter((s) => s !== 'all').map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-[rgb(var(--text-muted))]">{new Date(o.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
