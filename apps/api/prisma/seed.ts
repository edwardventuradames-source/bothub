import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BCRYPT_SALT_ROUNDS = 12;
const GENERATED_PASSWORD_BYTES = 12;

async function runSeed(): Promise<void> {
  const orgName = process.env.INITIAL_ORG_NAME || 'BotHub Enterprise';
  const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || 'admin@bothub.local').toLowerCase();
  const adminName = process.env.INITIAL_ADMIN_NAME || 'Admin BotHub';
  const configuredPassword =
    process.env.INITIAL_ADMIN_PASSWORD ||
    crypto.randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url');

  const organization = await prisma.organization.upsert({
    where: { slug: 'bothub-enterprise' },
    update: { name: orgName },
    create: {
      name: orgName,
      slug: 'bothub-enterprise'
    }
  });

  const passwordHash = await bcrypt.hash(configuredPassword, BCRYPT_SALT_ROUNDS);

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

  const existingBotsCount = await prisma.bot.count({
    where: { organizationId: organization.id }
  });

  if (existingBotsCount === 0) {
    const sampleBot = await prisma.bot.create({
      data: {
        organizationId: organization.id,
        name: 'Soporte Grúas 24/7',
        description: 'Bot principal de asistencia vial con menú interactivo y transferencia a Chatwoot.',
        driver: 'BAILEYS',
        status: 'CONNECTED',
        phoneNumber: '+58 412-5550199',
        isActive: true,
        inactivityTimeoutMinutes: 15,
        inactivityCloseMessage: 'Cerramos esta sesión por inactividad. Escríbenos nuevamente cuando lo necesites.',
        typingDelayMs: 1200,
        rateLimitPerMinute: 30
      }
    });

    const sampleNodes = [
      {
        id: 'node-trigger-1',
        type: 'TRIGGER',
        position: { x: 60, y: 160 },
        data: { label: 'Inicio / Menú', matchMode: 'FIRST_MESSAGE', keywords: ['hola', 'menu'] }
      },
      {
        id: 'node-msg-1',
        type: 'MESSAGE',
        position: { x: 280, y: 160 },
        data: { label: 'Bienvenida', text: '¡Hola {{nombre}}! Bienvenido a Soporte Grúas 24/7.' }
      },
      {
        id: 'node-btn-1',
        type: 'BUTTONS',
        position: { x: 500, y: 160 },
        data: {
          label: 'Menú Principal',
          text: 'Selecciona una opción:',
          buttons: [
            { id: 'btn-grua', title: 'Solicitar Grúa' },
            { id: 'btn-agente', title: 'Hablar con Agente' }
          ]
        }
      },
      {
        id: 'node-q-1',
        type: 'QUESTION',
        position: { x: 740, y: 100 },
        data: {
          label: 'Captura Cédula',
          prompt: 'Por favor ingresa tu número de cédula:',
          variableName: 'cedula',
          validationType: 'NATIONAL_ID'
        }
      },
      {
        id: 'node-cond-1',
        type: 'CONDITION',
        position: { x: 980, y: 160 },
        data: {
          label: 'Validar Horario',
          variable: 'en_horario',
          operator: 'EQUALS',
          value: 'true'
        }
      },
      {
        id: 'node-handoff-1',
        type: 'HANDOFF',
        position: { x: 1220, y: 160 },
        data: {
          label: 'Transferir a Agente',
          teamId: 1,
          privateNoteTemplate: 'Cliente {{nombre}} ({{telefono}}) solicita asistencia. Cédula: {{cedula}}'
        }
      }
    ];

    const sampleEdges = [
      { id: 'e1-2', source: 'node-trigger-1', target: 'node-msg-1' },
      { id: 'e2-3', source: 'node-msg-1', target: 'node-btn-1' },
      { id: 'e3-4', source: 'node-btn-1', target: 'node-q-1' },
      { id: 'e4-5', source: 'node-q-1', target: 'node-cond-1' },
      { id: 'e5-6', source: 'node-cond-1', target: 'node-handoff-1' }
    ];

    await prisma.flow.create({
      data: {
        botId: sampleBot.id,
        name: 'Menú Principal de Asistencia',
        description: 'Flujo inicial de bienvenida, captura de cédula y derivación a operador.',
        triggerMode: 'MAIN_MENU',
        triggerKeywords: ['hola', 'menu', 'ayuda'],
        isMainMenu: true,
        isActive: true,
        draftNodes: sampleNodes,
        draftEdges: sampleEdges,
        publishedNodes: sampleNodes,
        publishedEdges: sampleEdges,
        publishedVersion: 1
      }
    });
  }
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
