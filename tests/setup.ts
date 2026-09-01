import path from 'path';
import { execSync } from 'child_process';

process.env.DATABASE_URL = `file:${path.resolve(__dirname, '../prisma/test.db')}`;
process.env.NEXORA_JWT_SECRET = 'test-only-secret';
process.env.NEXORA_ENCRYPTION_KEY = 'test-only-encryption-key';

execSync('npx prisma db push --skip-generate --accept-data-loss', {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'ignore',
});
