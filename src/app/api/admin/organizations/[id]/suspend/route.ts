import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, requireSuperAdmin } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit';

// Suspends every member of an organization at once — an org has no
// standalone "suspended" flag in the MVP schema, so suspension is modeled
// as flipping every Member row's status, which requireSession() already
// treats as "no active membership" (403) on every subsequent request.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession(req);
    requireSuperAdmin(session);

    const organization = await prisma.organization.findUnique({ where: { id: params.id } });
    if (!organization) throw new ApiError('not_found', 'Organization not found.');

    await prisma.member.updateMany({ where: { organizationId: organization.id }, data: { status: 'suspended' } });

    await writeAuditLog({
      organizationId: organization.id,
      actorUserId: session.user.id,
      action: 'organization.suspended',
      targetType: 'Organization',
      targetId: organization.id,
    });

    return ok({ suspended: true });
  } catch (error) {
    return fail(error);
  }
}
