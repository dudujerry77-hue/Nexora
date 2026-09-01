import crypto from 'crypto';

const KEY_BYTES = 24; // -> 32 url-safe base64 chars

export interface GeneratedApiKey {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
}

function randomKeyBody(): string {
  return crypto.randomBytes(KEY_BYTES).toString('base64url');
}

export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const body = randomKeyBody();
  const fullKey = `nx_${env}_${body}`;
  const keyPrefix = `nx_${env}_${body.slice(0, 4)}`;
  const keyHash = hashApiKey(fullKey);
  return { fullKey, keyPrefix, keyHash };
}

export function hashApiKey(fullKey: string): string {
  return crypto.createHash('sha256').update(fullKey).digest('hex');
}

export function generatePublicKey(): string {
  return `nx_public_${crypto.randomBytes(16).toString('base64url')}`;
}

export const API_KEY_SCOPES = [
  'read',
  'orders:write',
  'products:write',
  'inventory:write',
  'customers:write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
