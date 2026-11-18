import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import {
  executeFlowSimulationStep,
  interpolateFlowVariables,
  validateQuestionAnswer
} from '../modules/flows/flow.engine.js';
import { runtimeStore } from '../lib/runtime-store.js';

describe('Flow Engine & Webhooks Integration (Phases 2 to 6)', () => {
  it('interpolates dynamic variables and validates NATIONAL_ID and EMAIL', () => {
    const rendered = interpolateFlowVariables(
      'Hola {{nombre}}, tu documento es {{cedula}}.',
      { nombre: 'Mariana', cedula: '1020458912' }
    );
    expect(rendered).toBe('Hola Mariana, tu documento es 1020458912.');

    expect(validateQuestionAnswer('abc', 'NATIONAL_ID').valid).toBe(false);
    expect(validateQuestionAnswer('1020458912', 'NATIONAL_ID').valid).toBe(true);
    expect(validateQuestionAnswer('correo@empresa.co', 'EMAIL').valid).toBe(true);
  });

  it('executes sales flow graph from TRIGGER to QUESTION and validates cedula before BUTTONS', () => {
    const salesFlow = runtimeStore.flows[0];
    const nodes = salesFlow.draftVersion.nodes;
    const edges = salesFlow.draftVersion.edges;

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
      inputMessage: '3',
      currentNodeId: validTurn.nextNodeId,
      awaitingQuestionNodeId: validTurn.awaitingQuestionNodeId,
      variables: validTurn.variables,
      tags: validTurn.tags
    });
    expect(handoffTurn.handoffRequested).toBe(true);
    expect(handoffTurn.tags).toContain('lead-calificado');
  });

  it('verifies WhatsApp Cloud API webhook challenge and Chatwoot constant-time webhook', async () => {
    const app = await buildApp();

    const cloudVerifyRes = await app.inject({
      method: 'GET',
      url: '/api/webhooks/whatsapp-cloud/bot-soporte-n1?hub.mode=subscribe&hub.verify_token=meta_verify_bothub_2026&hub.challenge=CHALLENGE_9988'
    });
    expect(cloudVerifyRes.statusCode).toBe(200);
    expect(cloudVerifyRes.body).toBe('CHALLENGE_9988');

    const chatwootInvalidRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/chatwoot/bot-ventas-principal',
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
      url: '/api/webhooks/chatwoot/bot-ventas-principal',
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
