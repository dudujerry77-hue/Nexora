'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setLoading(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    router.push('/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-sm p-8">
        <Link href="/" className="text-sm font-bold tracking-tight">
          NEXORA
        </Link>
        <h1 className="mt-4 text-xl font-semibold">Log in</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[rgb(var(--text-muted))]">
          No account?{' '}
          <Link href="/register" className="text-brand-600 dark:text-brand-400">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
