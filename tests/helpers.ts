import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export async function resetDb() {
  await prisma.$transaction([
    prisma.monitoringEvent.deleteMany(),
    prisma.monitoringIssue.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.integrationLog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.inventory.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.apiKey.deleteMany(),
    prisma.webhookEndpoint.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.storeAssignment.deleteMany(),
    prisma.store.deleteMany(),
    prisma.member.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

interface CookieJar {
  session?: string;
  csrf?: string;
}

export function cookieHeader(jar: CookieJar): string {
  const parts: string[] = [];
  if (jar.session) parts.push(`nexora_session=${jar.session}`);
  if (jar.csrf) parts.push(`nexora_csrf=${jar.csrf}`);
  return parts.join('; ');
}

export function buildRequest(
  url: string,
  init: { method?: string; body?: unknown; jar?: CookieJar; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.jar) {
    const cookie = cookieHeader(init.jar);
    if (cookie) headers.set('cookie', cookie);
    if (init.jar.csrf) headers.set('x-nexora-csrf', init.jar.csrf);
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Extracts session+csrf cookies from a route handler's NextResponse. */
export function extractJar(response: { cookies: { get: (name: string) => { value: string } | undefined } }): CookieJar {
  return {
    session: response.cookies.get('nexora_session')?.value,
    csrf: response.cookies.get('nexora_csrf')?.value,
  };
}

// POST /api/auth/register rate-limits by client IP (`x-forwarded-for`,
// falling back to a constant "local" when absent — see
// src/app/api/auth/register/route.ts). Real distinct signups come from
// distinct IPs; a test suite calling registerUser many times in one file
// would otherwise all share that "local" bucket and trip the limiter
// against each other. A unique synthetic IP per call keeps each test
// registration independent, matching real-world behavior.
let registerCallCount = 0;

export async function registerUser(params: { name: string; email: string; password: string; orgName: string }) {
  const { POST } = await import('@/app/api/auth/register/route');
  registerCallCount += 1;
  const res = await POST(
    buildRequest('/api/auth/register', {
      method: 'POST',
      body: params,
      headers: { 'x-forwarded-for': `10.0.0.${registerCallCount % 250}` },
    }),
  );
  const body = await res.clone().json();
  return { res, body, jar: extractJar(res) };
}

export async function createStore(jar: CookieJar, params: { name: string; type?: string }) {
  const { POST } = await import('@/app/api/stores/route');
  const res = await POST(buildRequest('/api/stores', { method: 'POST', body: params, jar }));
  const body = await res.clone().json();
  return { res, body };
}

export async function createIntegration(jar: CookieJar, params: { storeId: string; provider: string }) {
  const { POST } = await import('@/app/api/integrations/route');
  const res = await POST(buildRequest('/api/integrations', { method: 'POST', body: params, jar }));
  const body = await res.clone().json();
  return { res, body };
}
