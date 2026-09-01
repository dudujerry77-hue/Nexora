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

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { actor: { select: { name: true, email: true } }, organization: { select: { name: true } } },
    });

    return ok(logs);
  } catch (error) {
    return fail(error);
  }
}
