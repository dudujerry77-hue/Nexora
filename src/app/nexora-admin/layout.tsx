'use client';

import { useSession } from '@/lib/useSession';

// Not linked from any user-facing nav — reachable only by typing the URL,
// and every /api/admin/* route independently re-checks role === SUPER_ADMIN
// server-side (see src/lib/authz.ts:requireSuperAdmin). This layout's check
// is a UX convenience, not the security boundary.
export default function NexoraAdminLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession({ redirectTo: '/login', requireSuperAdmin: true });

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="skeleton h-8 w-40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[rgb(var(--border))] bg-black px-6 py-4 text-white">
        <span className="text-sm font-bold tracking-widest">NEXORA — PLATFORM ADMIN</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
