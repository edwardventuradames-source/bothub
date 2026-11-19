import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FlowEdge, FlowNode } from '@bothub/shared';
import { buildApp } from '../app.js';
import {
  executeFlowSimulationStep,
  interpolateFlowVariables,
  validateQuestionAnswer
} from '../modules/flows/flow.engine.js';
import { provisionAdminAccountFromServer } from '../modules/auth/auth.service.js';
import { runtimeStore } from '../lib/runtime-store.js';
import { ChatwootService } from '../modules/chatwoot/chatwoot.service.js';

function signMetaPayload(payload: unknown, appSecret: string): string {
  const raw = JSON.stringify(payload);
  return `sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`;
}

describe('Server-Side Admin Provisioning, Flow Engine & Webhooks', () => {
  it('provisions an admin from the server CLI, logs in with JWT, and blocks public registration (403)', async () => {
    const app = await buildApp();

    await provisionAdminAccountFromServer({
      email: 'soluciones@bytemv.com',
      password: 'StrongPassword2026!',
      name: 'Edward Garibaldi Ventura Adames',
      organizationName: 'Bytemv'
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'soluciones@bytemv.com',
        password: 'StrongPassword2026!'
      }
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json();
    expect(loginBody.accessToken).toBeDefined();
    expect(loginBody.user.email).toBe('soluciones@bytemv.com');
    expect(loginBody.user.role).toBe('ADMIN');

    const lockedRegisterRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Intruso',
        organizationName: 'Spam Org',
        email: 'spam@intruso.com',
        password: 'SpamPassword123!'
      }
    });
    expect(lockedRegisterRes.statusCode).toBe(403);
    expect(lockedRegisterRes.json().error).toBe('REGISTRATION_LOCKED');

    await app.close();
  });

  it('interpolates dynamic variables and validates NATIONAL_ID and EMAIL', () => {
    const rendered = interpolateFlowVariables(
      'Hola {{nombre}}, tu documento es {{cedula}}.',
      { nombre: 'Cliente', cedula: '1020458912' }
    );
    expect(rendered).toBe('Hola Cliente, tu documento es 1020458912.');

    expect(validateQuestionAnswer('abc', 'NATIONAL_ID').valid).toBe(false);
    expect(validateQuestionAnswer('1020458912', 'NATIONAL_ID').valid).toBe(true);
    expect(validateQuestionAnswer('correo@empresa.co', 'EMAIL').valid).toBe(true);
  });

  it('executes a flow graph from TRIGGER to QUESTION and validates cedula before strict BUTTONS and HANDOFF', async () => {
    const nodes: FlowNode[] = [
      {
        id: 'node-trigger-1',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
      },
      {
        id: 'node-msg-welcome',
        type: 'MESSAGE',
        position: { x: 100, y: 0 },
        data: { title: 'Bienvenida', text: 'Hola {{nombre}}' }
      },
      {
        id: 'node-q-cedula',
        type: 'QUESTION',
        position: { x: 200, y: 0 },
        data: {
          title: 'Capturar Cédula',
          promptText: 'Ingresa tu documento:',
          variableName: 'cedula',
          validationType: 'NATIONAL_ID',
          errorMessage: 'Cédula inválida.'
        }
      },
      {
        id: 'node-buttons-menu',
        type: 'BUTTONS',
        position: { x: 300, y: 0 },
        data: {
          title: 'Menú',
          bodyText: 'Elige una opción:',
          buttons: [
            { id: 'btn-ventas', label: '1. Ventas' },
            { id: 'btn-asesor', label: '2. Hablar con Asesor' }
          ]
        }
      },
      {
        id: 'node-end-ventas',
        type: 'END',
        position: { x: 400, y: -100 },
        data: { title: 'Fin Ventas', farewellMessage: 'Atendido en Ventas.' }
      },
      {
        id: 'node-tag-vip',
        type: 'ASSIGN_TAG',
        position: { x: 400, y: 0 },
        data: { title: 'Etiqueta', tags: ['lead-calificado'] }
      },
      {
        id: 'node-handoff-cw',
        type: 'HANDOFF',
        position: { x: 500, y: 0 },
        data: {
          title: 'Handoff',
          clientMessage: 'Transfiriendo a agente.',
          privateNoteTemplate: 'Cliente {{nombre}} ({{cedula}})'
        }
      }
    ];

    const edges: FlowEdge[] = [
      { id: 'e1', source: 'node-trigger-1', target: 'node-msg-welcome' },
      { id: 'e2', source: 'node-msg-welcome', target: 'node-q-cedula' },
      { id: 'e3', source: 'node-q-cedula', target: 'node-buttons-menu' },
      {
        id: 'e4-ventas',
        source: 'node-buttons-menu',
        target: 'node-end-ventas',
        sourceHandle: 'btn-ventas'
      },
      {
        id: 'e4-asesor',
        source: 'node-buttons-menu',
        target: 'node-tag-vip',
        sourceHandle: 'btn-asesor'
      },
      { id: 'e5', source: 'node-tag-vip', target: 'node-handoff-cw' }
    ];

    const firstTurn = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'hola',
      variables: { nombre: 'Cliente Test', telefono: '+573001112233' },
      tags: []
    });

    expect(firstTurn.replies.length).toBeGreaterThanOrEqual(2);
    expect(firstTurn.awaitingQuestionNodeId).toBe('node-q-cedula');

    const invalidTurn = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'no-es-cedula',
      currentNodeId: firstTurn.nextNodeId,
      awaitingQuestionNodeId: firstTurn.awaitingQuestionNodeId,
      variables: firstTurn.variables,
      tags: firstTurn.tags
    });
    expect(invalidTurn.awaitingQuestionNodeId).toBe('node-q-cedula');
    expect(invalidTurn.replies[0].text).toContain('⚠️');

    const validTurn = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: '1020458912',
      currentNodeId: invalidTurn.nextNodeId,
      awaitingQuestionNodeId: invalidTurn.awaitingQuestionNodeId,
      variables: invalidTurn.variables,
      tags: invalidTurn.tags
    });
    expect(validTurn.variables.cedula).toBe('1020458912');
    expect(validTurn.awaitingQuestionNodeId).toBe('node-buttons-menu');

    const ambiguousButtonTurn = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'a',
      currentNodeId: validTurn.nextNodeId,
      awaitingQuestionNodeId: validTurn.awaitingQuestionNodeId,
      variables: validTurn.variables,
      tags: validTurn.tags
    });
    expect(ambiguousButtonTurn.awaitingQuestionNodeId).toBe('node-buttons-menu');
    expect(ambiguousButtonTurn.completed).toBe(false);
    expect(ambiguousButtonTurn.replies[0].text).toContain('⚠️');

    const handoffTurn = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: '2. Hablar con Asesor',
      currentNodeId: ambiguousButtonTurn.nextNodeId,
      awaitingQuestionNodeId: ambiguousButtonTurn.awaitingQuestionNodeId,
      variables: ambiguousButtonTurn.variables,
      tags: ambiguousButtonTurn.tags
    });
    expect(handoffTurn.handoffRequested).toBe(true);
    expect(handoffTurn.tags).toContain('lead-calificado');
  });

  it('rejects SSRF HTTP hosts and unconfigured AI keys without returning fabricated data', async () => {
    const nodes: FlowNode[] = [
      {
        id: 'n-trig',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
      },
      {
        id: 'n-http',
        type: 'HTTP_REQUEST',
        position: { x: 100, y: 0 },
        data: {
          title: 'HTTP Local Bloqueado',
          method: 'GET',
          url: 'http://127.0.0.1:9000/internal',
          responseVariable: 'pedido'
        }
      },
      {
        id: 'n-ai',
        type: 'AI_PROMPT',
        position: { x: 200, y: 0 },
        data: {
          title: 'IA Sin Key',
          model: 'gpt-4o-mini',
          systemPrompt: 'Ayuda',
          saveToVariable: 'respuesta_ia'
        }
      }
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 'n-trig', target: 'n-http' },
      { id: 'e2', source: 'n-http', target: 'n-ai' }
    ];

    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'hola',
      variables: {},
      tags: []
    });

    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    }

    expect(result.variables.pedido).toBeUndefined();
    expect(result.variables.pedido_error).toContain('SSRF');
    expect(result.variables.respuesta_ia).toBeUndefined();
    expect(result.variables.respuesta_ia_error).toContain('OPENAI_API_KEY');
    expect(result.replies).toHaveLength(0);
  });

  it('verifies WhatsApp Cloud API signature, uses publishedVersion, continues multi-turn flow, blocks unknown bots and agent-active conversations', async () => {
    const app = await buildApp();
    const testBotId = 'bot-cloud-multiturn';
    const appSecret = 'meta_app_secret_super_secure_2026';

    runtimeStore.bots.push({
      id: testBotId,
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'Cloud Sales Bot',
      description: 'Cloud API Multi-Turn Bot',
      phoneNumber: '+18097504293',
      driver: 'CLOUD_API',
      status: 'CONNECTED',
      isActive: true,
      activeFlowId: 'flow-cloud-pub-vs-draft',
      activeFlowName: 'Flujo Cloud Publicado',
      timezone: 'America/Santo_Domingo',
      outOfHoursMessage: 'Fuera de horario',
      inactivityTimeoutMinutes: 15,
      inactivityCloseMessage: 'Cerrado',
      typingDelayMs: 500,
      rateLimitPerMinute: 30,
      messagesToday: 0,
      activeConversations: 0,
      handoffRate: 0,
      qrCodeData: null,
      qrExpiresAt: null,
      lastConnectedAt: new Date().toISOString(),
      chatwootConfig: null,
      cloudApiConfig: null,
      businessHours: [],
      quickReplies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    runtimeStore.saveCloudApiConfigForBot(testBotId, {
      phoneNumberId: '1092837465',
      wabaId: '9988776655',
      accessToken: 'EAAGm0PX4ZCpsBAJ9988776655',
      verifyToken: 'meta_verify_cloud_2026',
      appSecret
    });

    runtimeStore.flows.push({
      id: 'flow-cloud-pub-vs-draft',
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'Flujo Cloud Publicado',
      description: 'Prueba publicado vs borrador',
      botId: testBotId,
      botName: 'Cloud Sales Bot',
      isMainMenu: true,
      activeVersionNumber: 1,
      draftVersion: {
        id: 'fv-draft-unpub',
        versionNumber: 2,
        status: 'DRAFT',
        nodes: [
          {
            id: 'd-trig',
            type: 'TRIGGER',
            position: { x: 0, y: 0 },
            data: { title: 'Inicio Draft', matchMode: 'FIRST_MESSAGE' }
          },
          {
            id: 'd-msg',
            type: 'MESSAGE',
            position: { x: 100, y: 0 },
            data: { title: 'Borrador No Publicado', text: 'BORRADOR_NO_DEBE_SALIR' }
          }
        ],
        edges: [{ id: 'ed1', source: 'd-trig', target: 'd-msg' }],
        publishedAt: null,
        createdAt: new Date().toISOString()
      },
      publishedVersion: {
        id: 'fv-pub-v1',
        versionNumber: 1,
        status: 'PUBLISHED',
        nodes: [
          {
            id: 'p-trig',
            type: 'TRIGGER',
            position: { x: 0, y: 0 },
            data: { title: 'Inicio Pub', matchMode: 'FIRST_MESSAGE' }
          },
          {
            id: 'p-q-cedula',
            type: 'QUESTION',
            position: { x: 100, y: 0 },
            data: {
              title: 'Pedir Cedula',
              promptText: 'VERSION_PUBLICADA: escribe tu cédula',
              variableName: 'cedula',
              validationType: 'NATIONAL_ID',
              errorMessage: 'Documento inválido'
            }
          },
          {
            id: 'p-handoff',
            type: 'HANDOFF',
            position: { x: 200, y: 0 },
            data: {
              title: 'Pasar a Humano',
              clientMessage: 'Recibido {{cedula}}, transfiriendo.',
              privateNoteTemplate: 'Cedula {{cedula}}'
            }
          }
        ],
        edges: [
          { id: 'ep1', source: 'p-trig', target: 'p-q-cedula' },
          { id: 'ep2', source: 'p-q-cedula', target: 'p-handoff' }
        ],
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const unknownBotRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/whatsapp-cloud/non-existent-bot-id',
      payload: { object: 'whatsapp_business_account', entry: [] }
    });
    expect(unknownBotRes.statusCode).toBe(404);
    expect(unknownBotRes.json().error).toBe('BOT_NOT_FOUND');

    const turn1Payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '9988776655',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ wa_id: '18095550101', profile: { name: 'Ana Maria' } }],
                messages: [
                  {
                    from: '18095550101',
                    id: 'wamid.turn1',
                    type: 'text',
                    text: { body: 'hola' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const badSigRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${testBotId}`,
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      payload: turn1Payload
    });
    expect(badSigRes.statusCode).toBe(401);
    expect(badSigRes.json().error).toBe('CLOUD_SIGNATURE_INVALID');

    const malformedRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${testBotId}`,
      headers: { 'x-hub-signature-256': signMetaPayload({ foo: 'bar' }, appSecret) },
      payload: { foo: 'bar' }
    });
    expect(malformedRes.statusCode).toBe(400);
    expect(malformedRes.json().error).toBe('INVALID_WEBHOOK_PAYLOAD');

    const turn1Res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${testBotId}`,
      headers: { 'x-hub-signature-256': signMetaPayload(turn1Payload, appSecret) },
      payload: turn1Payload
    });
    expect(turn1Res.statusCode).toBe(200);
    const turn1Body = turn1Res.json();
    expect(turn1Body.simulation.replies[0].text).toContain('VERSION_PUBLICADA');
    expect(turn1Body.simulation.replies[0].text).not.toContain('BORRADOR_NO_DEBE_SALIR');
    expect(turn1Body.conversation.currentNodeId).toBe('p-q-cedula');

    const turn2Payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '9988776655',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ wa_id: '18095550101', profile: { name: 'Ana Maria' } }],
                messages: [
                  {
                    from: '18095550101',
                    id: 'wamid.turn2',
                    type: 'text',
                    text: { body: '40222334455' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const turn2Res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${testBotId}`,
      headers: { 'x-hub-signature-256': signMetaPayload(turn2Payload, appSecret) },
      payload: turn2Payload
    });
    expect(turn2Res.statusCode).toBe(200);
    const turn2Body = turn2Res.json();
    expect(turn2Body.simulation.variables.cedula).toBe('40222334455');
    expect(turn2Body.simulation.handoffRequested).toBe(true);
    expect(turn2Body.conversation.status).toBe('PENDING_AGENT');

    const turn3Payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '9988776655',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ wa_id: '18095550101', profile: { name: 'Ana Maria' } }],
                messages: [
                  {
                    from: '18095550101',
                    id: 'wamid.turn3',
                    type: 'text',
                    text: { body: 'hola de nuevo' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const turn3Res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${testBotId}`,
      headers: { 'x-hub-signature-256': signMetaPayload(turn3Payload, appSecret) },
      payload: turn3Payload
    });
    expect(turn3Res.statusCode).toBe(200);
    expect(turn3Res.json().action).toBe('recorded_while_agent_active');

    await app.close();
  });

  it('verifies WhatsApp Cloud API webhook challenge and Chatwoot constant-time webhook on configured bots', async () => {
    const app = await buildApp();
    const testBotId = 'bot-test-webhook';

    runtimeStore.saveCloudApiConfigForBot(testBotId, {
      phoneNumberId: '1092837465',
      wabaId: '9988776655',
      accessToken: 'EAAGm0PX4ZCpsBAJ9988776655',
      verifyToken: 'meta_verify_bothub_2026'
    });

    runtimeStore.saveChatwootConfigForBot(testBotId, {
      baseUrl: 'https://chat.bothub.local',
      accountId: 1,
      inboxId: 1,
      apiAccessToken: 'cw_api_token_123456',
      webhookToken: 'wh_sec_bothub_ventas_2026',
      handoffReturnCommand: '#bot'
    });

    runtimeStore.bots.push({
      id: testBotId,
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'Marcos Bot',
      description: 'Chatwoot Agent Bot',
      phoneNumber: '+18097504293',
      driver: 'CLOUD_API',
      status: 'CONNECTED',
      isActive: true,
      activeFlowId: 'flow-cw-test',
      activeFlowName: 'ByteMV principal',
      timezone: 'America/Santo_Domingo',
      outOfHoursMessage: 'Fuera de horario',
      inactivityTimeoutMinutes: 15,
      inactivityCloseMessage: 'Cerrado',
      typingDelayMs: 500,
      rateLimitPerMinute: 30,
      messagesToday: 0,
      activeConversations: 0,
      handoffRate: 0,
      qrCodeData: null,
      qrExpiresAt: null,
      lastConnectedAt: new Date().toISOString(),
      chatwootConfig: runtimeStore.getChatwootConfigDto(testBotId),
      cloudApiConfig: null,
      businessHours: [],
      quickReplies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    runtimeStore.conversations.push({
      id: 'conv-test-1',
      botId: testBotId,
      botName: 'Bot Test',
      contactId: 'contact-test-1',
      contactName: 'Cliente Real',
      contactPhone: '+573001112233',
      chatwootConversationId: 8841,
      status: 'AGENT_ACTIVE',
      assignedAgentName: 'Agente',
      currentFlowName: null,
      currentNodeId: null,
      collectedVariables: {},
      tags: [],
      handoffReason: null,
      lastMessagePreview: '',
      lastActivityAt: new Date().toISOString(),
      messages: [],
      executionTrace: []
    });

    const cloudVerifyRes = await app.inject({
      method: 'GET',
      url: `/api/webhooks/whatsapp-cloud/${testBotId}?hub.mode=subscribe&hub.verify_token=meta_verify_bothub_2026&hub.challenge=CHALLENGE_9988`
    });
    expect(cloudVerifyRes.statusCode).toBe(200);
    expect(cloudVerifyRes.body).toBe('CHALLENGE_9988');

    const chatwootInvalidRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/chatwoot/${testBotId}`,
      headers: {
        'x-chatwoot-webhook-token': 'wrong_token'
      },
      payload: {
        message_type: 'outgoing',
        content: '#bot'
      }
    });
    expect(chatwootInvalidRes.statusCode).toBe(401);

    const chatwootReturnRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/chatwoot/${testBotId}`,
      headers: {
        'x-chatwoot-webhook-token': 'wh_sec_bothub_ventas_2026'
      },
      payload: {
        message_type: 'outgoing',
        content: '#bot',
        conversation: { id: 8841 }
      }
    });
    expect(chatwootReturnRes.statusCode).toBe(200);
    expect(chatwootReturnRes.json().action).toBe('returned_to_bot');

    runtimeStore.flows.push({
      id: 'flow-cw-test',
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'ByteMV principal',
      description: 'Flujo Chatwoot',
      botId: testBotId,
      botName: 'Marcos Bot',
      isMainMenu: true,
      activeVersionNumber: 1,
      draftVersion: {
        id: 'fv-cw-1',
        versionNumber: 1,
        status: 'PUBLISHED',
        nodes: [
          {
            id: 'n-trig',
            type: 'TRIGGER',
            position: { x: 0, y: 0 },
            data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
          },
          {
            id: 'n-msg',
            type: 'MESSAGE',
            position: { x: 100, y: 0 },
            data: { title: 'Saludo', text: 'Hola {{nombre}}, soy Marcos de ByteMV.' }
          }
        ],
        edges: [{ id: 'e-1', source: 'n-trig', target: 'n-msg' }],
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      },
      publishedVersion: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const chatwootIncomingRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/chatwoot/${testBotId}?token=wh_sec_bothub_ventas_2026`,
      payload: {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Hola necesito ayuda',
        conversation: { id: 8841 },
        sender: { id: 501, name: 'Edward', type: 'contact' }
      }
    });
    expect(chatwootIncomingRes.statusCode).toBe(200);
    expect(chatwootIncomingRes.json().action).toBe('bot_flow_replied');

    await app.close();
  });

  it('recognizes Chatwoot Agent Bot 401 endpoint restriction as valid connection and sets ERROR status on invalid token', async () => {
    const botId = 'bot-cw-test-auth';
    runtimeStore.bots.push({
      id: botId,
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'Marcos Agent Bot',
      description: 'Chatwoot Agent Bot',
      phoneNumber: 'Chatwoot Agent Bot',
      driver: 'CHATWOOT',
      status: 'DISCONNECTED',
      isActive: true,
      activeFlowId: null,
      activeFlowName: null,
      timezone: 'America/Santo_Domingo',
      outOfHoursMessage: 'Fuera de horario',
      inactivityTimeoutMinutes: 15,
      inactivityCloseMessage: 'Cerrado',
      typingDelayMs: 500,
      rateLimitPerMinute: 30,
      messagesToday: 0,
      activeConversations: 0,
      handoffRate: 0,
      qrCodeData: null,
      qrExpiresAt: null,
      lastConnectedAt: null,
      chatwootConfig: null,
      cloudApiConfig: null,
      businessHours: [],
      quickReplies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    ChatwootService.saveConfig(botId, {
      baseUrl: 'https://chat.bytemv.com',
      accountId: 1,
      inboxId: 1,
      apiAccessToken: 'valid_agent_bot_token_123',
      webhookToken: 'wh_sec_marcos_2026',
      handoffReturnCommand: '#bot',
      isActive: true
    });

    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ error: 'Access to this endpoint is not authorized for bots' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch;

      const okResult = await ChatwootService.testConnection(botId);
      expect(okResult.connected).toBe(true);
      expect(okResult.bot?.status).toBe('CONNECTED');

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'Invalid access token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })) as typeof fetch;

      await expect(ChatwootService.testConnection(botId)).rejects.toThrow('401');
      const updatedBot = runtimeStore.bots.find((b) => b.id === botId);
      expect(updatedBot?.status).toBe('ERROR');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
