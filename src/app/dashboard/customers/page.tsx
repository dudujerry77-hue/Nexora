'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useStoreScope } from '@/lib/useStores';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  _count: { orders: number };
}

export default function CustomersPage() {
  const { selectedStoreId } = useStoreScope();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedStoreId) params.set('storeId', selectedStoreId);
    apiFetch<Customer[]>(`/api/customers?${params.toString()}`).then((res) => {
      if (res.error) setError(res.error.message);
      else setCustomers(res.data ?? []);
      setLoading(false);
    });
  }, [selectedStoreId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Customers</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Customers seen across your connected stores.</p>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" body="Customers attached to incoming orders will appear here." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border))] text-left text-xs uppercase text-[rgb(var(--text-muted))]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Orders</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.email ?? '—'}</td>
                  <td className="px-4 py-3">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3">{c._count.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
