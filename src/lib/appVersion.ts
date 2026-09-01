// Kept in sync with package.json's "version" field by hand — avoided a
// JSON import here so this stays usable from both client and server
// bundles without pulling the whole package.json (scripts, deps) into the
// client chunk. Used only as a non-sensitive diagnostic tag on reports.
export const APP_VERSION = '0.1.0';
