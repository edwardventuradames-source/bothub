import crypto from 'node:crypto';
import net from 'node:net';
import { io as ioClient } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { safeRegexTest } from '../lib/safe-regex.js';
import { runtimeStore } from '../lib/runtime-store.js';
import {
  assertSafeExternalUrl,
  isPrivateOrReservedIp
} from '../lib/ssrf-guard.js';
import {
  isAccessTokenValidForUser,
  provisionAdminAccountFromServer
} from '../modules/auth/auth.service.js';
import { ChatwootService } from '../modules/chatwoot/chatwoot.service.js';
import { attachSocketServer } from '../plugins/socket.js';

describe('AppSec & OWASP Top 10 Security Audit Suite', () => {
  it('blocks private, loopback, metadata, and IPv4-mapped IPv6 addresses in SSRF guard', async () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:0:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('64:ff9b::127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('2002:7f00:1::')).toBe(true);
    expect(isPrivateOrReservedIp('2001:db8::1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);

    const blockedUrls = [
      'http://127.0.0.1:4000/api/health',
      'http://[::ffff:127.0.0.1]:4000/api/health',
      'http://[::ffff:0:127.0.0.1]:4000/',
      'http://[64:ff9b::127.0.0.1]/',
      'http://[2002:7f00:1::]/',
      'http://[::1]:5432/',
      'http://localhost/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://2130706433/',
      'http://0x7f000001/',
      'https://user:pass@8.8.8.8/',
      'https://nonexistent.invalid.bothub.tld/',
      'file:///etc/passwd',
      'ftp://files.example.com/data'
    ];

    for (const url of blockedUrls) {
      await expect(assertSafeExternalUrl(url)).rejects.toThrow();
    }

    await expect(
      assertSafeExternalUrl('https://chatwoot.local/api', { allowSimulatedLocal: true })
    ).resolves.toBeInstanceOf(URL);
  });

  it('prevents ReDoS payloads in safeRegexTest while evaluating valid regexes', () => {
    expect(safeRegexTest('(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(false);
    expect(safeRegexTest('a.*b.*c', 'alpha beta gamma')).toBe(false);
    expect(safeRegexTest('a'.repeat(130), 'aaa')).toBe(false);
    expect(safeRegexTest('^hola\\s+mundo$', 'Hola   Mundo')).toBe(true);
  });

  it('enforces Helmet security headers, strict CORS, JWT revocation on logout/suspension, and login rate limit', async () => {
    const app = await buildApp();
    await provisionAdminAccountFromServer({
      email: 'sec-admin@bothub.test',
      password: 'SecAdminPass2026!',
      name: 'Security Admin',
      organizationName: 'Sec Org A'
    });

    const healthRes = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil-attacker.example' }
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers['x-frame-options']).toBe('DENY');
    expect(healthRes.headers['access-control-allow-origin']).not.toBe('*');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'sec-admin@bothub.test',
        password: 'SecAdminPass2026!'
      }
    });
    expect(loginRes.statusCode).toBe(200);
    const { accessToken, refreshToken } = loginRes.json() as {
      accessToken: string;
      refreshToken: string;
    };

    const meBefore = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(meBefore.statusCode).toBe(200);

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken }
    });
    expect(logoutRes.statusCode).toBe(200);

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(meAfterLogout.statusCode).toBe(401);

    const login2 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'sec-admin@bothub.test',
        password: 'SecAdminPass2026!'
      }
    });
    const adminToken2 = (login2.json() as { accessToken: string }).accessToken;

    const createOp = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${adminToken2}` },
      payload: {
        name: 'Operator Temp',
        email: 'sec-op@bothub.test',
        password: 'OpPassword2026!',
        role: 'OPERATOR'
      }
    });
    expect(createOp.statusCode).toBe(201);
    const opUser = (createOp.json() as { user: { id: string } }).user;

    const opLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'sec-op@bothub.test',
        password: 'OpPassword2026!'
      }
    });
    const opToken = (opLogin.json() as { accessToken: string }).accessToken;

    const suspendRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${opUser.id}`,
      headers: { authorization: `Bearer ${adminToken2}` },
      payload: { isActive: false }
    });
    expect(suspendRes.statusCode).toBe(200);

    const opMeAfterSuspend = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${opToken}` }
    });
    expect(opMeAfterSuspend.statusCode).toBe(401);
    expect(await isAccessTokenValidForUser({ sub: 'unknown-ghost-sub' })).toBe(false);

    const usersListRes = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${adminToken2}` }
    });
    expect(usersListRes.statusCode).toBe(200);
    const listedUsers = (
      usersListRes.json() as {
        users: Array<{
          id: string;
          isActive: boolean;
          tokenVersion?: number;
          passwordHash?: string;
        }>;
      }
    ).users;
    expect(listedUsers[0]?.tokenVersion).toBeUndefined();
    expect(listedUsers[0]?.passwordHash).toBeUndefined();
    const suspendedListed = listedUsers.find((u) => u.id === opUser.id);
    expect(suspendedListed?.isActive).toBe(false);

    const suspendedRelogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'sec-op@bothub.test',
        password: 'OpPassword2026!'
      }
    });
    expect(suspendedRelogin.statusCode).toBe(401);

    let got429 = false;
    for (let i = 0; i < 14; i += 1) {
      const attempt = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.77',
        payload: {
          email: 'sec-admin@bothub.test',
          password: 'WrongPassword123!'
        }
      });
      if (attempt.statusCode === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);

    await app.close();
  });

  it('enforces multi-tenant isolation (IDOR prevention), RBAC permissions, API key hashing, and webhook SSRF blocking', async () => {
    const app = await buildApp();
    await provisionAdminAccountFromServer({
      email: 'org-a-admin@bothub.test',
      password: 'OrgAPassword2026!',
      name: 'Org A Admin',
      organizationName: 'Organization Alpha'
    });
    await provisionAdminAccountFromServer({
      email: 'org-b-admin@bothub.test',
      password: 'OrgBPassword2026!',
      name: 'Org B Admin',
      organizationName: 'Organization Beta'
    });

    const loginA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'org-a-admin@bothub.test',
        password: 'OrgAPassword2026!'
      }
    });
    const tokenA = (loginA.json() as { accessToken: string }).accessToken;

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'org-b-admin@bothub.test',
        password: 'OrgBPassword2026!'
      }
    });
    const tokenB = (loginB.json() as { accessToken: string }).accessToken;

    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Viewer Alpha',
        email: 'org-a-viewer@bothub.test',
        password: 'ViewerPassword2026!',
        role: 'VIEWER'
      }
    });
    const loginViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'org-a-viewer@bothub.test',
        password: 'ViewerPassword2026!'
      }
    });
    const tokenViewer = (loginViewer.json() as { accessToken: string }).accessToken;

    const botRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Alpha Secret Bot',
        driver: 'CHATWOOT'
      }
    });
    expect(botRes.statusCode).toBe(201);
    const botA = (botRes.json() as { bot: { id: string } }).bot;

    const ssrfCw = await app.inject({
      method: 'PUT',
      url: `/api/bots/${botA.id}/chatwoot`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        baseUrl: 'http://[::ffff:127.0.0.1]:4000',
        accountId: 1,
        inboxId: 1,
        apiAccessToken: 'cw_token_123456'
      }
    });
    expect(ssrfCw.statusCode).toBe(400);
    expect((ssrfCw.json() as { error: string }).error).toBe('SSRF_BLOCKED');

    const ssrfWh = await app.inject({
      method: 'POST',
      url: '/api/settings/webhooks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'SSRF Hook',
        targetUrl: 'http://127.0.0.1:4000/api/health',
        events: ['handoff.triggered'],
        secretToken: 'wh_secret_12345678'
      }
    });
    expect(ssrfWh.statusCode).toBe(400);
    expect((ssrfWh.json() as { error: string }).error).toBe('SSRF_BLOCKED');

    const keyRes = await app.inject({
      method: 'POST',
      url: '/api/settings/api-keys',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Alpha Prod Key',
        scopes: ['bots:read']
      }
    });
    expect(keyRes.statusCode).toBe(201);
    const createdKey = (keyRes.json() as { apiKey: { id: string; rawKeyPreview?: string } }).apiKey;
    expect(createdKey.rawKeyPreview).toMatch(/^bh_live_/);

    const overviewA = await app.inject({
      method: 'GET',
      url: '/api/settings/overview',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(overviewA.statusCode).toBe(200);
    const keyInOverview = (
      overviewA.json() as { apiKeys: Array<{ id: string; rawKeyPreview?: string }> }
    ).apiKeys.find((k) => k.id === createdKey.id);
    expect(keyInOverview).toBeDefined();
    expect(keyInOverview?.rawKeyPreview).toBeUndefined();

    const overviewViewer = await app.inject({
      method: 'GET',
      url: '/api/settings/overview',
      headers: { authorization: `Bearer ${tokenViewer}` }
    });
    expect(overviewViewer.statusCode).toBe(403);

    const idorBot = await app.inject({
      method: 'GET',
      url: `/api/bots/${botA.id}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(idorBot.statusCode).toBe(404);

    const idorDelKey = await app.inject({
      method: 'DELETE',
      url: `/api/settings/api-keys/${createdKey.id}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(idorDelKey.statusCode).toBe(404);

    const logsB = await app.inject({
      method: 'GET',
      url: '/api/logs',
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(logsB.statusCode).toBe(200);
    const leakedLog = (logsB.json() as { logs: Array<{ botId: string | null }> }).logs.find(
      (l) => l.botId === botA.id
    );
    expect(leakedLog).toBeUndefined();

    const flowBRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Beta Flow', isMainMenu: true }
    });
    const flowB = (flowBRes.json() as { flow: { id: string } }).flow;

    const crossCreateFlowRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Beta Cross Create', botId: botA.id, isMainMenu: false }
    });
    expect(crossCreateFlowRes.statusCode).toBe(404);

    const crossBotLinkRes = await app.inject({
      method: 'PUT',
      url: `/api/flows/${flowB.id}/graph`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { botId: botA.id, nodes: [], edges: [], publish: false }
    });
    expect(crossBotLinkRes.statusCode).toBe(404);

    const flowARes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Alpha Flow', isMainMenu: true }
    });
    const flowAId = (flowARes.json() as { flow: { id: string } }).flow.id;
    const viewerSimulate = await app.inject({
      method: 'POST',
      url: `/api/flows/${flowAId}/simulate`,
      headers: { authorization: `Bearer ${tokenViewer}` },
      payload: { inputMessage: 'hola', variables: {}, tags: [] }
    });
    expect(viewerSimulate.statusCode).toBe(403);

    await app.close();
  });

  it('rejects missing/spoofed Chatwoot webhook tokens and requires Cloud HMAC in production', async () => {
    const app = await buildApp();
    const botId = `bot-cw-sec-${crypto.randomUUID().slice(0, 6)}`;
    runtimeStore.bots.push({
      id: botId,
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'Chatwoot Strict Bot',
      description: 'Webhook security test',
      phoneNumber: 'Chatwoot',
      driver: 'CHATWOOT',
      status: 'CONNECTED',
      isActive: true,
      activeFlowId: null,
      activeFlowName: null,
      timezone: 'America/Bogota',
      businessHoursEnabled: false,
      outOfHoursMessage: 'Cerrado',
      inactivityTimeoutMinutes: 15,
      inactivityCloseMessage: 'Fin',
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
      baseUrl: 'https://chat.example.com',
      accountId: 77,
      inboxId: 88,
      apiAccessToken: 'cw_secret_api_access_123',
      webhookToken: 'whsec_strict_only_this_token',
      handoffReturnCommand: '#bot',
      isActive: true
    });

    const missingTokenRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/chatwoot/${botId}`,
      payload: {
        event: 'message_created',
        message_type: 'incoming',
        content: 'hola',
        account: { id: 77 },
        inbox: { id: 88 },
        conversation: { id: 500 }
      }
    });
    expect(missingTokenRes.statusCode).toBe(401);

    const apiTokenAsWebhookRes = await app.inject({
      method: 'POST',
      url: `/api/webhooks/chatwoot/${botId}`,
      headers: {
        'x-chatwoot-webhook-token': 'cw_secret_api_access_123'
      },
      payload: {
        event: 'message_created',
        message_type: 'incoming',
        content: 'hola',
        conversation: { id: 501 }
      }
    });
    expect(apiTokenAsWebhookRes.statusCode).toBe(401);

    const cloudBotId = `bot-cloud-prod-${crypto.randomUUID().slice(0, 6)}`;
    runtimeStore.bots.push({
      id: cloudBotId,
      organizationId: '00000000-0000-4000-8000-000000000100',
      name: 'Cloud Prod Sec Bot',
      description: 'Cloud webhook sec',
      phoneNumber: '+573001119999',
      driver: 'CLOUD_API',
      status: 'CONNECTED',
      isActive: true,
      activeFlowId: null,
      activeFlowName: null,
      timezone: 'America/Bogota',
      businessHoursEnabled: false,
      outOfHoursMessage: 'Cerrado',
      inactivityTimeoutMinutes: 15,
      inactivityCloseMessage: 'Fin',
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
    runtimeStore.saveCloudApiConfigForBot(cloudBotId, {
      phoneNumberId: '1122334455',
      wabaId: '9988776655',
      accessToken: 'EAAG_TEST_TOKEN_SECRET',
      verifyToken: 'verify_prod_test'
    });

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const unsignedProdRes = await app.inject({
        method: 'POST',
        url: `/api/webhooks/whatsapp-cloud/${cloudBotId}`,
        payload: {
          entry: []
        }
      });
      expect(unsignedProdRes.statusCode).toBe(401);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }

    await app.close();
  });

  it('rejects unauthenticated Socket.IO clients and allows authenticated org connections', async () => {
    const app = await buildApp();
    attachSocketServer(app);
    await provisionAdminAccountFromServer({
      email: 'ws-admin@bothub.test',
      password: 'WsPassword2026!',
      name: 'WS Admin',
      organizationName: 'WS Org'
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const parsedUrl = new URL(address);
    const baseUrl = `http://127.0.0.1:${parsedUrl.port}`;
    expect(net.isIP('127.0.0.1')).toBe(4);

    await expect(
      new Promise<void>((resolve, reject) => {
        const unauthClient = ioClient(baseUrl, {
          path: '/socket.io',
          transports: ['websocket'],
          reconnection: false
        });
        unauthClient.on('connect', () => {
          unauthClient.disconnect();
          resolve();
        });
        unauthClient.on('connect_error', (err) => {
          unauthClient.disconnect();
          reject(err);
        });
      })
    ).rejects.toThrow(/UNAUTHORIZED/);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'ws-admin@bothub.test',
        password: 'WsPassword2026!'
      }
    });
    const token = (loginRes.json() as { accessToken: string }).accessToken;

    await expect(
      new Promise<void>((resolve, reject) => {
        const authClient = ioClient(baseUrl, {
          path: '/socket.io',
          auth: { token },
          transports: ['websocket'],
          reconnection: false
        });
        authClient.on('connect', () => {
          authClient.disconnect();
          resolve();
        });
        authClient.on('connect_error', (err) => {
          authClient.disconnect();
          reject(err);
        });
      })
    ).resolves.toBeUndefined();

    await app.close();
  });
});
