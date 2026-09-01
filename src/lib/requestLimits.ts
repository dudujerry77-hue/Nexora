import { NextRequest } from 'next/server';
import { ApiError } from './errors';

/**
 * Rejects a request whose declared Content-Length exceeds `maxBytes`,
 * before the body is read/parsed — cheap protection against a client
 * (malicious or buggy) sending a huge JSON body, e.g. many base64-encoded
 * product images stacked in one request. Per-field size caps in the zod
 * schemas remain the authoritative bound (this only guards against paying
 * the cost of buffering/parsing an oversized body in the first place); a
 * request without a Content-Length header (e.g. chunked transfer) is not
 * blocked here and still relies on those per-field caps.
 */
export function assertRequestSizeWithin(req: NextRequest, maxBytes: number): void {
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new ApiError('payload_too_large', `Request body exceeds the ${Math.floor(maxBytes / 1_000_000)}MB limit.`);
  }
}
