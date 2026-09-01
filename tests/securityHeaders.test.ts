import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

// Regression test for the "auth forms reset on submit in local dev" bug.
//
// Root cause: next.config.js's Content-Security-Policy applied
// script-src 'self' 'unsafe-inline' identically in every environment.
// `next dev`'s Fast Refresh/HMR runtime evaluates module code via eval()
// (webpack's "eval" devtool) — this is required by `next dev` and isn't
// configurable — so a script-src without 'unsafe-eval' throws on every
// client bundle in dev, breaking React hydration entirely. With no
// hydrated onSubmit handler, clicking "Log in"/"Create account" fell back
// to the browser's native form submission (a full-page GET to the same
// URL), which is what looked like the form "resetting" — the page had
// actually reloaded from scratch. Production builds never eval(), so the
// same strict policy is safe and unchanged there.
//
// This test loads next.config.js under both NODE_ENV values (clearing the
// require cache, since the module computes its CSP once at load time) and
// asserts the policy shape directly, so a future edit can't silently
// reintroduce 'unsafe-eval'-less dev CSP or leak 'unsafe-eval' into prod.

const require = createRequire(import.meta.url);
const CONFIG_PATH = path.resolve(__dirname, '../next.config.js');

interface HeaderEntry {
  key: string;
  value: string;
}

// process.env.NODE_ENV is typed read-only; Object.assign merges into the
// same live object without tripping that type restriction.
function setNodeEnv(value: string) {
  Object.assign(process.env, { NODE_ENV: value });
}

async function getCspValue(nodeEnv: string): Promise<string> {
  const originalNodeEnv = process.env.NODE_ENV;
  setNodeEnv(nodeEnv);
  delete require.cache[require.resolve(CONFIG_PATH)];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require(CONFIG_PATH);
  const headerGroups = await config.headers();
  const csp = (headerGroups[0].headers as HeaderEntry[]).find((h) => h.key === 'Content-Security-Policy');

  if (originalNodeEnv !== undefined) setNodeEnv(originalNodeEnv);
  delete require.cache[require.resolve(CONFIG_PATH)];

  if (!csp) throw new Error('Content-Security-Policy header not found');
  return csp.value;
}

describe('Content-Security-Policy (next.config.js)', () => {
  it("allows 'unsafe-eval' in development, so next dev's Fast Refresh/HMR runtime doesn't crash client hydration", async () => {
    const csp = await getCspValue('development');
    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it("never allows 'unsafe-eval' in production", async () => {
    const csp = await getCspValue('production');
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });

  it('keeps every other directive identical between development and production', async () => {
    const devCsp = await getCspValue('development');
    const prodCsp = await getCspValue('production');

    const stripScriptSrc = (csp: string) => csp.replace(/script-src[^;]*;/, 'script-src;');
    expect(stripScriptSrc(devCsp)).toBe(stripScriptSrc(prodCsp));
  });
});
