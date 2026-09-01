import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.NEXORA_JWT_SECRET ?? 'dev-only-insecure-secret-change-me';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface SessionTokenPayload {
  sub: string; // userId
  role: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === 'string') return null;
    if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') return null;
    return { sub: decoded.sub, role: decoded.role };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = 'nexora_session';
export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
