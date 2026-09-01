/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

// Next.js's dev-mode Fast Refresh/HMR client runtime evaluates module code
// via eval() (webpack's "eval" devtool) — this is how `next dev` hot-reloads
// modules and is not configurable. A strict script-src without
// 'unsafe-eval' throws an EvalError on every client bundle in development,
// which breaks React hydration (including form onSubmit handlers) and
// causes forms to fall back to native browser submission — see the
// "authentication broken in local dev" investigation. Production builds
// never eval() anything, so the strict policy stays exactly as strict in
// production; only `next dev` gets the relaxation it requires.
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';`,
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
