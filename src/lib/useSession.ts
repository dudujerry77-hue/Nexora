'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './apiClient';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SessionOrganization {
  id: string;
  name: string;
}

interface MeResponse {
  user: SessionUser;
  organization: SessionOrganization | null;
  memberRole: string | null;
}

export function useSession(options: { redirectTo?: string; requireSuperAdmin?: boolean } = {}) {
  const router = useRouter();
  const [session, setSession] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>('/api/auth/me').then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        router.push(options.redirectTo ?? '/login');
        return;
      }
      if (options.requireSuperAdmin && res.data.user.role !== 'SUPER_ADMIN') {
        router.push('/dashboard');
        return;
      }
      setSession(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { session, loading };
}
