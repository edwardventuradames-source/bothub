import { provisionAdminAccountFromServer } from '../modules/auth/auth.service.js';
import { prisma } from '../lib/prisma.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = (args[0] || process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = args[1] || process.env.INITIAL_ADMIN_PASSWORD || '';
  const name = (args[2] || process.env.INITIAL_ADMIN_NAME || 'Administrador Principal').trim();
  const organizationName = (args[3] || process.env.INITIAL_ORG_NAME || 'Mi Empresa').trim();

  if (!email || !email.includes('@') || password.length < 8) {
    console.error(
      'Uso: npm run create-admin -- <correo> <password_min_8_chars> "[Nombre Completo]" "[Empresa]"'
    );
    process.exit(1);
  }

  const user = await provisionAdminAccountFromServer({
    email,
    password,
    name,
    organizationName
  });

  console.log('====================================================');
  console.log('USUARIO ADMINISTRADOR CREADO / ACTUALIZADO CON EXITO');
  console.log(`Correo:       ${user.email}`);
  console.log(`Nombre:       ${user.name}`);
  console.log(`Organizacion: ${user.organizationName}`);
  console.log(`Rol:          ${user.role}`);
  console.log('====================================================');

  await prisma.$disconnect().catch(() => undefined);
}

main().catch((error: unknown) => {
  console.error('Error al crear usuario administrador:', error);
  process.exit(1);
});
