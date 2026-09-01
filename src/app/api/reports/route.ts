import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, assertStoreAccess } from '@/lib/authz';
import { createReportSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { writeAuditLog } from '@/lib/audit';
import { toJson, fromJson } from '@/lib/json';
import type { Prisma } from '@prisma/client';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

type ReportWithRelations = Prisma.ReportGetPayload<{
  include: { author: { select: { name: true; email: true } }; store: { select: { id: true; name: true } } };
}>;

function serializeReport(r: ReportWithRelations) {
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    title: r.title,
    description: r.description,
    stepsToReproduce: r.stepsToReproduce,
    expectedBehavior: r.expectedBehavior,
    actualBehavior: r.actualBehavior,
    severity: r.severity,
    status: r.status,
    screenshotUrl: r.screenshotUrl,
    diagnostics: fromJson<Record<string, unknown>>(r.diagnostics, {}),
    store: r.store,
    author: r.author,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const REPORT_INCLUDE = {
  author: { select: { name: true, email: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.ReportInclude;

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') ?? undefined;

    const reports = await prisma.report.findMany({
      where: { organizationId: member.organizationId, ...(type ? { type } : {}) },
      include: REPORT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return ok(reports.map(serializeReport));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, member } = await requireSession(req);
    const body = createReportSchema.parse(await req.json());

    if (body.storeId) {
      // Confirms the store belongs to the caller's own organization —
      // same isolation guarantee as every other store-scoped write.
      await assertStoreAccess({ member, storeId: body.storeId });
    }

    const report = await prisma.report.create({
      data: {
        organizationId: member.organizationId,
        storeId: body.storeId ?? null,
        authorUserId: user.id,
        type: body.type,
        category: body.category,
        title: body.title,
        description: body.description,
        stepsToReproduce: body.stepsToReproduce,
        expectedBehavior: body.expectedBehavior,
        actualBehavior: body.actualBehavior,
        severity: body.severity,
        screenshotUrl: body.screenshotUrl,
        diagnostics: toJson(body.diagnostics ?? {}),
      },
      include: REPORT_INCLUDE,
    });

    await writeAuditLog({
      organizationId: member.organizationId,
      actorUserId: user.id,
      action: 'report.created',
      targetType: 'Report',
      targetId: report.id,
      metadata: { type: body.type, category: body.category, storeId: body.storeId ?? null },
    });

    return ok(serializeReport(report), 201);
  } catch (error) {
    return fail(error);
  }
}
