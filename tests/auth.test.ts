import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, buildRequest, registerUser } from './helpers';

describe('authentication', () => {
  beforeEach(resetDb);

  it('registers a new owner and organization, returning a session cookie', async () => {
    const { res, body, jar } = await registerUser({
      name: 'Ada Owner',
      email: 'ada@example.com',
      password: 'supersecret123',
      orgName: 'Ada Group',
    });

    expect(res.status).toBe(201);
    expect(body.data.user.email).toBe('ada@example.com');
    expect(body.data.user.role).toBe('OWNER');
    expect(jar.session).toBeTruthy();
    expect(jar.csrf).toBeTruthy();
  });

  it('rejects duplicate registration for the same email', async () => {
    await registerUser({ name: 'Ada', email: 'dupe@example.com', password: 'supersecret123', orgName: 'Org A' });
    const { res, body } = await registerUser({ name: 'Ada 2', email: 'dupe@example.com', password: 'supersecret123', orgName: 'Org B' });

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('conflict');
  });

  it('logs in with correct credentials and rejects wrong ones identically', async () => {
    await registerUser({ name: 'Bola', email: 'bola@example.com', password: 'correct-password', orgName: 'Bola Org' });

    const { POST } = await import('@/app/api/auth/login/route');

    const good = await POST(buildRequest('/api/auth/login', { method: 'POST', body: { email: 'bola@example.com', password: 'correct-password' } }));
    expect(good.status).toBe(200);

    const badPassword = await POST(buildRequest('/api/auth/login', { method: 'POST', body: { email: 'bola@example.com', password: 'wrong' } }));
    const badPasswordBody = await badPassword.json();
    expect(badPassword.status).toBe(401);
    expect(badPasswordBody.error.code).toBe('unauthorized');

    const noSuchUser = await POST(buildRequest('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong' } }));
    const noSuchUserBody = await noSuchUser.json();
    // Same error code/message as a wrong password — login must not leak whether an email is registered.
    expect(noSuchUser.status).toBe(401);
    expect(noSuchUserBody.error.message).toBe(badPasswordBody.error.message);
  });

  it('rejects requests to protected routes without a session', async () => {
    const { GET } = await import('@/app/api/auth/me/route');
    const res = await GET(buildRequest('/api/auth/me'));
    expect(res.status).toBe(401);
  });

  it('rejects a tampered session cookie', async () => {
    const { GET } = await import('@/app/api/auth/me/route');
    const res = await GET(buildRequest('/api/auth/me', { jar: { session: 'not-a-real-jwt' } }));
    expect(res.status).toBe(401);
  });
});
