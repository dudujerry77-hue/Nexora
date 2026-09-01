'use client';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export interface ApiResult<T> {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  status: number;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = readCookie('nexora_csrf');
    if (csrfToken) headers.set('x-nexora-csrf', csrfToken);
  }

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  return { ...body, status: res.status };
}
