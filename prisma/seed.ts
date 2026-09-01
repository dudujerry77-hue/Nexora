// Standalone seed script (run via `npm run db:seed`, i.e. `tsx prisma/seed.ts`).
// Deliberately avoids the `@/` path alias and src/lib imports so it has no
// dependency on Next.js's module resolution — just Prisma + bcryptjs.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// tsx doesn't auto-load .env the way `next dev`/Prisma CLI do.
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const prisma = new PrismaClient();

function generateApiKey(): { fullKey: string; keyPrefix: string; keyHash: string } {
  const body = crypto.randomBytes(24).toString('base64url');
  const fullKey = `nx_live_${body}`;
  return { fullKey, keyPrefix: `nx_live_${body.slice(0, 4)}`, keyHash: crypto.createHash('sha256').update(fullKey).digest('hex') };
}

function encryptSecret(plaintext: string): string {
  const key = crypto.scryptSync(process.env.NEXORA_ENCRYPTION_KEY ?? 'dev-only-insecure-encryption-key-change-me', 'nexora-secret-store', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

async function main() {
  console.log('Seeding Nexora demo data...\n');

  const passwordHash = await bcrypt.hash('password123', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@nexora.dev' },
    update: {},
    create: { name: 'Nexora Admin', email: 'admin@nexora.dev', passwordHash, role: 'SUPER_ADMIN' },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.nexora.dev' },
    update: {},
    create: { name: 'Demo Owner', email: 'owner@demo.nexora.dev', passwordHash, role: 'OWNER' },
  });

  let organization = await prisma.organization.findFirst({ where: { ownerId: owner.id } });
  if (!organization) {
    organization = await prisma.organization.create({ data: { name: 'Demo Retail Group', ownerId: owner.id } });
    await prisma.member.create({ data: { userId: owner.id, organizationId: organization.id, role: 'OWNER', status: 'active' } });
  }

  const storeDefs = [
    { name: 'Iya Kudinka Restaurant', type: 'restaurant' },
    { name: 'Jeremiah Fashion', type: 'fashion' },
    { name: 'Tech Store', type: 'electronics' },
  ];

  for (const def of storeDefs) {
    let store = await prisma.store.findFirst({ where: { organizationId: organization.id, name: def.name } });
    if (!store) {
      store = await prisma.store.create({
        data: { organizationId: organization.id, name: def.name, type: def.type, status: 'connected', lastSyncAt: new Date() },
      });
    }

    const existingIntegration = await prisma.integration.findFirst({ where: { storeId: store.id, provider: 'custom_api' } });
    let apiKeyPlaintext = '(already seeded — rotate to get a fresh key)';
    if (!existingIntegration) {
      const integration = await prisma.integration.create({
        data: { storeId: store.id, provider: 'custom_api', status: 'connected', lastRequestAt: new Date() },
      });
      const key = generateApiKey();
      apiKeyPlaintext = key.fullKey;
      await prisma.apiKey.create({
        data: {
          storeId: store.id,
          integrationId: integration.id,
          name: 'Seed API key',
          keyPrefix: key.keyPrefix,
          keyHash: key.keyHash,
          scopes: JSON.stringify(['read', 'orders:write', 'products:write', 'inventory:write', 'customers:write']),
        },
      });
      await prisma.webhookEndpoint.create({ data: { storeId: store.id, secretCiphertext: encryptSecret(`whsec_seed_${store.id}`) } });
    }

    const sku = `${def.type.toUpperCase()}-001`;
    let product = await prisma.product.findFirst({ where: { storeId: store.id, sku } });
    if (!product) {
      product = await prisma.product.create({
        data: {
          storeId: store.id,
          sku,
          name: def.type === 'restaurant' ? 'Jollof Rice + Chicken' : def.type === 'fashion' ? 'Ankara Shirt' : 'Wireless Earbuds',
          price: def.type === 'restaurant' ? 3500 : def.type === 'fashion' ? 12000 : 25000,
          currency: 'NGN',
          inventory: { create: { storeId: store.id, quantity: 8, lowStockThreshold: 5 } },
        },
      });
    }

    const existingOrder = await prisma.order.findFirst({ where: { storeId: store.id, externalId: 'SEED-ORD-1' } });
    if (!existingOrder) {
      const customer = await prisma.customer.create({
        data: { storeId: store.id, externalId: 'seed-customer-1', name: 'Musa Ibrahim', phone: '+2348012345678' },
      });
      await prisma.order.create({
        data: {
          storeId: store.id,
          externalId: 'SEED-ORD-1',
          customerId: customer.id,
          customerName: customer.name,
          status: 'pending',
          total: product.price * 2,
          currency: 'NGN',
          items: { create: { productId: product.id, name: product.name, quantity: 2, price: product.price } },
        },
      });
      await prisma.notification.create({
        data: {
          organizationId: organization.id,
          storeId: store.id,
          type: 'order.created',
          title: 'New order received',
          body: `${store.name}: Order #SEED-ORD-1 from ${customer.name} — NGN ${(product.price * 2).toLocaleString()}`,
          severity: 'info',
        },
      });
    }

    console.log(`Store: ${store.name}`);
    console.log(`  API key: ${apiKeyPlaintext}`);
    console.log(`  Webhook URL: http://localhost:3000/api/webhooks/orders`);
  }

  console.log('\nLogins (password for all: password123):');
  console.log(`  Owner:       ${owner.email}`);
  console.log(`  Super admin: ${superAdmin.email}  (visit /nexora-admin)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
