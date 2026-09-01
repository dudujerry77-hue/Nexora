import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, signSessionToken } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { setSessionCookies } from '@/lib/sessionCookies';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';
import { consume } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local';
    const rl = consume(`register:${ip}`, 10, 60_000);
    if (!rl.allowed) throw new ApiError('rate_limited', 'Too many registration attempts.');

    const body = registerSchema.parse(await req.json());

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ApiError('conflict', 'An account with this email already exists.');

    const passwordHash = await hashPassword(body.password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: body.name, email: body.email, passwordHash, role: 'OWNER' },
      });
      const organization = await tx.organization.create({
        data: { name: body.orgName, ownerId: user.id },
      });
      await tx.member.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER', status: 'active' },
      });
      return { user, organization };
    });

    await writeAuditLog({
      organizationId: result.organization.id,
      actorUserId: result.user.id,
      action: 'user.registered',
      targetType: 'User',
      targetId: result.user.id,
    });

    const token = signSessionToken({ sub: result.user.id, role: result.user.role });
    const response = ok(
      {
        user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
        organization: { id: result.organization.id, name: result.organization.name },
      },
      201,
    );
    setSessionCookies(response, token);
    return response;
  } catch (error) {
    return fail(error);
  }
}
