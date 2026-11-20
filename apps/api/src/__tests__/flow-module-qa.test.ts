import { describe, expect, it } from 'vitest';
import { FlowEdge, FlowNode } from '@bothub/shared';
import { buildApp } from '../app.js';
import { executeFlowSimulationStep } from '../modules/flows/flow.engine.js';
import { provisionAdminAccountFromServer } from '../modules/auth/auth.service.js';
import { runtimeStore } from '../lib/runtime-store.js';

describe('Flow Module End-to-End QA (All 12 Nodes Connected)', () => {
  it('executes HTTP_REQUEST GET (plain text, JSON string, nested JSONPath $.items[0], and {{var}} sanitization) and renders it in MESSAGE', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/plain')) {
          return new Response('APROBADO_SIN_COMILLAS', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (urlStr.includes('/json-string')) {
          return new Response(JSON.stringify('EN_TRANSITO'), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(
          JSON.stringify({
            cliente: 'Edward Ventura',
            items: [{ estado: 'LISTO_PARA_ENTREGA', monto: 1500 }]
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }) as typeof fetch;

      const nodes: FlowNode[] = [
        {
          id: 'n-trig',
          type: 'TRIGGER',
          position: { x: 0, y: 0 },
          data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
        },
        {
          id: 'n-http-plain',
          type: 'HTTP_REQUEST',
          position: { x: 100, y: 0 },
          data: {
            title: 'GET Beeceptor Plain',
            method: 'GET',
            url: 'https://demo.free.beeceptor.com/plain',
            responseVariable: '{{estado_plain}}'
          }
        },
        {
          id: 'n-http-str',
          type: 'HTTP_REQUEST',
          position: { x: 200, y: 0 },
          data: {
            title: 'GET JSON String',
            method: 'GET',
            url: 'https://demo.free.beeceptor.com/json-string',
            responseVariable: 'estado_string'
          }
        },
        {
          id: 'n-http-json',
          type: 'HTTP_REQUEST',
          position: { x: 300, y: 0 },
          data: {
            title: 'GET JSON Completo',
            method: 'GET',
            url: 'https://demo.free.beeceptor.com/order',
            responseVariable: 'pedido'
          }
        },
        {
          id: 'n-http-path',
          type: 'HTTP_REQUEST',
          position: { x: 400, y: 0 },
          data: {
            title: 'GET JSONPath $.items[0].estado',
            method: 'GET',
            url: 'https://demo.free.beeceptor.com/order',
            responseVariable: 'estado_item',
            responsePath: '$.items[0].estado'
          }
        },
        {
          id: 'n-msg',
          type: 'MESSAGE',
          position: { x: 500, y: 0 },
          data: {
            title: 'Mostrar Variables HTTP',
            text: 'Plain={{estado_plain}} | Str={{estado_string}} | Cliente={{pedido.cliente}} | Monto={{pedido.items[0].monto}} | Path={{estado_item}}'
          }
        }
      ];

      const edges: FlowEdge[] = [
        { id: 'e1', source: 'n-trig', target: 'n-http-plain' },
        { id: 'e2', source: 'n-http-plain', target: 'n-http-str' },
        { id: 'e3', source: 'n-http-str', target: 'n-http-json' },
        { id: 'e4', source: 'n-http-json', target: 'n-http-path' },
        { id: 'e5', source: 'n-http-path', target: 'n-msg' }
      ];

      const res = await executeFlowSimulationStep(nodes, edges, {
        inputMessage: 'hola',
        variables: {},
        tags: []
      });

      expect(res.variables.estado_plain).toBe('APROBADO_SIN_COMILLAS');
      expect(res.variables.estado_string).toBe('EN_TRANSITO');
      expect(res.variables.estado_item).toBe('LISTO_PARA_ENTREGA');
      expect(res.replies).toHaveLength(1);
      expect(res.replies[0].text).toBe(
        'Plain=APROBADO_SIN_COMILLAS | Str=EN_TRANSITO | Cliente=Edward Ventura | Monto=1500 | Path=LISTO_PARA_ENTREGA'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('chains TRIGGER -> MESSAGE -> QUESTION -> HTTP -> CONDITION -> LIST -> DELAY -> ASSIGN_TAG -> AI_PROMPT -> BUTTONS -> HANDOFF/END cleanly', async () => {
    const originalFetch = globalThis.fetch;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-qa-test-key';

    try {
      globalThis.fetch = (async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('api.openai.com')) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Resumen IA: cliente con saldo 2500.' } }]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ saldo: 2500, plan: 'PRO' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }) as typeof fetch;

      const nodes: FlowNode[] = [
        {
          id: 'trig',
          type: 'TRIGGER',
          position: { x: 0, y: 0 },
          data: { title: 'Inicio', matchMode: 'CONTAINS', keyword: 'hola, inicio' }
        },
        {
          id: 'msg-hi',
          type: 'MESSAGE',
          position: { x: 100, y: 0 },
          data: { title: 'Saludo', text: 'Hola {{nombre}}' }
        },
        {
          id: 'q-email',
          type: 'QUESTION',
          position: { x: 200, y: 0 },
          data: {
            title: 'Correo',
            promptText: 'Tu correo:',
            variableName: '{{correo}}',
            validationType: 'EMAIL',
            errorMessage: 'Correo inválido'
          }
        },
        {
          id: 'http-balance',
          type: 'HTTP_REQUEST',
          position: { x: 300, y: 0 },
          data: {
            title: 'Consultar Saldo',
            method: 'GET',
            url: 'https://crm.example-api.com/balance?email={{correo}}',
            responseVariable: 'saldo',
            responsePath: 'saldo'
          }
        },
        {
          id: 'cond-vip',
          type: 'CONDITION',
          position: { x: 400, y: 0 },
          data: {
            title: 'Saldo > 1000',
            variableName: '{{saldo}}',
            operator: 'GREATER_THAN',
            compareValue: '1000'
          }
        },
        {
          id: 'list-menu',
          type: 'LIST',
          position: { x: 500, y: -100 },
          data: {
            title: 'Lista VIP',
            bodyText: 'Saldo {{saldo}}. Elige servicio:',
            items: [
              { id: 'item-soporte', title: '1. Soporte VIP', description: 'Atención 24/7' },
              { id: 'item-cierre', title: '2. Salir', description: 'Terminar' }
            ]
          }
        },
        {
          id: 'delay-1',
          type: 'DELAY',
          position: { x: 600, y: -100 },
          data: { title: 'Pausa', delaySeconds: 1 }
        },
        {
          id: 'tag-vip',
          type: 'ASSIGN_TAG',
          position: { x: 700, y: -100 },
          data: { title: 'Etiqueta VIP', tags: ['vip-pro'] }
        },
        {
          id: 'ai-summary',
          type: 'AI_PROMPT',
          position: { x: 800, y: -100 },
          data: {
            title: 'IA',
            model: 'gpt-4o-mini',
            systemPrompt: 'Resume para {{correo}}',
            saveToVariable: '{{resumen_ia}}'
          }
        },
        {
          id: 'btns-final',
          type: 'BUTTONS',
          position: { x: 900, y: -100 },
          data: {
            title: 'Confirmar',
            bodyText: '¿Pasar con asesor?',
            buttons: [
              { id: 'btn-si', label: '1. Sí, transferir' },
              { id: 'btn-no', label: '2. No, finalizar' }
            ]
          }
        },
        {
          id: 'handoff-1',
          type: 'HANDOFF',
          position: { x: 1000, y: -150 },
          data: {
            title: 'Handoff',
            teamName: 'VIP',
            clientMessage: 'Transfiriendo saldo {{saldo}}',
            privateNoteTemplate: '{{correo}} - {{resumen_ia}}'
          }
        },
        {
          id: 'end-1',
          type: 'END',
          position: { x: 1000, y: 100 },
          data: { title: 'Fin', farewellMessage: 'Hasta pronto {{correo}}.' }
        }
      ];

      const edges: FlowEdge[] = [
        { id: 'e1', source: 'trig', target: 'msg-hi' },
        { id: 'e2', source: 'msg-hi', target: 'q-email' },
        { id: 'e3', source: 'q-email', target: 'http-balance' },
        { id: 'e4', source: 'http-balance', target: 'cond-vip' },
        { id: 'e5t', source: 'cond-vip', target: 'list-menu', sourceHandle: 'true' },
        { id: 'e5f', source: 'cond-vip', target: 'end-1', sourceHandle: 'false' },
        { id: 'e6a', source: 'list-menu', target: 'delay-1', sourceHandle: 'item-soporte' },
        { id: 'e6b', source: 'list-menu', target: 'end-1', sourceHandle: 'item-cierre' },
        { id: 'e7', source: 'delay-1', target: 'tag-vip' },
        { id: 'e8', source: 'tag-vip', target: 'ai-summary' },
        { id: 'e9', source: 'ai-summary', target: 'btns-final' },
        { id: 'e10a', source: 'btns-final', target: 'handoff-1', sourceHandle: 'btn-si' },
        { id: 'e10b', source: 'btns-final', target: 'end-1', sourceHandle: 'btn-no' }
      ];

      const t1 = await executeFlowSimulationStep(nodes, edges, {
        inputMessage: 'hola quiero info',
        variables: { nombre: 'Carlos' },
        tags: []
      });
      expect(t1.awaitingQuestionNodeId).toBe('q-email');
      expect(t1.replies.map((r) => r.text)).toEqual(['Hola Carlos', 'Tu correo:']);

      const t2 = await executeFlowSimulationStep(nodes, edges, {
        inputMessage: 'carlos@empresa.com',
        currentNodeId: t1.nextNodeId,
        awaitingQuestionNodeId: t1.awaitingQuestionNodeId,
        variables: t1.variables,
        tags: t1.tags
      });
      expect(t2.variables.correo).toBe('carlos@empresa.com');
      expect(t2.variables.saldo).toBe('2500');
      expect(t2.awaitingQuestionNodeId).toBe('list-menu');
      expect(t2.replies[0].text).toContain('Saldo 2500');

      const t3Bad = await executeFlowSimulationStep(nodes, edges, {
        inputMessage: 'invalida',
        currentNodeId: t2.nextNodeId,
        awaitingQuestionNodeId: t2.awaitingQuestionNodeId,
        variables: t2.variables,
        tags: t2.tags
      });
      expect(t3Bad.awaitingQuestionNodeId).toBe('list-menu');

      const t3Ok = await executeFlowSimulationStep(nodes, edges, {
        inputMessage: '1',
        currentNodeId: t3Bad.nextNodeId,
        awaitingQuestionNodeId: t3Bad.awaitingQuestionNodeId,
        variables: t3Bad.variables,
        tags: t3Bad.tags
      });
      expect(t3Ok.assignedTags).toEqual(['vip-pro']);
      expect(t3Ok.variables.resumen_ia).toBe('Resumen IA: cliente con saldo 2500.');
      expect(t3Ok.awaitingQuestionNodeId).toBe('btns-final');
      expect(t3Ok.replies.some((r) => r.text.includes('Resumen IA'))).toBe(true);

      const t4 = await executeFlowSimulationStep(nodes, edges, {
        inputMessage: '1',
        currentNodeId: t3Ok.nextNodeId,
        awaitingQuestionNodeId: t3Ok.awaitingQuestionNodeId,
        variables: t3Ok.variables,
        tags: t3Ok.tags
      });
      expect(t4.handoffRequested).toBe(true);
      expect(t4.completed).toBe(true);
      expect(t4.handoffSummary).toBe('carlos@empresa.com - Resumen IA: cliente con saldo 2500.');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  it('prevents infinite loops on cyclic graphs and simulates unsaved canvas nodes via /api/flows/:id/simulate', async () => {
    const app = await buildApp();

    await provisionAdminAccountFromServer({
      email: 'qa-flows@bytemv.com',
      password: 'StrongPassword2026!',
      name: 'QA Flow Admin',
      organizationName: 'Bytemv QA'
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'qa-flows@bytemv.com',
        password: 'StrongPassword2026!'
      }
    });
    const { accessToken, user } = loginRes.json();

    runtimeStore.flows.push({
      id: 'flow-qa-override',
      organizationId: user.organizationId,
      name: 'Flow QA Override',
      description: 'Test unsaved simulation',
      botId: null,
      botName: null,
      isMainMenu: false,
      activeVersionNumber: 1,
      draftVersion: {
        id: 'fv-qa-1',
        versionNumber: 1,
        status: 'DRAFT',
        nodes: [
          {
            id: 'old-trig',
            type: 'TRIGGER',
            position: { x: 0, y: 0 },
            data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
          },
          {
            id: 'old-msg',
            type: 'MESSAGE',
            position: { x: 100, y: 0 },
            data: { title: 'Viejo', text: 'MENSAJE_VIEJO' }
          }
        ],
        edges: [{ id: 'e-old', source: 'old-trig', target: 'old-msg' }],
        publishedAt: null,
        createdAt: new Date().toISOString()
      },
      publishedVersion: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const simRes = await app.inject({
      method: 'POST',
      url: '/api/flows/flow-qa-override/simulate',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        inputMessage: 'hola',
        variables: {},
        tags: [],
        nodes: [
          {
            id: 'new-trig',
            type: 'TRIGGER',
            position: { x: 0, y: 0 },
            data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
          },
          {
            id: 'new-msg',
            type: 'MESSAGE',
            position: { x: 100, y: 0 },
            data: { title: 'Nuevo', text: 'MENSAJE_DEL_LIENZO_SIN_GUARDAR' }
          }
        ],
        edges: [{ id: 'e-new', source: 'new-trig', target: 'new-msg' }]
      }
    });

    expect(simRes.statusCode).toBe(200);
    expect(simRes.json().replies[0].text).toBe('MENSAJE_DEL_LIENZO_SIN_GUARDAR');

    const cycleNodes: FlowNode[] = [
      {
        id: 'c-trig',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
      },
      {
        id: 'c-a',
        type: 'MESSAGE',
        position: { x: 100, y: 0 },
        data: { title: 'A', text: 'Paso A' }
      },
      {
        id: 'c-b',
        type: 'MESSAGE',
        position: { x: 200, y: 0 },
        data: { title: 'B', text: 'Paso B' }
      }
    ];
    const cycleEdges: FlowEdge[] = [
      { id: 'ce1', source: 'c-trig', target: 'c-a' },
      { id: 'ce2', source: 'c-a', target: 'c-b' },
      { id: 'ce3', source: 'c-b', target: 'c-a' }
    ];

    const cycleRes = await executeFlowSimulationStep(cycleNodes, cycleEdges, {
      inputMessage: 'hola',
      variables: {},
      tags: []
    });
    expect(cycleRes.replies).toHaveLength(2);
    expect(
      cycleRes.trace.some((step) => step.detail.includes('ciclo infinito'))
    ).toBe(true);

    await app.close();
  });
});
