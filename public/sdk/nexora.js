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
 *
 *     // Automatic monitoring (on by default — see `autoCapture` below):
 *     // uncaught JS errors, unhandled promise rejections, failed fetch()
 *     // calls, and console.error() calls are reported to Nexora's
 *     // Monitoring feed automatically. No extra code required.
 *
 *     // Manual capture, if you want to report something yourself:
 *     Nexora.captureError(error);
 *     Nexora.captureMessage("Checkout button did nothing", "warning");
 *   </script>
 */
(function (global) {
  'use strict';

  var state = {
    storeId: null,
    publicKey: null,
    apiBase: null,
    ready: false,
    autoCapture: true,
  };

  // Kept so our own internal diagnostics never recurse through a
  // developer's console.error wrapper (below) or get mistaken for a page
  // error by anything else watching the console.
  var rawConsoleError = global.console ? global.console.error.bind(global.console) : function () {};
  var rawConsoleWarn = global.console ? global.console.warn.bind(global.console) : function () {};
  var nativeFetch = global.fetch ? global.fetch.bind(global) : null;

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

  function post(path, body) {
    if (!nativeFetch) return;
    // navigator.sendBeacon can't carry an Authorization header, so we use a
    // best-effort fetch with keepalive instead — this is a non-critical,
    // fire-and-forget signal, not a source of truth.
    nativeFetch(state.apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.publicKey },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(function () {
      /* best-effort; a dropped beacon should never break the host page */
    });
  }

  function send(type, payload) {
    if (!state.ready) {
      rawConsoleWarn('[Nexora] Nexora.init() must be called before ' + type + '().');
      return;
    }
    post('/api/sdk/event', { type: type, payload: payload || {} });
  }

  function diagnostics() {
    return {
      viewportWidth: global.innerWidth,
      viewportHeight: global.innerHeight,
      userAgent: global.navigator ? global.navigator.userAgent : undefined,
    };
  }

  function isNexoraBeaconUrl(url) {
    return typeof url === 'string' && (url.indexOf('/api/monitoring/events') !== -1 || url.indexOf('/api/sdk/event') !== -1);
  }

  function truncate(str, max) {
    if (typeof str !== 'string') return str;
    return str.length > max ? str.slice(0, max) : str;
  }

  // Query strings and fragments sometimes carry tokens/API keys (e.g.
  // "?api_key=..." or "?access_token=..."), and a URL can embed Basic Auth
  // credentials directly ("https://user:pass@host/..."). A failed-request
  // message only needs to say *which endpoint* failed, so this keeps just
  // the origin + path and drops everything else before it's ever sent.
  function sanitizeUrl(url) {
    try {
      var base = global.location ? global.location.href : undefined;
      var parsed = new URL(String(url), base);
      return parsed.origin + parsed.pathname;
    } catch (e) {
      return String(url).split('?')[0].split('#')[0];
    }
  }

  function sendMonitoringEvent(type, message, extra) {
    if (!state.ready) return;
    extra = extra || {};
    post('/api/monitoring/events', {
      type: type,
      message: truncate(String(message || 'Unknown error'), 2000),
      stack: extra.stack ? truncate(String(extra.stack), 8000) : undefined,
      route: global.location ? global.location.pathname : undefined,
      statusCode: extra.statusCode,
      severity: extra.severity,
      diagnostics: diagnostics(),
    });
  }

  function installAutoCapture() {
    global.addEventListener('error', function (event) {
      // Distinguishes a real script error (has a message/error) from a
      // resource-load failure (image/script 404), which fires the same
      // event type but carries no useful error object.
      if (!event || (!event.message && !event.error)) return;
      sendMonitoringEvent('js_error', event.message || (event.error && event.error.message), {
        stack: event.error && event.error.stack,
      });
    });

    global.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var message = reason && reason.message ? reason.message : String(reason);
      sendMonitoringEvent('unhandled_rejection', message, { stack: reason && reason.stack });
    });

    if (nativeFetch) {
      global.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : input && input.url;
        return nativeFetch(input, init).then(
          function (response) {
            if (!response.ok && !isNexoraBeaconUrl(url)) {
              sendMonitoringEvent('network_error', (init && init.method ? init.method : 'GET') + ' ' + sanitizeUrl(url) + ' failed', {
                statusCode: response.status,
              });
            }
            return response;
          },
          function (err) {
            if (!isNexoraBeaconUrl(url)) {
              sendMonitoringEvent('network_error', (init && init.method ? init.method : 'GET') + ' ' + sanitizeUrl(url) + ' failed: ' + err.message, {
                stack: err.stack,
              });
            }
            throw err;
          },
        );
      };
    }

    if (global.console) {
      var originalConsoleError = global.console.error;
      global.console.error = function () {
        try {
          var args = Array.prototype.slice.call(arguments);
          sendMonitoringEvent('console_error', args.map(String).join(' '));
        } catch (e) {
          /* never let capture itself break console.error */
        }
        return originalConsoleError.apply(global.console, arguments);
      };
    }
  }

  global.Nexora = {
    init: function (options) {
      options = options || {};
      if (!options.storeId || !options.publicKey) {
        rawConsoleError('[Nexora] init() requires { storeId, publicKey }.');
        return;
      }
      if (!/^nx_public_/.test(options.publicKey)) {
        rawConsoleError('[Nexora] Refusing to initialize with a non-public key. Never put a secret API key in browser code.');
        return;
      }
      state.storeId = options.storeId;
      state.publicKey = options.publicKey;
      state.apiBase = options.apiBase || currentScriptOrigin();
      state.autoCapture = options.autoCapture !== false;
      state.ready = true;

      if (state.autoCapture) installAutoCapture();
    },

    trackPageView: function () {
      send('page_view', { path: global.location ? global.location.pathname : undefined });
    },

    identify: function (traits) {
      send('identify', traits || {});
    },

    /** Manually report a caught error. `error` should be an Error instance. */
    captureError: function (error, extra) {
      if (!state.ready) {
        rawConsoleWarn('[Nexora] Nexora.init() must be called before captureError().');
        return;
      }
      var message = error && error.message ? error.message : String(error);
      sendMonitoringEvent('js_error', message, {
        stack: error && error.stack,
        severity: extra && extra.severity,
      });
    },

    /** Manually report a crash — the app became unusable, not just one error. */
    captureCrash: function (message, extra) {
      sendMonitoringEvent('crash', message, { stack: extra && extra.stack, severity: 'critical' });
    },

    /** Manually report a free-text message at a given severity. */
    captureMessage: function (message, severity) {
      sendMonitoringEvent('console_error', message, { severity: severity });
    },
  };
})(typeof window !== 'undefined' ? window : this);
