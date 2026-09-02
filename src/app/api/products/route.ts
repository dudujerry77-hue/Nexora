import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, requireApiKey, getAccessibleStoreIds, assertStoreAccess } from '@/lib/authz';
import { createProductSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { consume } from '@/lib/rateLimit';
import { toJson } from '@/lib/json';
import { serializeProduct, assertStoreEligibleForProductCreation } from '@/lib/productService';
import { storeSummary } from '@/lib/storeService';

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
      include: { inventory: true, variants: true },
      orderBy: { createdAt: 'desc' },
    });

    return ok(products.map(serializeProduct));
  } catch (error) {
    return fail(error);
  }
}

async function createProduct(storeId: string, body: ReturnType<typeof createProductSchema.parse>) {
  try {
    const images = body.images ?? (body.imageUrl ? [body.imageUrl] : []);
    const product = await prisma.product.create({
      data: {
        storeId,
        sku: body.sku,
        name: body.name,
        description: body.description,
        price: body.price,
        currency: body.currency,
        imageUrl: images[0] ?? body.imageUrl,
        images: toJson(images),
        categories: toJson(body.categories ?? []),
        status: body.status,
        attributes: toJson(body.attributes ?? {}),
        inventory: {
          create: { storeId, quantity: body.quantity, lowStockThreshold: body.lowStockThreshold },
        },
        ...(body.variants && body.variants.length > 0
          ? { variants: { create: body.variants.map((v) => ({ name: v.name, sku: v.sku, price: v.price, quantity: v.quantity })) } }
          : {}),
      },
      include: { inventory: true, variants: true },
    });
    return product;
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
      // Same product-ownership + connected-store rule as the session path
      // below, now applied consistently regardless of auth method — see
      // assertStoreEligibleForProductCreation in src/lib/productService.ts
      // for why this doesn't affect the real developer-owned sync channel
      // (POST /api/webhooks/products), which stays ungated by either rule.
      const store = await prisma.store.findUniqueOrThrow({ where: { id: apiKeyCtx.storeId } });
      const { status } = await storeSummary(store.id);
      assertStoreEligibleForProductCreation(store, status);
      const product = await createProduct(apiKeyCtx.storeId, body);
      return ok(serializeProduct(product), 201);
    }

    const { member } = await requireSession(req);
    const body = createProductSchema.parse(await req.json());
    const store = await assertStoreAccess({ member, storeId: body.storeId, permission: 'manage_products' });
    const { status } = await storeSummary(store.id);
    assertStoreEligibleForProductCreation(store, status);
    const product = await createProduct(body.storeId, body);
    return ok(serializeProduct(product), 201);
  } catch (error) {
    return fail(error);
  }
}
