import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE } from './auth';
import { CSRF_COOKIE_NAME, generateCsrfToken } from './csrf';

const isProd = process.env.NODE_ENV === 'production';

export function setSessionCookies(res: NextResponse, token: string): string {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  const csrfToken = generateCsrfToken();
  res.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // must be readable by client JS to echo back in the header
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  return csrfToken;
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  res.cookies.set(CSRF_COOKIE_NAME, '', { path: '/', maxAge: 0 });
}
