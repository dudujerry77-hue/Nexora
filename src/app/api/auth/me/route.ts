import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { ok, fail } from '@/lib/apiResponse';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user, member } = await requireSession(req);

    const organization = member
      ? await prisma.organization.findUnique({ where: { id: member.organizationId } })
      : null;

    return ok({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: organization ? { id: organization.id, name: organization.name } : null,
      memberRole: member?.role ?? null,
    });
  } catch (error) {
    return fail(error);
  }
}
