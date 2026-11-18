import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('BotHub Fastify App & Auth Endpoints', () => {
  it('returns healthy status from /api/health', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { status: string; service: string };
    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('bothub-api');
    await app.close();
  });

  it('validates login input payload with Zod and rejects malformed emails', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'not-an-email',
        password: 'short'
      }
    });

    expect(response.statusCode).toBe(400);
    const payload = response.json() as { error: string };
    expect(payload.error).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('protects /api/auth/me against unauthenticated requests', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me'
    });

    expect(response.statusCode).toBe(401);
    const payload = response.json() as { error: string };
    expect(payload.error).toBe('UNAUTHORIZED');
    await app.close();
  });
});
