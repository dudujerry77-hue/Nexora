import crypto from 'crypto';

export const CSRF_COOKIE_NAME = 'nexora_csrf';
export const CSRF_HEADER_NAME = 'x-nexora-csrf';

export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requiresCsrfCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function csrfTokensMatch(cookieToken: string | undefined, headerToken: string | null): boolean {
  if (!cookieToken || !headerToken) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
