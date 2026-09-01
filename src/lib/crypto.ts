import crypto from 'crypto';

// Symmetric encryption for secrets Nexora must be able to *use* later (like
// a webhook signing secret it needs to recompute an HMAC with) — as opposed
// to API keys/passwords, which only ever need one-way hash comparison.
// Key is derived via scrypt so operators can set any passphrase as
// NEXORA_ENCRYPTION_KEY rather than having to generate raw key bytes.

const ALGO = 'aes-256-gcm';

function deriveKey(): Buffer {
  const passphrase = process.env.NEXORA_ENCRYPTION_KEY ?? 'dev-only-insecure-encryption-key-change-me';
  return crypto.scryptSync(passphrase, 'nexora-secret-store', 32);
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptSecret(ciphertext: string): string {
  const key = deriveKey();
  const raw = Buffer.from(ciphertext, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
