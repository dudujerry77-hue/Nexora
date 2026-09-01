import { NextRequest } from 'next/server';
import { prisma } from './db';
import { verifySessionToken, SESSION_COOKIE_NAME } from './auth';
import { hashApiKey, ApiKeyScope } from './apiKey';
import { ApiError } from './errors';
import { fromJson } from './json';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfTokensMatch, requiresCsrfCheck } from './csrf';
import type { Member, Store, User } from '@prisma/client';

export interface SessionContext {
  user: User;
  member: Member;
}

/**
 * Resolves the dashboard session cookie into a user + their organization
 * membership. Throws `unauthorized` if the cookie is missing/invalid, or if
 * the user has no organization membership at all.
 *
 * MVP simplification: a user is treated as belonging to a single
 * organization (the first membership found) — see docs/AUTH.md. The schema
 * (Member is many-to-many) supports multi-org users for a future release.
 */
export async function requireSession(req: NextRequest): Promise<SessionContext> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new ApiError('unauthorized', 'No session cookie.');

  const payload = verifySessionToken(token);
  if (!payload) throw new ApiError('unauthorized', 'Invalid or expired session.');

  // Double-submit CSRF check for state-changing browser requests. API-key
  // authenticated requests never reach this path (they use requireApiKey).
  if (requiresCsrfCheck(req.method)) {
    const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value;
    const headerToken = req.headers.get(CSRF_HEADER_NAME);
    if (!csrfTokensMatch(cookieToken, headerToken)) {
      throw new ApiError('forbidden', 'CSRF token missing or invalid.');
    }
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw new ApiError('unauthorized', 'Session user no longer exists.');

  if (user.role === 'SUPER_ADMIN') {
    // Super admins operate cross-tenant; they have no store-scoped member row.
    return { user, member: null as unknown as Member };
  }

  const member = await prisma.member.findFirst({
    where: { userId: user.id, status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  if (!member) throw new ApiError('forbidden', 'User has no active organization membership.');

  return { user, member };
}

export function requireSuperAdmin(ctx: SessionContext): void {
  if (ctx.user.role !== 'SUPER_ADMIN') {
    throw new ApiError('forbidden', 'Super admin access required.');
  }
}

export type StorePermission =
  | 'view_orders'
  | 'manage_orders'
  | 'view_products'
  | 'manage_products'
  | 'view_customers'
  | 'view_monitoring'
  | 'manage_monitoring';

interface StorePermissions {
  viewOrders?: boolean;
  manageOrders?: boolean;
  viewProducts?: boolean;
  manageProducts?: boolean;
  viewCustomers?: boolean;
  viewMonitoring?: boolean;
  manageMonitoring?: boolean;
}

const PERMISSION_KEY_MAP: Record<StorePermission, keyof StorePermissions> = {
  view_orders: 'viewOrders',
  manage_orders: 'manageOrders',
  view_products: 'viewProducts',
  manage_products: 'manageProducts',
  view_customers: 'viewCustomers',
  view_monitoring: 'viewMonitoring',
  manage_monitoring: 'manageMonitoring',
};

/**
 * Confirms the session's member may act on `storeId` with `permission`.
 * Always loads the store scoped to the member's own organizationId — a
 * store belonging to a different org is treated identically to a
 * non-existent store (`not_found`), so an id substitution attack learns
 * nothing about other tenants.
 */
export async function assertStoreAccess(params: {
  member: Member;
  storeId: string;
  permission?: StorePermission;
}): Promise<Store> {
  const { member, storeId, permission } = params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, organizationId: member.organizationId },
  });
  if (!store) throw new ApiError('not_found', 'Store not found.');

  if (member.role === 'OWNER') return store;

  if (!permission) return store;

  const assignment = await prisma.storeAssignment.findFirst({
    where: { memberId: member.id, storeId: store.id },
  });
  if (!assignment) throw new ApiError('forbidden', 'Not assigned to this store.');

  const perms = fromJson<StorePermissions>(assignment.permissions, {});
  const key = PERMISSION_KEY_MAP[permission];
  if (!perms[key]) throw new ApiError('forbidden', `Missing permission: ${permission}.`);

  return store;
}

/**
 * Returns the list of storeIds the member may access for a given
 * permission (or just membership, if permission is omitted). Always
 * scoped to the member's own organization.
 */
export async function getAccessibleStoreIds(member: Member, permission?: StorePermission): Promise<string[]> {
  const orgStores = await prisma.store.findMany({
    where: { organizationId: member.organizationId },
    select: { id: true },
  });
  const orgStoreIds = new Set(orgStores.map((s) => s.id));

  if (member.role === 'OWNER') return Array.from(orgStoreIds);

  const assignments = await prisma.storeAssignment.findMany({ where: { memberId: member.id } });
  return assignments
    .filter((a) => orgStoreIds.has(a.storeId))
    .filter((a) => {
      if (!permission) return true;
      const perms = fromJson<StorePermissions>(a.permissions, {});
      return Boolean(perms[PERMISSION_KEY_MAP[permission]]);
    })
    .map((a) => a.storeId);
}

export interface ApiKeyContext {
  apiKeyId: string;
  storeId: string;
  integrationId: string;
  scopes: ApiKeyScope[];
}

export async function requireApiKey(req: NextRequest, requiredScope?: ApiKeyScope): Promise<ApiKeyContext> {
  const header = req.headers.get('authorization') ?? '';
  // Includes `public` — the js_sdk integration's only credential
  // (generatePublicKey() in src/lib/apiKey.ts) is `nx_public_...`, and it
  // must reach this same scope check (it only ever carries `read`) so the
  // SDK's beacon endpoints (/api/sdk/event, /api/monitoring/events) work.
  const match = /^Bearer\s+(nx_(?:live|test|public)_[A-Za-z0-9_-]+)$/.exec(header);
  if (!match) throw new ApiError('unauthorized', 'Missing or malformed API key.');

  const keyHash = hashApiKey(match[1]);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!apiKey || apiKey.revokedAt) throw new ApiError('unauthorized', 'Invalid or revoked API key.');

  const scopes = fromJson<ApiKeyScope[]>(apiKey.scopes, []);
  if (requiredScope && !scopes.includes(requiredScope)) {
    throw new ApiError('forbidden', `API key is missing required scope: ${requiredScope}.`);
  }

  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return {
    apiKeyId: apiKey.id,
    storeId: apiKey.storeId,
    integrationId: apiKey.integrationId,
    scopes,
  };
}
