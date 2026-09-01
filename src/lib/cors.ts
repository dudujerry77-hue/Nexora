import { NextRequest, NextResponse } from 'next/server';

// Origins allowed to make cross-origin *browser* requests to Nexora's
// order-ingestion endpoints, for local integration testing only (e.g. a
// storefront served by VS Code "Live Server", which defaults to port
// 5500). A real external store integration is expected to call these
// endpoints server-to-server (see docs/API_CONTRACTS.md), where CORS does
// not apply at all — this allowlist exists purely so a developer can drive
// the same request from a browser-based test page during local
// development. Never widened to '*', and never active outside development
// — see isDev() below.
const DEV_ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5500', 'http://localhost:5500']);

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function resolveAllowedOrigin(req: NextRequest): string | null {
  if (!isDev()) return null;
  const origin = req.headers.get('origin');
  return origin && DEV_ALLOWED_ORIGINS.has(origin) ? origin : null;
}

/**
 * Adds CORS headers to an already-built response when the request's Origin
 * is an allowed local dev origin. In production, or for any other origin,
 * the response is returned completely unchanged — no
 * Access-Control-Allow-Origin header — identical to today's behavior.
 */
export function withDevCors(req: NextRequest, response: NextResponse): NextResponse {
  const origin = resolveAllowedOrigin(req);
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

/**
 * Handles a CORS preflight OPTIONS request for a route that opts in via
 * withDevCors. An origin outside the dev allowlist (including any
 * production request) gets a bare 204 with no CORS headers, which browsers
 * treat as a denial — the same effective outcome as today, before any of
 * this existed.
 */
export function devCorsPreflight(req: NextRequest, allowedMethods: string): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  const origin = resolveAllowedOrigin(req);
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', allowedMethods);
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Nexora-Signature, X-Nexora-Timestamp',
    );
    response.headers.set('Access-Control-Max-Age', '600');
  }
  return response;
}
