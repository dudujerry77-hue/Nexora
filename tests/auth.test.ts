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

describe('profile picture (avatarUrl) persistence', () => {
  beforeEach(resetDb);

  it('defaults to null (renders as initials) for a newly registered user', async () => {
    const { jar } = await registerUser({ name: 'Ada Owner', email: 'avatar-default@example.com', password: 'password123', orgName: 'Avatar Org 1' });
    const { GET } = await import('@/app/api/auth/me/route');
    const res = await GET(buildRequest('/api/auth/me', { jar }));
    const body = await res.json();
    expect(body.data.user.avatarUrl).toBeNull();
  });

  it('persists an http(s) avatar URL and returns it on subsequent GET /api/auth/me', async () => {
    const { jar } = await registerUser({ name: 'Ada Owner', email: 'avatar-url@example.com', password: 'password123', orgName: 'Avatar Org 2' });
    const { PATCH } = await import('@/app/api/auth/me/route');
    const patchRes = await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', jar, body: { avatarUrl: 'https://example.com/me.jpg' } }));
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).data.avatarUrl).toBe('https://example.com/me.jpg');

    const { GET } = await import('@/app/api/auth/me/route');
    const getRes = await GET(buildRequest('/api/auth/me', { jar }));
    expect((await getRes.json()).data.user.avatarUrl).toBe('https://example.com/me.jpg');
  });

  it('persists a data: image URL avatar (device upload), matching the product-image upload contract', async () => {
    const { jar } = await registerUser({ name: 'Ada Owner', email: 'avatar-data@example.com', password: 'password123', orgName: 'Avatar Org 3' });
    const { PATCH } = await import('@/app/api/auth/me/route');
    const dataUrl = 'data:image/png;base64,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', jar, body: { avatarUrl: dataUrl } }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.avatarUrl).toBe(dataUrl);
  });

  it('clears the avatar back to null (initials fallback) when avatarUrl is explicitly set to null', async () => {
    const { jar } = await registerUser({ name: 'Ada Owner', email: 'avatar-clear@example.com', password: 'password123', orgName: 'Avatar Org 4' });
    const { PATCH } = await import('@/app/api/auth/me/route');
    await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', jar, body: { avatarUrl: 'https://example.com/me.jpg' } }));
    const clearRes = await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', jar, body: { avatarUrl: null } }));
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json()).data.avatarUrl).toBeNull();
  });

  it('rejects a non-URL, non-data: string as an avatar (not a real image reference)', async () => {
    const { jar } = await registerUser({ name: 'Ada Owner', email: 'avatar-bad@example.com', password: 'password123', orgName: 'Avatar Org 5' });
    const { PATCH } = await import('@/app/api/auth/me/route');
    const res = await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', jar, body: { avatarUrl: 'not-a-real-image-reference' } }));
    expect(res.status).toBe(422);
  });

  it('rejects an avatar update without a session', async () => {
    const { PATCH } = await import('@/app/api/auth/me/route');
    const res = await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', body: { avatarUrl: 'https://example.com/me.jpg' } }));
    expect(res.status).toBe(401);
  });

  it('never lets updating an avatar change name, email, or role', async () => {
    const { jar } = await registerUser({ name: 'Ada Owner', email: 'avatar-scope@example.com', password: 'password123', orgName: 'Avatar Org 6' });
    const { PATCH } = await import('@/app/api/auth/me/route');
    const res = await PATCH(buildRequest('/api/auth/me', { method: 'PATCH', jar, body: { avatarUrl: 'https://example.com/me.jpg' } }));
    const body = await res.json();
    expect(body.data.name).toBe('Ada Owner');
    expect(body.data.email).toBe('avatar-scope@example.com');
    expect(body.data.role).toBe('OWNER');
  });
});
