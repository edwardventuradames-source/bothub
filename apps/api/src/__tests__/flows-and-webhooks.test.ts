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

  it('executes a flow graph from TRIGGER to QUESTION and validates cedula before BUTTONS and HANDOFF', () => {
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
          buttons: [{ id: 'btn-asesor', label: '3. Hablar con Asesor' }]
        }
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
        id: 'e4',
        source: 'node-buttons-menu',
        target: 'node-tag-vip',
        sourceHandle: 'btn-asesor'
      },
      { id: 'e5', source: 'node-tag-vip', target: 'node-handoff-cw' }
    ];

    const firstTurn = executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'hola',
      variables: { nombre: 'Cliente Test', telefono: '+573001112233' },
      tags: []
    });

    expect(firstTurn.replies.length).toBeGreaterThanOrEqual(2);
    expect(firstTurn.awaitingQuestionNodeId).toBe('node-q-cedula');

    const invalidTurn = executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'no-es-cedula',
      currentNodeId: firstTurn.nextNodeId,
      awaitingQuestionNodeId: firstTurn.awaitingQuestionNodeId,
      variables: firstTurn.variables,
      tags: firstTurn.tags
    });
    expect(invalidTurn.awaitingQuestionNodeId).toBe('node-q-cedula');
    expect(invalidTurn.replies[0].text).toContain('⚠️');

    const validTurn = executeFlowSimulationStep(nodes, edges, {
      inputMessage: '1020458912',
      currentNodeId: invalidTurn.nextNodeId,
      awaitingQuestionNodeId: invalidTurn.awaitingQuestionNodeId,
      variables: invalidTurn.variables,
      tags: invalidTurn.tags
    });
    expect(validTurn.variables.cedula).toBe('1020458912');
    expect(validTurn.awaitingQuestionNodeId).toBe('node-buttons-menu');

    const handoffTurn = executeFlowSimulationStep(nodes, edges, {
      inputMessage: '3. Hablar con Asesor',
      currentNodeId: validTurn.nextNodeId,
      awaitingQuestionNodeId: validTurn.awaitingQuestionNodeId,
      variables: validTurn.variables,
      tags: validTurn.tags
    });
    expect(handoffTurn.handoffRequested).toBe(true);
    expect(handoffTurn.tags).toContain('lead-calificado');
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

    await app.close();
  });
});
