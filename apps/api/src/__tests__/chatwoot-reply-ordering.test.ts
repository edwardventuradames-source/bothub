import { describe, expect, it, vi } from 'vitest';
import { FlowEdge, FlowNode } from '@bothub/shared';
import { resolveInterReplyWaitMs } from '../lib/bot-runtime-utils.js';
import { runtimeStore } from '../lib/runtime-store.js';
import { executeFlowSimulationStep } from '../modules/flows/flow.engine.js';
import { ChatwootService } from '../modules/chatwoot/chatwoot.service.js';

describe('Chatwoot Reply Ordering and Media Pacing', () => {
  it('computes safe pacing after media replies and attaches inter-reply DELAY onto subsequent reply', async () => {
    expect(
      resolveInterReplyWaitMs({
        previousHadMedia: true,
        viaChatwoot: true
      })
    ).toBeGreaterThanOrEqual(2500);

    expect(
      resolveInterReplyWaitMs({
        previousHadMedia: false,
        nextDelayMs: 3000,
        viaChatwoot: true
      })
    ).toBe(3000);

    const nodes: FlowNode[] = [
      {
        id: 't1',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
      },
      {
        id: 'm1',
        type: 'MESSAGE',
        position: { x: 100, y: 0 },
        data: {
          title: 'Bienvenida',
          text: 'Hola cliente',
          mediaUrl: 'https://cdn.bytemv.com/logo.png'
        }
      },
      {
        id: 'd1',
        type: 'DELAY',
        position: { x: 200, y: 0 },
        data: { title: 'Pausa', delaySeconds: 3 }
      },
      {
        id: 'm2',
        type: 'MESSAGE',
        position: { x: 300, y: 0 },
        data: { title: 'Estatus', text: 'Tu orden está lista' }
      }
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 't1', target: 'm1' },
      { id: 'e2', source: 'm1', target: 'd1' },
      { id: 'e3', source: 'd1', target: 'm2' }
    ];

    const result = await executeFlowSimulationStep(nodes, edges, {
      inputMessage: 'Hola',
      variables: {},
      tags: []
    });

    expect(result.replies).toHaveLength(2);
    expect(result.replies[0].text).toBe('Hola cliente');
    expect(result.replies[0].mediaUrl).toBe('https://cdn.bytemv.com/logo.png');
    expect(result.replies[0].delayMs).toBeUndefined();
    expect(result.replies[1].text).toBe('Tu orden está lista');
    expect(result.replies[1].delayMs).toBe(2500);
  });

  it('paces remote Chatwoot delivery between a media attachment and a subsequent text message', async () => {
    const botId = 'bot-order-pacing';
    const flowId = 'flow-order-pacing';
    const orgId = '00000000-0000-4000-8000-000000000901';

    runtimeStore.bots.push({
      id: botId,
      organizationId: orgId,
      name: 'Bot Orden',
      description: 'Order pacing bot',
      phoneNumber: '+18095550000',
      driver: 'CHATWOOT',
      status: 'CONNECTED',
      isActive: true,
      activeFlowId: flowId,
      activeFlowName: 'Flujo Ordenado',
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

    ChatwootService.saveConfig(botId, {
      baseUrl: 'https://chat.bytemv.com',
      accountId: 1,
      inboxId: 1,
      apiAccessToken: 'cw_test_order_token',
      webhookToken: 'wh_test_order_token',
      handoffReturnCommand: '#bot'
    });

    runtimeStore.flows.push({
      id: flowId,
      organizationId: orgId,
      name: 'Flujo Ordenado',
      description: 'Media then text',
      botId,
      botName: 'Bot Orden',
      isMainMenu: true,
      activeVersionNumber: 1,
      draftVersion: {
        id: 'fv-order-1',
        versionNumber: 1,
        status: 'PUBLISHED',
        nodes: [],
        edges: [],
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      },
      publishedVersion: {
        id: 'fv-order-1',
        versionNumber: 1,
        status: 'PUBLISHED',
        nodes: [
          {
            id: 'trig',
            type: 'TRIGGER',
            position: { x: 0, y: 0 },
            data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE' }
          },
          {
            id: 'msg-img',
            type: 'MESSAGE',
            position: { x: 100, y: 0 },
            data: {
              title: 'Bienvenida',
              text: 'Mensaje 1 con imagen',
              mediaUrl: 'https://cdn.bytemv.com/welcome.png'
            }
          },
          {
            id: 'msg-txt',
            type: 'MESSAGE',
            position: { x: 200, y: 0 },
            data: {
              title: 'Seguimiento',
              text: 'Mensaje 2 texto'
            }
          }
        ],
        edges: [
          { id: 'ed1', source: 'trig', target: 'msg-img' },
          { id: 'ed2', source: 'msg-img', target: 'msg-txt' }
        ],
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const originalFetch = globalThis.fetch;
    const chatwootPosts: Array<{ sentAt: number; contentType: string; body: string }> = [];
    vi.useFakeTimers();

    try {
      globalThis.fetch = (async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('cdn.bytemv.com/welcome.png')) {
          return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: { 'Content-Type': 'image/png' }
          });
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const rawBody =
          typeof init?.body === 'string'
            ? init.body
            : init?.body
              ? Buffer.from(init.body as Uint8Array).toString('utf8')
              : '';
        chatwootPosts.push({
          sentAt: Date.now(),
          contentType: headers['Content-Type'] ?? '',
          body: rawBody
        });
        return new Response(JSON.stringify({ id: chatwootPosts.length }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }) as typeof fetch;

      const taskPromise = ChatwootService.processWebhookEvent(botId, 'wh_test_order_token', {
        event: 'message_created',
        id: 99123,
        message_type: 'incoming',
        content: 'Hola',
        sender: { id: 55, name: 'Edward', phone_number: '+18099963025' },
        conversation: { id: 55, status: 'pending' }
      });

      await vi.advanceTimersByTimeAsync(5000);
      const outcome = await taskPromise;

      expect(outcome.action).toBe('bot_flow_replied');
      expect(chatwootPosts).toHaveLength(2);
      expect(chatwootPosts[0].contentType).toContain('multipart/form-data');
      expect(chatwootPosts[0].body).toContain('Mensaje 1 con imagen');
      expect(chatwootPosts[1].contentType).toBe('application/json');
      expect(chatwootPosts[1].body).toContain('Mensaje 2 texto');
      expect(chatwootPosts[1].sentAt - chatwootPosts[0].sentAt).toBeGreaterThanOrEqual(2500);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
    }
  });
});
