import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword, signSessionToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { setSessionCookies } from '@/lib/sessionCookies';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { consume } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local';
    const rl = consume(`login:${ip}`, 20, 60_000);
    if (!rl.allowed) throw new ApiError('rate_limited', 'Too many login attempts. Try again shortly.');

    const body = loginSchema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Deliberately identical error for "no such user" and "wrong password"
    // so login can't be used to enumerate registered emails.
    const invalidCredentials = () => new ApiError('unauthorized', 'Invalid email or password.');
    if (!user) throw invalidCredentials();

    const validPassword = await verifyPassword(body.password, user.passwordHash);
    if (!validPassword) throw invalidCredentials();

    const member =
      user.role === 'SUPER_ADMIN'
        ? null
        : await prisma.member.findFirst({ where: { userId: user.id, status: 'active' } });

    await writeAuditLog({
      organizationId: member?.organizationId ?? null,
      actorUserId: user.id,
      action: 'user.logged_in',
      targetType: 'User',
      targetId: user.id,
    });

    const token = signSessionToken({ sub: user.id, role: user.role });
    const response = ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    setSessionCookies(response, token);
    return response;
  } catch (error) {
    return fail(error);
  }
}
