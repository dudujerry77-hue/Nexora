'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';
import { EmptyState, LoadingSkeleton } from '@/components/dashboard/ui';

interface Organization {
  id: string;
  name: string;
  owner: { name: string; email: string };
  _count: { stores: number; members: number };
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function NexoraAdminPage() {
  const { push } = useToast();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);

  function load() {
    apiFetch<Organization[]>('/api/admin/organizations').then((res) => setOrganizations(res.data ?? []));
    apiFetch<AdminUser[]>('/api/admin/users').then((res) => setUsers(res.data ?? []));
  }

  useEffect(load, []);

  async function suspend(orgId: string) {
    if (!confirm('Suspend this organization? All of its members will lose dashboard access.')) return;
    const res = await apiFetch(`/api/admin/organizations/${orgId}/suspend`, { method: 'POST' });
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push('Organization suspended.', 'success');
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Platform overview</h1>
        <p className="text-sm text-[rgb(var(--text-muted))]">Cross-tenant view — visible only to Nexora super admins.</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Organizations ({organizations?.length ?? '…'})</h2>
        {organizations === null ? (
          <LoadingSkeleton />
        ) : organizations.length === 0 ? (
          <EmptyState title="No organizations yet" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border))] text-left text-xs uppercase text-[rgb(var(--text-muted))]">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2">Owner</th>
                <th className="py-2">Stores</th>
                <th className="py-2">Members</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <td className="py-2">{org.name}</td>
                  <td className="py-2">
                    {org.owner.name} ({org.owner.email})
                  </td>
                  <td className="py-2">{org._count.stores}</td>
                  <td className="py-2">{org._count.members}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => suspend(org.id)} className="text-xs text-red-500">
                      Suspend
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Users ({users?.length ?? '…'})</h2>
        {users === null ? (
          <LoadingSkeleton />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border))] text-left text-xs uppercase text-[rgb(var(--text-muted))]">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[rgb(var(--border))] last:border-0">
                  <td className="py-2">{u.name}</td>
                  <td className="py-2">{u.email}</td>
                  <td className="py-2 capitalize">{u.role.toLowerCase()}</td>
                  <td className="py-2 text-xs text-[rgb(var(--text-muted))]">{new Date(u.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
