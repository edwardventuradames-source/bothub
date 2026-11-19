import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FlowEdge, FlowNode } from '@bothub/shared';
import { buildApp } from '../app.js';
import { isWithinBotBusinessHours } from '../lib/bot-runtime-utils.js';
import { runtimeStore } from '../lib/runtime-store.js';
import { provisionAdminAccountFromServer } from '../modules/auth/auth.service.js';
import {
  executeFlowSimulationStep,
  validateQuestionAnswer
} from '../modules/flows/flow.engine.js';
import { processInboundWhatsAppMessage } from '../modules/whatsapp/inbound-pipeline.js';

function signMetaPayload(payload: unknown, appSecret: string): string {
  return `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(JSON.stringify(payload))
    .digest('hex')}`;
}

describe('Functional, Logic, Validation & Edge-Case Audit Suite', () => {
  it('validates real calendar DATE values and rejects impossible dates', () => {
    expect(validateQuestionAnswer('2024-02-29', 'DATE').valid).toBe(true);
    expect(validateQuestionAnswer('15/08/2026', 'DATE').valid).toBe(true);
    expect(validateQuestionAnswer('2026-99-99', 'DATE').valid).toBe(false);
    expect(validateQuestionAnswer('2025-02-29', 'DATE').valid).toBe(false);
    expect(validateQuestionAnswer('31/02/2026', 'DATE').valid).toBe(false);
    expect(validateQuestionAnswer('2026-04-31', 'DATE').valid).toBe(false);

    const closedAtSixBot = {
      businessHoursEnabled: true,
      timezone: 'UTC',
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isOpen: true,
        openTime: '09:00',
        closeTime: '18:00'
      }))
    } as Parameters<typeof isWithinBotBusinessHours>[0];
    expect(
      isWithinBotBusinessHours(closedAtSixBot, new Date('2026-11-19T18:30:00Z'))
    ).toBe(false);
    expect(
      isWithinBotBusinessHours(closedAtSixBot, new Date('2026-11-19T17:59:00Z'))
    ).toBe(true);
  });

  it('prevents infinite loops in flow graphs, avoids fake live defaults, and evaluates numeric/negative conditions accurately', async () => {
    const loopNodes: FlowNode[] = [
      {
        id: 't1',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { title: 'Trigger', matchMode: 'FIRST_MESSAGE' }
      },
      {
        id: 'm1',
        type: 'MESSAGE',
        position: { x: 100, y: 0 },
        data: { title: 'Msg A', text: 'Hola {{nombre}}' }
      },
      {
        id: 'c1',
        type: 'CONDITION',
        position: { x: 200, y: 0 },
        data: {
          title: 'Check Num',
          variableName: 'edad',
          operator: 'LESS_THAN',
          compareValue: '18'
        }
      },
      {
        id: 'm2',
        type: 'MESSAGE',
        position: { x: 300, y: 0 },
        data: { title: 'False branch', text: 'Continuando' }
      }
    ];
    const loopEdges: FlowEdge[] = [
      { id: 'e1', source: 't1', target: 'm1' },
      { id: 'e2', source: 'm1', target: 'c1' },
      { id: 'e3', source: 'c1', target: 'm2', sourceHandle: 'false' },
      { id: 'e4', source: 'm2', target: 'm1' }
    ];

    const stepResult = await executeFlowSimulationStep(
      loopNodes,
      loopEdges,
      {
        inputMessage: 'hola',
        variables: { edad: 'no-numero' },
        tags: []
      },
      { isLiveExecution: true }
    );

    expect(stepResult.replies[0]?.text).toBe('Hola {{nombre}}');
    expect(stepResult.replies[0]?.text).not.toContain('Cliente Demo');
    expect(stepResult.variables.nombre).toBeUndefined();
    expect(stepResult.trace.some((t) => t.detail.includes('no-numero'))).toBe(false);
    expect(stepResult.replies.length).toBeGreaterThanOrEqual(2);
    expect(stepResult.replies.length).toBeLessThan(10);
  });

  it('handles unconfigured bot toggle-pause state transitions, blank-token updates, and delete cleanup', async () => {
    const app = await buildApp();
    await provisionAdminAccountFromServer({
      email: 'func-admin@bothub.test',
      password: 'FuncAdminPass2026!',
      name: 'Func Admin',
      organizationName: 'Func Org'
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'func-admin@bothub.test',
        password: 'FuncAdminPass2026!'
      }
    });
    const token = (loginRes.json() as { accessToken: string }).accessToken;

    const flowRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Flujo Func Test',
        isMainMenu: true
      }
    });
    expect(flowRes.statusCode).toBe(201);
    const createdFlow = (flowRes.json() as { flow: { id: string } }).flow;

    const botRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Unconfigured Chatwoot Bot',
        driver: 'CHATWOOT',
        activeFlowId: createdFlow.id,
        businessHoursEnabled: false
      }
    });
    expect(botRes.statusCode).toBe(201);
    const createdBot = (botRes.json() as { bot: { id: string; status: string } }).bot;
    expect(createdBot.status).toBe('DISCONNECTED');

    const pauseRes = await app.inject({
      method: 'POST',
      url: `/api/bots/${createdBot.id}/toggle-pause`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(pauseRes.statusCode).toBe(200);
    expect((pauseRes.json() as { bot: { status: string } }).bot.status).toBe('PAUSED');

    const resumeUnconfiguredRes = await app.inject({
      method: 'POST',
      url: `/api/bots/${createdBot.id}/toggle-pause`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(resumeUnconfiguredRes.statusCode).toBe(200);
    expect(
      (resumeUnconfiguredRes.json() as { bot: { status: string } }).bot.status
    ).toBe('DISCONNECTED');

    const cwSaveInitial = await app.inject({
      method: 'PUT',
      url: `/api/bots/${createdBot.id}/chatwoot`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        baseUrl: 'https://chatwoot.local',
        accountId: 1,
        inboxId: 1,
        apiAccessToken: 'initial_cw_token_123',
        webhookToken: 'whsec_initial_123'
      }
    });
    expect(cwSaveInitial.statusCode).toBe(200);
    expect(
      (cwSaveInitial.json() as { chatwootConfig: { webhookEndpointPath: string } })
        .chatwootConfig.webhookEndpointPath
    ).not.toContain('token=');

    const cwSaveBlankToken = await app.inject({
      method: 'PUT',
      url: `/api/bots/${createdBot.id}/chatwoot`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        baseUrl: 'https://chatwoot.local',
        accountId: 1,
        inboxId: 2,
        apiAccessToken: '',
        webhookToken: ''
      }
    });
    expect(cwSaveBlankToken.statusCode).toBe(200);

    const cloudSaveInitial = await app.inject({
      method: 'PUT',
      url: `/api/bots/${createdBot.id}/cloud-api`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        phoneNumberId: '100020003000',
        wabaId: '400050006000',
        accessToken: 'EAAG_CLOUD_SECRET_1234',
        verifyToken: 'verify_cloud_1234'
      }
    });
    expect(cloudSaveInitial.statusCode).toBe(200);

    const cloudSaveBlankToken = await app.inject({
      method: 'PUT',
      url: `/api/bots/${createdBot.id}/cloud-api`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        phoneNumberId: '100020003001',
        wabaId: '400050006001',
        accessToken: '',
        verifyToken: ''
      }
    });
    expect(cloudSaveBlankToken.statusCode).toBe(200);

    const deleteBotRes = await app.inject({
      method: 'DELETE',
      url: `/api/bots/${createdBot.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(deleteBotRes.statusCode).toBe(200);
    expect(runtimeStore.chatwootSecrets.has(createdBot.id)).toBe(false);
    expect(runtimeStore.cloudApiSecrets.has(createdBot.id)).toBe(false);

    await app.close();
  });

  it('deduplicates Cloud API wamid, survives sendReply error without HTTP 500, enforces business hours, validates contacts/handoff, and computes live metrics', async () => {
    const app = await buildApp();
    await provisionAdminAccountFromServer({
      email: 'pipe-admin@bothub.test',
      password: 'PipeAdminPass2026!',
      name: 'Pipeline Admin',
      organizationName: 'Pipeline Org'
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'pipe-admin@bothub.test',
        password: 'PipeAdminPass2026!'
      }
    });
    const loginBody = loginRes.json() as {
      accessToken: string;
      user: { organizationId: string };
    };
    const token = loginBody.accessToken;
    const orgId = loginBody.user.organizationId;

    const flowRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Flujo Live Pipeline', isMainMenu: true }
    });
    const flowId = (flowRes.json() as { flow: { id: string } }).flow.id;

    const botRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cloud Pipeline Bot',
        driver: 'CLOUD_API',
        activeFlowId: flowId,
        businessHoursEnabled: false
      }
    });
    const botId = (botRes.json() as { bot: { id: string } }).bot.id;

    const appSecret = 'meta_func_app_secret_2026';
    await app.inject({
      method: 'PUT',
      url: `/api/bots/${botId}/cloud-api`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        phoneNumberId: '777888999',
        wabaId: '111222333',
        accessToken: 'EAAG_FUNC_TOKEN_1234',
        verifyToken: 'verify_func_1234',
        appSecret
      }
    });

    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [
                  {
                    profile: { name: 'Carlos QA' },
                    wa_id: '573001234567'
                  }
                ],
                messages: [
                  {
                    from: '573001234567',
                    id: 'wamid.dedup.unique.001',
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

    const sig = signMetaPayload(webhookPayload, appSecret);
    const whFirst = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${botId}`,
      headers: { 'x-hub-signature-256': sig },
      payload: webhookPayload
    });
    expect(whFirst.statusCode).toBe(200);
    const firstBody = whFirst.json() as {
      action: string;
      conversation: { id: string; status: string };
    };
    expect(firstBody.conversation.status).toBe('BOT_ACTIVE');

    const whDuplicate = await app.inject({
      method: 'POST',
      url: `/api/webhooks/whatsapp-cloud/${botId}`,
      headers: { 'x-hub-signature-256': sig },
      payload: webhookPayload
    });
    expect(whDuplicate.statusCode).toBe(200);
    expect((whDuplicate.json() as { action: string }).action).toBe(
      'duplicate_message_ignored'
    );

    const badHandoff = await app.inject({
      method: 'POST',
      url: `/api/conversations/${firstBody.conversation.id}/handoff`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'INVALID_ACTION' }
    });
    expect(badHandoff.statusCode).toBe(400);

    const contact = runtimeStore.contacts.find((c) => c.organizationId === orgId);
    expect(contact).toBeDefined();
    const badContactUpdate = await app.inject({
      method: 'PUT',
      url: `/api/contacts/${contact!.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { variables: { nested: { invalid: true } } }
    });
    expect(badContactUpdate.statusCode).toBe(400);

    const deliveryFailResult = await processInboundWhatsAppMessage({
      botId,
      fromPhone: '+573001234567',
      contactName: 'Carlos QA',
      text: 'menu',
      externalMessageId: 'wamid.fail.delivery.002',
      sendReply: async () => {
        throw new Error('Simulated Meta 503 outage');
      }
    });
    expect(deliveryFailResult.accepted).toBe(true);
    expect(
      runtimeStore.logs.some(
        (l) => l.botId === botId && l.event === 'whatsapp.send.error'
      )
    ).toBe(true);

    const botObj = runtimeStore.bots.find((b) => b.id === botId)!;
    botObj.businessHoursEnabled = true;
    botObj.businessHours = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      isOpen: false,
      openTime: '08:00',
      closeTime: '18:00'
    }));
    botObj.outOfHoursMessage = 'Cerrado ahora mismo.';

    const oohRes = await processInboundWhatsAppMessage({
      botId,
      fromPhone: '+573001234567',
      contactName: 'Carlos QA',
      text: 'ayuda',
      externalMessageId: 'wamid.ooh.003'
    });
    expect(oohRes.action).toBe('out_of_hours_replied');
    botObj.businessHoursEnabled = false;

    const convObj = runtimeStore.conversations.find(
      (c) => c.id === firstBody.conversation.id
    )!;
    convObj.status = 'RESOLVED';
    convObj.currentNodeId = 'non-existent-orphan-node';

    const reopenRes = await processInboundWhatsAppMessage({
      botId,
      fromPhone: '+573001234567',
      contactName: 'Carlos QA',
      text: 'hola de nuevo',
      externalMessageId: 'wamid.reopen.004'
    });
    expect(reopenRes.conversation?.status).toBe('BOT_ACTIVE');

    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(metricsRes.statusCode).toBe(200);
    const metricsPayload = metricsRes.json() as {
      metrics: {
        hourlyMessages: Array<{ inbound: number; outbound: number }>;
        weeklyFlowPerformance: Array<{ resolvedByBot: number }>;
      };
    };
    expect(metricsPayload.metrics.hourlyMessages.length).toBe(8);
    expect(
      metricsPayload.metrics.hourlyMessages.some((b) => b.inbound > 0 || b.outbound > 0)
    ).toBe(true);
    expect(
      metricsPayload.metrics.weeklyFlowPerformance.some((d) => d.resolvedByBot > 0)
    ).toBe(true);

    await app.close();
  });
});
