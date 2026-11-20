import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { provisionAdminAccountFromServer } from '../modules/auth/auth.service.js';

describe('Flow Bot Reassignment (PATCH /api/flows/:id)', () => {
  it('reassigns a flow between organization bots, unlinks previous activeFlowId, unassigns to null, and rejects cross-org bots', async () => {
    const app = await buildApp();

    await provisionAdminAccountFromServer({
      email: 'flow-assign-a@bothub.test',
      password: 'AssignPass2026!',
      name: 'Assign Admin A',
      organizationName: 'Assign Org A'
    });
    await provisionAdminAccountFromServer({
      email: 'flow-assign-b@bothub.test',
      password: 'AssignPass2026!',
      name: 'Assign Admin B',
      organizationName: 'Assign Org B'
    });

    const loginARes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'flow-assign-a@bothub.test', password: 'AssignPass2026!' }
    });
    const loginBRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'flow-assign-b@bothub.test', password: 'AssignPass2026!' }
    });
    const tokenA = (loginARes.json() as { accessToken: string }).accessToken;
    const tokenB = (loginBRes.json() as { accessToken: string }).accessToken;

    const botARes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Empresa Alpha Bot', phoneNumber: '+18090001111', driver: 'CLOUD_API' }
    });
    const botBRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Empresa Beta Bot', phoneNumber: '+18090002222', driver: 'CLOUD_API' }
    });
    const botCrossRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Org Externa Bot', phoneNumber: '+18090003333', driver: 'CLOUD_API' }
    });

    const botA = (botARes.json() as { bot: { id: string; name: string } }).bot;
    const botB = (botBRes.json() as { bot: { id: string; name: string } }).bot;
    const botCross = (botCrossRes.json() as { bot: { id: string } }).bot;

    const createFlowRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Flujo Multi-Bot',
        description: 'Flujo reasignable',
        botId: botA.id,
        isMainMenu: true
      }
    });
    expect(createFlowRes.statusCode).toBe(201);
    const createdFlow = (
      createFlowRes.json() as {
        flow: { id: string; botId: string | null; versions?: unknown[] };
      }
    ).flow;
    expect(createdFlow.botId).toBe(botA.id);
    const initialVersionCount = createdFlow.versions?.length ?? 0;

    const reassignRes = await app.inject({
      method: 'PATCH',
      url: `/api/flows/${createdFlow.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { botId: botB.id }
    });
    expect(reassignRes.statusCode).toBe(200);
    const reassigned = (
      reassignRes.json() as {
        flow: {
          botId: string | null;
          botName: string | null;
          versions?: unknown[];
        };
      }
    ).flow;
    expect(reassigned.botId).toBe(botB.id);
    expect(reassigned.botName).toBe(botB.name);
    expect(reassigned.versions?.length ?? 0).toBe(initialVersionCount);

    const botAAfter = await app.inject({
      method: 'GET',
      url: `/api/bots/${botA.id}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const botBAfter = await app.inject({
      method: 'GET',
      url: `/api/bots/${botB.id}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(
      (botAAfter.json() as { bot: { activeFlowId: string | null } }).bot.activeFlowId
    ).toBeNull();
    expect(
      (botBAfter.json() as { bot: { activeFlowId: string | null } }).bot.activeFlowId
    ).toBe(createdFlow.id);

    const crossOrgRes = await app.inject({
      method: 'PATCH',
      url: `/api/flows/${createdFlow.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { botId: botCross.id }
    });
    expect(crossOrgRes.statusCode).toBe(404);

    const unassignRes = await app.inject({
      method: 'PATCH',
      url: `/api/flows/${createdFlow.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { botId: null }
    });
    expect(unassignRes.statusCode).toBe(200);
    const unassigned = (
      unassignRes.json() as { flow: { botId: string | null; botName: string | null } }
    ).flow;
    expect(unassigned.botId).toBeNull();
    expect(unassigned.botName).toBeNull();

    const botBUnassigned = await app.inject({
      method: 'GET',
      url: `/api/bots/${botB.id}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(
      (botBUnassigned.json() as { bot: { activeFlowId: string | null } }).bot
        .activeFlowId
    ).toBeNull();

    await app.close();
  });
});
