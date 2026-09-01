import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, requireSuperAdmin } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    requireSuperAdmin(session);

    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return ok(users);
  } catch (error) {
    return fail(error);
  }
}
