import { NextRequest } from 'next/server';
import type { Member } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { updateMonitoringIssueSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { fromJson } from '@/lib/json';
import { eventBus } from '@/lib/events';

export const dynamic = 'force-dynamic';

async function loadAccessibleIssue(member: Member, id: string) {
  const issue = await prisma.monitoringIssue.findUnique({ where: { id } });
  if (!issue) throw new ApiError('not_found', 'Issue not found.');
  await assertStoreAccess({ member, storeId: issue.storeId, permission: 'view_monitoring' });
  return issue;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const issue = await loadAccessibleIssue(member, params.id);

    const events = await prisma.monitoringEvent.findMany({
      where: { issueId: issue.id },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });

    return ok({
      ...issue,
      events: events.map((e) => ({ ...e, diagnostics: fromJson<Record<string, unknown>>(e.diagnostics, {}) })),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const issue = await prisma.monitoringIssue.findUnique({ where: { id: params.id } });
    if (!issue) throw new ApiError('not_found', 'Issue not found.');
    await assertStoreAccess({ member, storeId: issue.storeId, permission: 'manage_monitoring' });

    const body = updateMonitoringIssueSchema.parse(await req.json());
    const updated = await prisma.monitoringIssue.update({ where: { id: issue.id }, data: { status: body.status } });

    eventBus.publish({
      type: 'monitoring.issue_updated',
      organizationId: issue.organizationId,
      payload: { id: issue.id, storeId: issue.storeId },
    });

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
