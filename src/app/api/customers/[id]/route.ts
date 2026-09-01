import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, getAccessibleStoreIds } from '@/lib/authz';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { member } = await requireSession(req);
    const storeIds = await getAccessibleStoreIds(member, 'view_customers');
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, storeId: { in: storeIds } },
      include: { orders: { orderBy: { createdAt: 'desc' } } },
    });
    if (!customer) throw new ApiError('not_found', 'Customer not found.');
    return ok(customer);
  } catch (error) {
    return fail(error);
  }
}
