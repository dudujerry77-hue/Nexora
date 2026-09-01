/*!
 * Nexora JavaScript SDK — client-side, safe-only integration path.
 *
 * IMPORTANT: This SDK intentionally cannot create orders, write products,
 * or read another store's data. It only ever authenticates with a
 * low-privilege "public key" (read-scoped). Order creation must go through
 * your own backend using a secret API key — see docs/INTEGRATIONS.md in the
 * Nexora repository ("why the SDK can't create orders").
 *
 * Usage:
 *   <script src="https://your-nexora-host/sdk/nexora.js"></script>
 *   <script>
 *     Nexora.init({ storeId: "store_123", publicKey: "nx_public_xxxxx" });
 *     Nexora.trackPageView();
 *     Nexora.identify({ email: "shopper@example.com" });
 *   </script>
 */
(function (global) {
  'use strict';

  var state = {
    storeId: null,
    publicKey: null,
    apiBase: null,
    ready: false,
  };

  function currentScriptOrigin() {
    // Default to the origin nexora.js was loaded from, so a store owner
    // doesn't have to hard-code the Nexora API host separately.
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('/sdk/nexora.js') !== -1) {
        try {
          return new URL(src).origin;
        } catch (e) {
          return '';
        }
      }
    }
    return '';
  }

  function send(type, payload) {
    if (!state.ready) {
      // eslint-disable-next-line no-console
      console.warn('[Nexora] Nexora.init() must be called before ' + type + '().');
      return;
    }
    var body = JSON.stringify({ type: type, payload: payload || {} });
    var url = state.apiBase + '/api/sdk/event';

    // navigator.sendBeacon can't carry an Authorization header, so we use a
    // best-effort fetch with keepalive instead — this is a non-critical,
    // fire-and-forget analytics signal, not a source of truth.
    if (global.fetch) {
      global
        .fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.publicKey },
          body: body,
          keepalive: true,
        })
        .catch(function () {
          /* best-effort; a dropped analytics beacon should never break the host page */
        });
    }
  }

  global.Nexora = {
    init: function (options) {
      options = options || {};
      if (!options.storeId || !options.publicKey) {
        // eslint-disable-next-line no-console
        console.error('[Nexora] init() requires { storeId, publicKey }.');
        return;
      }
      if (!/^nx_public_/.test(options.publicKey)) {
        // eslint-disable-next-line no-console
        console.error('[Nexora] Refusing to initialize with a non-public key. Never put a secret API key in browser code.');
        return;
      }
      state.storeId = options.storeId;
      state.publicKey = options.publicKey;
      state.apiBase = options.apiBase || currentScriptOrigin();
      state.ready = true;
    },

    trackPageView: function () {
      send('page_view', { path: global.location ? global.location.pathname : undefined });
    },

    identify: function (traits) {
      send('identify', traits || {});
    },
  };
})(typeof window !== 'undefined' ? window : this);
