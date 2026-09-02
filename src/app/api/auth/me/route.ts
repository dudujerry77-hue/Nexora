import { NextRequest } from 'next/server';
import { z } from 'zod';
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl },
      organization: organization ? { id: organization.id, name: organization.name } : null,
      memberRole: member?.role ?? null,
    });
  } catch (error) {
    return fail(error);
  }
}

// Same accepted shapes as a product image (http(s) URL or a small data:
// URL device upload) — see productImageSchema in src/lib/validation.ts.
// null explicitly clears it back to the initials avatar.
const updateMeSchema = z.object({
  avatarUrl: z
    .string()
    .max(1_500_000)
    .refine((v) => /^https?:\/\//.test(v) || /^data:image\//.test(v), {
      message: 'Profile picture must be an http(s) URL or an uploaded image (data URL).',
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await requireSession(req);
    const body = updateMeSchema.parse(await req.json());

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}) },
    });

    return ok({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, avatarUrl: updated.avatarUrl });
  } catch (error) {
    return fail(error);
  }
}
