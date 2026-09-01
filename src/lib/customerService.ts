import { prisma } from './db';

export async function upsertCustomer(
  storeId: string,
  data: { id: string; name: string; email?: string; phone?: string },
) {
  return prisma.customer.upsert({
    where: { storeId_externalId: { storeId, externalId: data.id } },
    create: { storeId, externalId: data.id, name: data.name, email: data.email, phone: data.phone },
    update: { name: data.name, email: data.email, phone: data.phone },
  });
}
