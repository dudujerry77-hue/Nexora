import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const notification = await prisma.notification.findFirst({
      where: { id: params.id, organizationId: member.organizationId },
    });
    if (!notification) throw new ApiError('not_found', 'Notification not found.');

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
