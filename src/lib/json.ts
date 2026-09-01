// Helpers for the "JSON stored as TEXT" columns required by the SQLite
// connector (see docs/DATABASE_SCHEMA.md). Centralizing this means a future
// move to native Postgres `Json` columns only touches this file.

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
