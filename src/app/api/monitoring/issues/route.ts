import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');
    const status = searchParams.get('status') ?? undefined;
    if (!storeId) throw new ApiError('validation_error', 'storeId is required.');

    await assertStoreAccess({ member, storeId, permission: 'view_monitoring' });

    const where: Prisma.MonitoringIssueWhereInput = {
      storeId,
      ...(status && status !== 'all' ? { status } : {}),
    };

    const issues = await prisma.monitoringIssue.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });

    return ok(issues);
  } catch (error) {
    return fail(error);
  }
}
