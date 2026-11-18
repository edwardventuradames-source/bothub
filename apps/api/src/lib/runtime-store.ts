import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  ApiKeyDto,
  BotDto,
  BotLogDto,
  ContactDto,
  ConversationDto,
  DashboardMetricsDto,
  FlowDto,
  OrganizationUserDto,
  OutboundWebhookConfigDto
} from '@bothub/shared';
import {
  decryptSecret,
  encryptSecret,
  generateRandomOpaqueToken
} from './crypto.js';
import {
  createDefaultBusinessHours,
  createDefaultQuickReplies,
  createSalesFlowGraph,
  createSupportFlowGraph
} from './runtime-seed-graphs.js';

export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000100';
export const DEFAULT_ADMIN_ID = '00000000-0000-4000-8000-000000000001';

export interface StoredChatwootSecrets {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  encryptedApiAccessToken: string;
  encryptedWebhookToken: string;
  handoffReturnCommand: string;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export interface StoredCloudApiSecrets {
  phoneNumberId: string;
  wabaId: string;
  encryptedAccessToken: string;
  encryptedVerifyToken: string;
}

export interface StoredUserRecord extends OrganizationUserDto {
  organizationId: string;
  organizationName: string;
  passwordHash: string;
}

export function maskSecretValue(secret: string): string {
  if (secret.length <= 8) {
    return '••••••••';
  }
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

class RuntimeStore {
  public users: StoredUserRecord[] = [];
  public bots: BotDto[] = [];
  public chatwootSecrets = new Map<string, StoredChatwootSecrets>();
  public cloudApiSecrets = new Map<string, StoredCloudApiSecrets>();
  public flows: FlowDto[] = [];
  public conversations: ConversationDto[] = [];
  public contacts: ContactDto[] = [];
  public logs: BotLogDto[] = [];
  public apiKeys: ApiKeyDto[] = [];
  public outboundWebhooks: OutboundWebhookConfigDto[] = [];

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData(): void {
    const nowIso = new Date().toISOString();
    const initialSeedSecret =
      process.env.INITIAL_ADMIN_PASSWORD || generateRandomOpaqueToken(16);
    const adminPasswordHash = bcrypt.hashSync(initialSeedSecret, 10);

    this.users = [
      {
        id: DEFAULT_ADMIN_ID,
        organizationId: DEFAULT_ORG_ID,
        organizationName: 'BotHub Enterprise',
        name: 'Admin BotHub',
        email: 'admin@bothub.local',
        role: 'ADMIN',
        isActive: true,
        lastLoginAt: nowIso,
        createdAt: nowIso,
        passwordHash: adminPasswordHash
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        organizationId: DEFAULT_ORG_ID,
        organizationName: 'BotHub Enterprise',
        name: 'Laura Gómez · Operaciones',
        email: 'operador@bothub.local',
        role: 'OPERATOR',
        isActive: true,
        lastLoginAt: nowIso,
        createdAt: nowIso,
        passwordHash: adminPasswordHash
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        organizationId: DEFAULT_ORG_ID,
        organizationName: 'BotHub Enterprise',
        name: 'Carlos Ruiz · Auditoría',
        email: 'lector@bothub.local',
        role: 'VIEWER',
        isActive: true,
        lastLoginAt: null,
        createdAt: nowIso,
        passwordHash: adminPasswordHash
      }
    ];

    const salesGraph = createSalesFlowGraph();
    const supportGraph = createSupportFlowGraph();

    const flowSalesId = 'flow-main-sales-001';
    const flowSupportId = 'flow-tech-support-002';

    const botSalesId = 'bot-ventas-principal';
    const botSupportId = 'bot-soporte-n1';
    const botBillingId = 'bot-cobranzas-qr';

    this.flows = [
      {
        id: flowSalesId,
        organizationId: DEFAULT_ORG_ID,
        name: 'Flujo Principal · Atención & Ventas IA',
        description:
          'Captura documento con validación, muestra menú interactivo, consulta pedidos por HTTP, responde con IA y transfiere a Chatwoot.',
        botId: botSalesId,
        botName: 'Bot Ventas Principal',
        isMainMenu: true,
        activeVersionNumber: 3,
        draftVersion: {
          id: 'fv-sales-3',
          versionNumber: 3,
          status: 'PUBLISHED',
          nodes: salesGraph.nodes,
          edges: salesGraph.edges,
          publishedAt: nowIso,
          createdAt: nowIso
        },
        publishedVersion: {
          id: 'fv-sales-3',
          versionNumber: 3,
          status: 'PUBLISHED',
          nodes: salesGraph.nodes,
          edges: salesGraph.edges,
          publishedAt: nowIso,
          createdAt: nowIso
        },
        createdAt: nowIso,
        updatedAt: nowIso
      },
      {
        id: flowSupportId,
        organizationId: DEFAULT_ORG_ID,
        name: 'Soporte Técnico & Diagnóstico N1',
        description:
          'Clasifica tickets mediante lista interactiva, evalúa condición de criticidad y escala casos urgentes a Ingeniería en Chatwoot.',
        botId: botSupportId,
        botName: 'Soporte Técnico N1',
        isMainMenu: true,
        activeVersionNumber: 2,
        draftVersion: {
          id: 'fv-sup-2',
          versionNumber: 2,
          status: 'PUBLISHED',
          nodes: supportGraph.nodes,
          edges: supportGraph.edges,
          publishedAt: nowIso,
          createdAt: nowIso
        },
        publishedVersion: {
          id: 'fv-sup-2',
          versionNumber: 2,
          status: 'PUBLISHED',
          nodes: supportGraph.nodes,
          edges: supportGraph.edges,
          publishedAt: nowIso,
          createdAt: nowIso
        },
        createdAt: nowIso,
        updatedAt: nowIso
      }
    ];

    this.saveChatwootConfigForBot(botSalesId, {
      baseUrl: 'https://chat.bothub.local',
      accountId: 1,
      inboxId: 12,
      apiAccessToken: generateRandomOpaqueToken(16),
      webhookToken: 'wh_sec_bothub_ventas_2026',
      handoffReturnCommand: '#bot',
      isActive: true
    });

    this.saveChatwootConfigForBot(botSupportId, {
      baseUrl: 'https://chat.bothub.local',
      accountId: 1,
      inboxId: 15,
      apiAccessToken: generateRandomOpaqueToken(16),
      webhookToken: 'wh_sec_bothub_soporte_2026',
      handoffReturnCommand: '#bot',
      isActive: true
    });

    this.saveCloudApiConfigForBot(botSupportId, {
      phoneNumberId: '109283746511223',
      wabaId: '998877665544332',
      accessToken: generateRandomOpaqueToken(20),
      verifyToken: 'meta_verify_bothub_2026'
    });

    this.bots = [
      {
        id: botSalesId,
        organizationId: DEFAULT_ORG_ID,
        name: 'Bot Ventas Principal',
        description:
          'Atención comercial 24/7, calificación de leads y handoff a ejecutivos en Chatwoot.',
        phoneNumber: '+57 300 412 8890',
        driver: 'BAILEYS',
        status: 'CONNECTED',
        isActive: true,
        activeFlowId: flowSalesId,
        activeFlowName: 'Flujo Principal · Atención & Ventas IA',
        timezone: 'America/Bogota',
        outOfHoursMessage:
          'Hola 👋 Estamos fuera de horario comercial. Déjanos tus datos y te contactaremos a primera hora.',
        inactivityTimeoutMinutes: 15,
        inactivityCloseMessage:
          'Cerramos esta sesión por inactividad. Escribe "hola" cuando desees retomar.',
        typingDelayMs: 1100,
        rateLimitPerMinute: 45,
        messagesToday: 1842,
        activeConversations: 38,
        handoffRate: 14.5,
        qrCodeData: null,
        qrExpiresAt: null,
        lastConnectedAt: nowIso,
        chatwootConfig: this.getChatwootConfigDto(botSalesId),
        cloudApiConfig: null,
        businessHours: createDefaultBusinessHours(),
        quickReplies: createDefaultQuickReplies(),
        createdAt: nowIso,
        updatedAt: nowIso
      },
      {
        id: botSupportId,
        organizationId: DEFAULT_ORG_ID,
        name: 'Soporte Técnico N1',
        description:
          'Canal oficial WhatsApp Cloud API con triaje automático y escalamiento a ingeniería.',
        phoneNumber: '+57 310 998 1120',
        driver: 'CLOUD_API',
        status: 'CONNECTED',
        isActive: true,
        activeFlowId: flowSupportId,
        activeFlowName: 'Soporte Técnico & Diagnóstico N1',
        timezone: 'America/Bogota',
        outOfHoursMessage: 'Nuestro equipo N1 atiende 24/7 para emergencias.',
        inactivityTimeoutMinutes: 20,
        inactivityCloseMessage: 'Tu consulta técnica fue cerrada por inactividad.',
        typingDelayMs: 900,
        rateLimitPerMinute: 60,
        messagesToday: 1290,
        activeConversations: 24,
        handoffRate: 21.0,
        qrCodeData: null,
        qrExpiresAt: null,
        lastConnectedAt: nowIso,
        chatwootConfig: this.getChatwootConfigDto(botSupportId),
        cloudApiConfig: this.getCloudApiConfigDto(botSupportId),
        businessHours: createDefaultBusinessHours(),
        quickReplies: createDefaultQuickReplies(),
        createdAt: nowIso,
        updatedAt: nowIso
      },
      {
        id: botBillingId,
        organizationId: DEFAULT_ORG_ID,
        name: 'Cobranzas & Facturación',
        description:
          'Envío de estados de cuenta, validación de cédula y acuerdos de pago vía Baileys QR.',
        phoneNumber: '+57 315 204 7711',
        driver: 'BAILEYS',
        status: 'WAITING_QR',
        isActive: true,
        activeFlowId: flowSalesId,
        activeFlowName: 'Flujo Principal · Atención & Ventas IA',
        timezone: 'America/Bogota',
        outOfHoursMessage:
          'Área de facturación disponible de lunes a viernes 8am - 6pm.',
        inactivityTimeoutMinutes: 10,
        inactivityCloseMessage: 'Sesión de facturación finalizada.',
        typingDelayMs: 1200,
        rateLimitPerMinute: 30,
        messagesToday: 410,
        activeConversations: 5,
        handoffRate: 9.2,
        qrCodeData: 'BOTHUB-QR-SESSION://bot-cobranzas-qr/session-live',
        qrExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastConnectedAt: null,
        chatwootConfig: null,
        cloudApiConfig: null,
        businessHours: createDefaultBusinessHours(),
        quickReplies: createDefaultQuickReplies(),
        createdAt: nowIso,
        updatedAt: nowIso
      }
    ];

    this.contacts = [
      {
        id: 'contact-001',
        organizationId: DEFAULT_ORG_ID,
        name: 'Mariana Torres',
        phoneNumber: '+57 301 554 9021',
        email: 'mariana.torres@empresa.co',
        nationalId: '1020458912',
        chatwootContactId: 4012,
        tags: ['lead-calificado', 'plan-enterprise', 'requiere-agente'],
        variables: {
          nombre: 'Mariana Torres',
          telefono: '+57 301 554 9021',
          cedula: '1020458912',
          empresa: 'Logística Andina SAS',
          interes: 'Plan Enterprise 10 Bots'
        },
        conversationsCount: 3,
        lastInteractionAt: nowIso,
        createdAt: nowIso
      },
      {
        id: 'contact-002',
        organizationId: DEFAULT_ORG_ID,
        name: 'Andrés Felipe Castro',
        phoneNumber: '+57 314 882 3310',
        email: 'acastro@retailcol.com',
        nationalId: '80192834',
        chatwootContactId: 4018,
        tags: ['cliente-activo', 'soporte-n1'],
        variables: {
          nombre: 'Andrés Felipe Castro',
          telefono: '+57 314 882 3310',
          cedula: '80192834',
          estado_pedido: 'ORD-9941 · En reparto urbano'
        },
        conversationsCount: 2,
        lastInteractionAt: nowIso,
        createdAt: nowIso
      },
      {
        id: 'contact-003',
        organizationId: DEFAULT_ORG_ID,
        name: 'Camila Restrepo',
        phoneNumber: '+52 55 4190 8821',
        email: 'camila@fintechmx.io',
        nationalId: '1098765432',
        chatwootContactId: 4025,
        tags: ['cotizacion-ia', 'mexico'],
        variables: {
          nombre: 'Camila Restrepo',
          telefono: '+52 55 4190 8821',
          cedula: '1098765432',
          respuesta_ia: 'Recomendado Plan Multi-Agente con Cloud API oficial.'
        },
        conversationsCount: 1,
        lastInteractionAt: nowIso,
        createdAt: nowIso
      }
    ];

    this.conversations = [
      {
        id: 'conv-001',
        botId: botSalesId,
        botName: 'Bot Ventas Principal',
        contactId: 'contact-001',
        contactName: 'Mariana Torres',
        contactPhone: '+57 301 554 9021',
        chatwootConversationId: 8841,
        status: 'PENDING_AGENT',
        assignedAgentName: 'Laura Gómez · Operaciones',
        currentFlowName: 'Flujo Principal · Atención & Ventas IA',
        currentNodeId: 'node-handoff-cw',
        collectedVariables: {
          nombre: 'Mariana Torres',
          telefono: '+57 301 554 9021',
          cedula: '1020458912',
          ultimo_mensaje: '3. Hablar con Asesor'
        },
        tags: ['lead-calificado', 'requiere-agente'],
        handoffReason: 'Solicitó asesor comercial tras validar documento 1020458912.',
        lastMessagePreview: 'Te estamos transfiriendo con un especialista en Chatwoot...',
        lastActivityAt: nowIso,
        messages: [
          {
            id: 'm-1',
            senderType: 'CONTACT',
            senderName: 'Mariana Torres',
            content: 'Hola, quiero información para conectar 5 números de WhatsApp a Chatwoot',
            executedNodeId: 'node-trigger-1',
            executedNodeLabel: 'Inicio / Palabra Clave',
            createdAt: new Date(Date.now() - 240_000).toISOString()
          },
          {
            id: 'm-2',
            senderType: 'BOT',
            senderName: 'Bot Ventas Principal',
            content:
              '¡Hola Mariana Torres! 👋 Bienvenido a *BotHub Enterprise*. Por favor escribe tu número de documento o cédula:',
            executedNodeId: 'node-q-cedula',
            executedNodeLabel: 'Capturar Cédula / NIT',
            createdAt: new Date(Date.now() - 230_000).toISOString()
          },
          {
            id: 'm-3',
            senderType: 'CONTACT',
            senderName: 'Mariana Torres',
            content: '1020458912',
            executedNodeId: 'node-q-cedula',
            executedNodeLabel: 'Validación Cédula OK',
            createdAt: new Date(Date.now() - 180_000).toISOString()
          },
          {
            id: 'm-4',
            senderType: 'BOT',
            senderName: 'Bot Ventas Principal',
            content:
              'Gracias Mariana Torres (Doc: 1020458912). ¿En qué podemos ayudarte hoy?\n[1. Cotizar Plan] [2. Consultar Pedido] [3. Hablar con Asesor]',
            executedNodeId: 'node-buttons-menu',
            executedNodeLabel: 'Menú Principal Interactivo',
            createdAt: new Date(Date.now() - 175_000).toISOString()
          },
          {
            id: 'm-5',
            senderType: 'CONTACT',
            senderName: 'Mariana Torres',
            content: '3. Hablar con Asesor',
            executedNodeId: 'node-tag-vip',
            executedNodeLabel: 'Etiquetar Lead Prioritario',
            createdAt: new Date(Date.now() - 90_000).toISOString()
          },
          {
            id: 'm-6',
            senderType: 'SYSTEM',
            senderName: 'Chatwoot Handoff Engine',
            content:
              '🔒 Nota privada enviada a Chatwoot (#8841): Handoff solicitado por Mariana Torres (Cédula: 1020458912). Estado cambiado a OPEN.',
            executedNodeId: 'node-handoff-cw',
            executedNodeLabel: 'Transferir a Chatwoot',
            createdAt: new Date(Date.now() - 85_000).toISOString()
          }
        ],
        executionTrace: [
          {
            nodeId: 'node-trigger-1',
            nodeType: 'TRIGGER',
            title: 'Inicio / Palabra Clave',
            detail: 'Activado por primer mensaje entrante',
            timestamp: new Date(Date.now() - 240_000).toISOString()
          },
          {
            nodeId: 'node-q-cedula',
            nodeType: 'QUESTION',
            title: 'Capturar Cédula / NIT',
            detail: 'Variable {{cedula}} = "1020458912" validada como NATIONAL_ID',
            timestamp: new Date(Date.now() - 180_000).toISOString()
          },
          {
            nodeId: 'node-tag-vip',
            nodeType: 'ASSIGN_TAG',
            title: 'Etiquetar Lead Prioritario',
            detail: 'Etiquetas agregadas: lead-calificado, requiere-agente',
            timestamp: new Date(Date.now() - 90_000).toISOString()
          },
          {
            nodeId: 'node-handoff-cw',
            nodeType: 'HANDOFF',
            title: 'Transferir a Chatwoot',
            detail: 'Conversación #8841 transferida a equipo Ventas & Onboarding',
            timestamp: new Date(Date.now() - 85_000).toISOString()
          }
        ]
      },
      {
        id: 'conv-002',
        botId: botSupportId,
        botName: 'Soporte Técnico N1',
        contactId: 'contact-002',
        contactName: 'Andrés Felipe Castro',
        contactPhone: '+57 314 882 3310',
        chatwootConversationId: 8849,
        status: 'BOT_ACTIVE',
        assignedAgentName: null,
        currentFlowName: 'Flujo Principal · Atención & Ventas IA',
        currentNodeId: 'node-http-order',
        collectedVariables: {
          nombre: 'Andrés Felipe Castro',
          telefono: '+57 314 882 3310',
          cedula: '80192834',
          estado_pedido: 'ORD-9941 · En reparto urbano'
        },
        tags: ['consulta-pedido', 'automatizado'],
        handoffReason: null,
        lastMessagePreview: 'Tu pedido ORD-9941 se encuentra en reparto urbano.',
        lastActivityAt: nowIso,
        messages: [
          {
            id: 'm-201',
            senderType: 'CONTACT',
            senderName: 'Andrés Felipe Castro',
            content: '2. Consultar Pedido',
            executedNodeId: 'node-buttons-menu',
            executedNodeLabel: 'Menú Principal Interactivo',
            createdAt: new Date(Date.now() - 120_000).toISOString()
          },
          {
            id: 'm-202',
            senderType: 'BOT',
            senderName: 'Soporte Técnico N1',
            content:
              'Consultamos nuestro ERP para el documento 80192834: Tu pedido *ORD-9941* está en reparto urbano. ¡Gracias por comunicarte con BotHub!',
            executedNodeId: 'node-http-order',
            executedNodeLabel: 'Consultar ERP / Pedido',
            createdAt: new Date(Date.now() - 115_000).toISOString()
          }
        ],
        executionTrace: [
          {
            nodeId: 'node-http-order',
            nodeType: 'HTTP_REQUEST',
            title: 'Consultar ERP / Pedido',
            detail: 'GET https://api.bothub.local/v1/orders?document=80192834 -> 200 OK',
            timestamp: new Date(Date.now() - 115_000).toISOString()
          }
        ]
      }
    ];

    this.logs = [
      {
        id: 'log-1',
        botId: botSalesId,
        botName: 'Bot Ventas Principal',
        level: 'INFO',
        event: 'chatwoot.handoff.completed',
        message:
          'Conversación #8841 transferida a agente en Chatwoot con nota privada de variables.',
        metadata: { conversationId: 'conv-001', chatwootId: 8841, cedula: '1020458912' },
        createdAt: nowIso
      },
      {
        id: 'log-2',
        botId: botSupportId,
        botName: 'Soporte Técnico N1',
        level: 'INFO',
        event: 'flow.http_request.success',
        message: 'Nodo HTTP_REQUEST ejecutado en 142ms para documento 80192834.',
        metadata: { nodeId: 'node-http-order', statusCode: 200 },
        createdAt: new Date(Date.now() - 60_000).toISOString()
      },
      {
        id: 'log-3',
        botId: botBillingId,
        botName: 'Cobranzas & Facturación',
        level: 'WARN',
        event: 'whatsapp.baileys.qr_generated',
        message: 'Nuevo código QR generado para vinculación de dispositivo WhatsApp.',
        metadata: { driver: 'BAILEYS', expiresSeconds: 60 },
        createdAt: new Date(Date.now() - 120_000).toISOString()
      }
    ];

    this.apiKeys = [
      {
        id: 'ak-001',
        name: 'Integración ERP SAP / Webhooks',
        keyPrefix: 'bh_live_8f92a1',
        scopes: ['bots:read', 'flows:execute', 'webhooks:write'],
        lastUsedAt: nowIso,
        createdAt: nowIso
      }
    ];

    this.outboundWebhooks = [
      {
        id: 'wh-out-001',
        name: 'Notificador CRM Corporativo',
        targetUrl: 'https://crm.empresa.local/webhooks/bothub',
        events: ['conversation.handoff', 'contact.captured', 'bot.disconnected'],
        maskedSecret: 'whsec_••••91a2',
        isActive: true,
        createdAt: nowIso
      }
    ];
  }

  public saveChatwootConfigForBot(
    botId: string,
    input: {
      baseUrl: string;
      accountId: number;
      inboxId: number;
      apiAccessToken: string;
      webhookToken: string;
      handoffReturnCommand: string;
      isActive?: boolean;
    }
  ): void {
    const encryptedApiAccessToken = encryptSecret(input.apiAccessToken);
    const encryptedWebhookToken = encryptSecret(input.webhookToken);

    this.chatwootSecrets.set(botId, {
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      accountId: input.accountId,
      inboxId: input.inboxId,
      encryptedApiAccessToken,
      encryptedWebhookToken,
      handoffReturnCommand: input.handoffReturnCommand || '#bot',
      isActive: input.isActive ?? true,
      lastSyncedAt: new Date().toISOString()
    });

    const bot = this.bots.find((item) => item.id === botId);
    if (bot) {
      bot.chatwootConfig = this.getChatwootConfigDto(botId);
      bot.updatedAt = new Date().toISOString();
    }
  }

  public getChatwootConfigDto(botId: string) {
    const stored = this.chatwootSecrets.get(botId);
    if (!stored) {
      return null;
    }
    const rawApiToken = decryptSecret(stored.encryptedApiAccessToken);
    const rawWebhookToken = decryptSecret(stored.encryptedWebhookToken);
    return {
      baseUrl: stored.baseUrl,
      accountId: stored.accountId,
      inboxId: stored.inboxId,
      hasApiAccessToken: rawApiToken.length > 0,
      maskedApiAccessToken: maskSecretValue(rawApiToken),
      webhookTokenPreview: maskSecretValue(rawWebhookToken),
      webhookEndpointPath: `/api/webhooks/chatwoot/${botId}`,
      handoffReturnCommand: stored.handoffReturnCommand,
      isActive: stored.isActive,
      lastSyncedAt: stored.lastSyncedAt
    };
  }

  public getDecryptedChatwootTokens(botId: string): {
    apiAccessToken: string;
    webhookToken: string;
    handoffReturnCommand: string;
  } | null {
    const stored = this.chatwootSecrets.get(botId);
    if (!stored) {
      return null;
    }
    return {
      apiAccessToken: decryptSecret(stored.encryptedApiAccessToken),
      webhookToken: decryptSecret(stored.encryptedWebhookToken),
      handoffReturnCommand: stored.handoffReturnCommand
    };
  }

  public saveCloudApiConfigForBot(
    botId: string,
    input: {
      phoneNumberId: string;
      wabaId: string;
      accessToken: string;
      verifyToken: string;
    }
  ): void {
    this.cloudApiSecrets.set(botId, {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      encryptedAccessToken: encryptSecret(input.accessToken),
      encryptedVerifyToken: encryptSecret(input.verifyToken)
    });

    const bot = this.bots.find((item) => item.id === botId);
    if (bot) {
      bot.cloudApiConfig = this.getCloudApiConfigDto(botId);
      bot.updatedAt = new Date().toISOString();
    }
  }

  public getCloudApiConfigDto(botId: string) {
    const stored = this.cloudApiSecrets.get(botId);
    if (!stored) {
      return null;
    }
    const rawAccessToken = decryptSecret(stored.encryptedAccessToken);
    const rawVerifyToken = decryptSecret(stored.encryptedVerifyToken);
    return {
      phoneNumberId: stored.phoneNumberId,
      wabaId: stored.wabaId,
      hasAccessToken: rawAccessToken.length > 0,
      maskedAccessToken: maskSecretValue(rawAccessToken),
      verifyTokenPreview: maskSecretValue(rawVerifyToken),
      webhookPath: `/api/webhooks/whatsapp-cloud/${botId}`
    };
  }

  public getDecryptedCloudVerifyToken(botId: string): string | null {
    const stored = this.cloudApiSecrets.get(botId);
    if (!stored) {
      return null;
    }
    return decryptSecret(stored.encryptedVerifyToken);
  }

  public appendLog(entry: {
    botId: string | null;
    botName?: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): BotLogDto {
    const bot = entry.botId ? this.bots.find((item) => item.id === entry.botId) : null;
    const logItem: BotLogDto = {
      id: `log-${crypto.randomUUID().slice(0, 8)}`,
      botId: entry.botId,
      botName: entry.botName ?? bot?.name ?? 'Sistema BotHub',
      level: entry.level,
      event: entry.event,
      message: entry.message,
      metadata: entry.metadata ?? {},
      createdAt: new Date().toISOString()
    };
    this.logs.unshift(logItem);
    if (this.logs.length > 200) {
      this.logs.pop();
    }
    return logItem;
  }

  public createApiKey(name: string, scopes: string[]): ApiKeyDto {
    const rawSecret = `bh_live_${generateRandomOpaqueToken(18)}`;
    const newKey: ApiKeyDto = {
      id: `ak-${crypto.randomUUID().slice(0, 8)}`,
      name,
      keyPrefix: rawSecret.slice(0, 14),
      scopes,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      rawKeyPreview: rawSecret
    };
    this.apiKeys.unshift(newKey);
    return newKey;
  }

  public getDashboardMetrics(): DashboardMetricsDto {
    const activeBots = this.bots.filter((bot) => bot.status === 'CONNECTED').length;
    const messagesToday = this.bots.reduce((sum, bot) => sum + bot.messagesToday, 0);
    const activeConversations = this.conversations.filter(
      (conv) => conv.status !== 'RESOLVED'
    ).length;
    const handoffCountToday = this.conversations.filter(
      (conv) => conv.status === 'PENDING_AGENT' || conv.status === 'AGENT_ACTIVE'
    ).length;

    return {
      activeBots,
      totalBots: this.bots.length,
      messagesToday,
      activeConversations,
      handoffCountToday,
      automationRatePercent: 86.4,
      hourlyMessages: [
        { label: '08:00', inbound: 120, outbound: 195 },
        { label: '10:00', inbound: 245, outbound: 410 },
        { label: '12:00', inbound: 310, outbound: 520 },
        { label: '14:00', inbound: 280, outbound: 460 },
        { label: '16:00', inbound: 390, outbound: 640 },
        { label: '18:00', inbound: 260, outbound: 430 }
      ],
      weeklyFlowPerformance: [
        { day: 'Lun', resolvedByBot: 420, transferredToAgent: 64 },
        { day: 'Mar', resolvedByBot: 485, transferredToAgent: 71 },
        { day: 'Mié', resolvedByBot: 530, transferredToAgent: 68 },
        { day: 'Jue', resolvedByBot: 590, transferredToAgent: 79 },
        { day: 'Vie', resolvedByBot: 640, transferredToAgent: 85 },
        { day: 'Sáb', resolvedByBot: 310, transferredToAgent: 39 },
        { day: 'Dom', resolvedByBot: 195, transferredToAgent: 21 }
      ],
      topTriggeredNodes: [
        {
          nodeTitle: 'Menú Principal Interactivo',
          flowName: 'Flujo Principal · Atención & Ventas IA',
          executions: 1420
        },
        {
          nodeTitle: 'Capturar Cédula / NIT',
          flowName: 'Flujo Principal · Atención & Ventas IA',
          executions: 1185
        },
        {
          nodeTitle: 'Consultar ERP / Pedido',
          flowName: 'Flujo Principal · Atención & Ventas IA',
          executions: 740
        },
        {
          nodeTitle: 'Transferir a Chatwoot',
          flowName: 'Flujo Principal · Atención & Ventas IA',
          executions: 215
        }
      ]
    };
  }
}

export const runtimeStore = new RuntimeStore();
