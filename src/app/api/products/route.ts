import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireSession, requireApiKey, getAccessibleStoreIds, assertStoreAccess } from '@/lib/authz';
import { createProductSchema } from '@/lib/validation';
import { ok, fail } from '@/lib/apiResponse';
import { ApiError } from '@/lib/errors';
import { consume } from '@/lib/rateLimit';
import { toJson } from '@/lib/json';
import { serializeProduct, assertNexoraManagedProducts } from '@/lib/productService';
import { assertRequestSizeWithin } from '@/lib/requestLimits';

// These routes read the session cookie, so they can never be statically
// generated — declare that explicitly to avoid Next's build-time
// "Dynamic server usage" warning noise.
export const dynamic = 'force-dynamic';

// Up to 8 images at ~2MB (base64) each, plus other fields — capped well
// above any legitimate request but far below "unbounded".
const MAX_PRODUCT_BODY_BYTES = 20_000_000;

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      // Lets a developer's own storefront pull Nexora-managed product data
      // back out (the "Nexora-managed -> product data -> developer
      // integration" direction) — a `read`-scoped key (public or secret)
      // is enough, the same as the SDK's other read-only endpoints, since
      // a product catalog (name/price/images/stock) is customer-facing
      // data, not privileged like orders/customers. Always scoped to the
      // key's own store — a key can never see another store's catalog.
      const apiKeyCtx = await requireApiKey(req, 'read');
      const rl = consume(`products:read:${apiKeyCtx.apiKeyId}`, 120, 60_000);
      if (!rl.allowed) throw new ApiError('rate_limited', 'API key rate limit exceeded.');

      const products = await prisma.product.findMany({
        where: { storeId: apiKeyCtx.storeId },
        include: { inventory: true, variants: true },
        orderBy: { createdAt: 'desc' },
      });
      return ok(products.map(serializeProduct));
    }

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
    assertRequestSizeWithin(req, MAX_PRODUCT_BODY_BYTES);
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      // API-key push is the sync channel for developer-owned stores (and
      // remains available for nexora_managed stores too) — it must keep
      // working regardless of productMode, so no assertNexoraManagedProducts
      // check here. Only the session/dashboard path below is restricted.
      const apiKeyCtx = await requireApiKey(req, 'products:write');
      const rl = consume(`products:write:${apiKeyCtx.apiKeyId}`, 60, 60_000);
      if (!rl.allowed) throw new ApiError('rate_limited', 'API key rate limit exceeded.');
      const body = createProductSchema.parse(await req.json());
      if (body.storeId !== apiKeyCtx.storeId) throw new ApiError('forbidden', 'API key not authorized for this store.');
      const product = await createProduct(apiKeyCtx.storeId, body);
      return ok(serializeProduct(product), 201);
    }

    const { member } = await requireSession(req);
    const body = createProductSchema.parse(await req.json());
    await assertStoreAccess({ member, storeId: body.storeId, permission: 'manage_products' });
    // Enforced here, not just hidden in the UI: a developer-owned store's
    // products may only change via the push-based sync path above.
    await assertNexoraManagedProducts(body.storeId);
    const product = await createProduct(body.storeId, body);
    return ok(serializeProduct(product), 201);
  } catch (error) {
    return fail(error);
  }
}
