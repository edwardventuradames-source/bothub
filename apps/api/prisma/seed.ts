import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BCRYPT_SALT_ROUNDS = 12;

async function runSeed(): Promise<void> {
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const orgName = process.env.INITIAL_ORG_NAME?.trim() || 'Mi Organización';
  const adminName = process.env.INITIAL_ADMIN_NAME?.trim() || 'Administrador';

  if (!adminEmail || !adminPassword) {
    return;
  }

  const organization = await prisma.organization.upsert({
    where: { slug: 'default-org' },
    update: { name: orgName },
    create: {
      name: orgName,
      slug: 'default-org'
    }
  });

  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      role: 'ADMIN',
      organizationId: organization.id
    },
    create: {
      email: adminEmail,
      name: adminName,
      passwordHash,
      role: 'ADMIN',
      organizationId: organization.id
    }
  });
}

runSeed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
