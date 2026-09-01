import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/authz';
import { ApiError } from '@/lib/errors';
import { ok, fail } from '@/lib/apiResponse';
import { fromJson } from '@/lib/json';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);

    // Scoped to the caller's own organization — a report id belonging to a
    // different organization is treated identically to a non-existent one.
    const report = await prisma.report.findFirst({
      where: { id: params.id, organizationId: member.organizationId },
      include: {
        author: { select: { name: true, email: true } },
        store: { select: { id: true, name: true } },
      },
    });
    if (!report) throw new ApiError('not_found', 'Report not found.');

    return ok({
      id: report.id,
      type: report.type,
      category: report.category,
      title: report.title,
      description: report.description,
      stepsToReproduce: report.stepsToReproduce,
      expectedBehavior: report.expectedBehavior,
      actualBehavior: report.actualBehavior,
      severity: report.severity,
      status: report.status,
      screenshotUrl: report.screenshotUrl,
      diagnostics: fromJson<Record<string, unknown>>(report.diagnostics, {}),
      store: report.store,
      author: report.author,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    });
  } catch (error) {
    return fail(error);
  }
}
