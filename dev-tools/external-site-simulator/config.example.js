// Copy this file to config.local.js (same folder) and fill in real values
// from your own local Nexora instance. config.local.js is gitignored — it
// is never committed, so a real API key never lands in source control.
//
// Where to get these values:
//   1. Log into Nexora at http://localhost:3000 and open a store.
//   2. Click "Generate credentials" (provider: Nexora API / custom_api).
//   3. Copy the "storeId" and the "apiKey" it shows you ONCE.
window.NEXORA_TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  storeId: 'REPLACE_WITH_YOUR_STORE_ID',
  apiKey: 'REPLACE_WITH_YOUR_nx_live_OR_nx_test_KEY',
};
