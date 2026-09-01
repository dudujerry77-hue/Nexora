import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, requireApiKey, getAccessibleStoreIds, assertStoreAccess } from '@/lib/authz';
import { createProductSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { consume } from '@/lib/rateLimit';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { member } = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId') ?? undefined;
    const search = searchParams.get('search') ?? undefined;

    if (storeId) await assertStoreAccess({ member, storeId, permission: 'view_products' });
    const storeIds = storeId ? [storeId] : await getAccessibleStoreIds(member, 'view_products');

    const where: Prisma.ProductWhereInput = {
      storeId: { in: storeIds },
      ...(search ? { name: { contains: search } } : {}),
    };

    const products = await prisma.product.findMany({
      where,
      include: { inventory: true },
      orderBy: { createdAt: 'desc' },
    });

    return ok(products);
  } catch (error) {
    return fail(error);
  }
}

async function createProduct(storeId: string, body: ReturnType<typeof createProductSchema.parse>) {
  try {
    return await prisma.product.create({
      data: {
        storeId,
        sku: body.sku,
        name: body.name,
        price: body.price,
        currency: body.currency,
        imageUrl: body.imageUrl,
        inventory: {
          create: { storeId, quantity: body.quantity, lowStockThreshold: body.lowStockThreshold },
        },
      },
      include: { inventory: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError('conflict', `Product with SKU ${body.sku} already exists for this store.`);
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const apiKeyCtx = await requireApiKey(req, 'products:write');
      const rl = consume(`products:write:${apiKeyCtx.apiKeyId}`, 60, 60_000);
      if (!rl.allowed) throw new ApiError('rate_limited', 'API key rate limit exceeded.');
      const body = createProductSchema.parse(await req.json());
      if (body.storeId !== apiKeyCtx.storeId) throw new ApiError('forbidden', 'API key not authorized for this store.');
      const product = await createProduct(apiKeyCtx.storeId, body);
      return ok(product, 201);
    }

    const { member } = await requireSession(req);
    const body = createProductSchema.parse(await req.json());
    await assertStoreAccess({ member, storeId: body.storeId, permission: 'manage_products' });
    const product = await createProduct(body.storeId, body);
    return ok(product, 201);
  } catch (error) {
    return fail(error);
  }
}
