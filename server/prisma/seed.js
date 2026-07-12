/**
 * PRODUCTION BOOTSTRAP — creates the first admin account only.
 * No demo data. Idempotent: if an admin already exists, it does nothing.
 *
 * Credentials come from env (ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD).
 * If ADMIN_PASSWORD is not set, a strong random password is generated and
 * printed ONCE — change it after first login (Account → Change password).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findFirst({ where: { role: 'admin', deletedAt: null } });
  if (existing) {
    console.log(`Admin already exists (${existing.email}) — nothing to do.`);
    return;
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@gethired.uk').toLowerCase();
  const fullName = process.env.ADMIN_NAME || 'Portal Administrator';
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');

  await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
    },
  });

  console.log('Admin account created:');
  console.log(`  Email:    ${email}`);
  if (generated) {
    console.log(`  Password: ${password}`);
    console.log('  ^ Generated once — sign in and change it immediately.');
  } else {
    console.log('  Password: (from ADMIN_PASSWORD env var)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
