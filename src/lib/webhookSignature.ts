import crypto from 'crypto';

const REPLAY_WINDOW_SECONDS = 300;

export function signWebhookBody(secret: string, timestamp: number, rawBody: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  return `sha256=${hmac.digest('hex')}`;
}

export function verifyWebhookSignature(params: {
  secret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  now?: number;
}): { valid: boolean; reason?: string } {
  const { secret, timestampHeader, signatureHeader, rawBody } = params;
  const now = params.now ?? Math.floor(Date.now() / 1000);

  if (!timestampHeader || !signatureHeader) {
    return { valid: false, reason: 'missing_headers' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'invalid_timestamp' };
  }
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const expected = signWebhookBody(secret, timestamp, rawBody);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  const matches = crypto.timingSafeEqual(expectedBuf, actualBuf);
  return matches ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}
