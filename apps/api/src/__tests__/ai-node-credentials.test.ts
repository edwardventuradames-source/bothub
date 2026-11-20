import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { provisionAdminAccountFromServer } from '../modules/auth/auth.service.js';

describe('AI Provider Credentials & AI_PROMPT Node Testing', () => {
  it('stores encrypted org AI credentials, isolates tenants, executes AI_PROMPT without env vars, and surfaces upstream errors', async () => {
    const app = await buildApp();

    await provisionAdminAccountFromServer({
      email: 'ai-admin-a@bothub.test',
      password: 'AiStrongPass2026!',
      name: 'AI Admin A',
      organizationName: 'AI Org A'
    });
    await provisionAdminAccountFromServer({
      email: 'ai-admin-b@bothub.test',
      password: 'AiStrongPass2026!',
      name: 'AI Admin B',
      organizationName: 'AI Org B'
    });

    const loginARes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ai-admin-a@bothub.test', password: 'AiStrongPass2026!' }
    });
    const loginBRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ai-admin-b@bothub.test', password: 'AiStrongPass2026!' }
    });
    const tokenA = (loginARes.json() as { accessToken: string }).accessToken;
    const tokenB = (loginBRes.json() as { accessToken: string }).accessToken;

    const createFlowRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Flujo IA Test', description: 'Pruebas AI_PROMPT' }
    });
    expect(createFlowRes.statusCode).toBe(201);
    const flowId = (createFlowRes.json() as { flow: { id: string } }).flow.id;

    const saveKeyRes = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai-providers',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        provider: 'openai',
        apiKey: 'sk-proj-orgA-secret-99887766'
      }
    });
    expect(saveKeyRes.statusCode).toBe(200);
    const savedBody = saveKeyRes.json() as {
      provider: { hasKey: boolean; maskedKey: string; source: string };
      aiProviders: Array<{ provider: string; hasKey: boolean; source: string }>;
    };
    expect(savedBody.provider.hasKey).toBe(true);
    expect(savedBody.provider.source).toBe('organization');
    expect(savedBody.provider.maskedKey).not.toContain('99887766');
    expect(JSON.stringify(savedBody)).not.toContain('sk-proj-orgA-secret-99887766');

    const saveGeminiRes = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai-providers',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        provider: 'gemini',
        apiKey: 'AIzaSyTestGeminiOrgA12345'
      }
    });
    expect(saveGeminiRes.statusCode).toBe(200);

    const orgBProvidersRes = await app.inject({
      method: 'GET',
      url: '/api/settings/ai-providers',
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(orgBProvidersRes.statusCode).toBe(200);
    const orgBOpenAi = (
      orgBProvidersRes.json() as { aiProviders: Array<{ provider: string; hasKey: boolean }> }
    ).aiProviders.find((p) => p.provider === 'openai');
    expect(orgBOpenAi?.hasKey).toBe(false);

    const prevEnvOpenAi = process.env.OPENAI_API_KEY;
    const prevEnvGemini = process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url, init) => {
        const urlStr = String(url);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (urlStr.includes('api.openai.com')) {
          expect(headers.Authorization).toBe('Bearer sk-proj-orgA-secret-99887766');
          const reqBody = JSON.parse(String(init?.body ?? '{}')) as { max_tokens?: number };
          expect(reqBody.max_tokens).toBe(256);
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Hola, soy tu asistente de ByteMV.' } }],
              usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('generativelanguage.googleapis.com')) {
          expect(headers['x-goog-api-key']).toBe('AIzaSyTestGeminiOrgA12345');
          expect(urlStr).toContain('gemini-3.8-flash:generateContent');
          return new Response(
            JSON.stringify({
              error: { message: 'API key expired. Please renew.' }
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const testOpenAiRes = await app.inject({
        method: 'POST',
        url: `/api/flows/${flowId}/test-ai`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          node: {
            id: 'ai-1',
            type: 'AI_PROMPT',
            position: { x: 0, y: 0 },
            data: {
              model: 'gpt-4o-mini',
              maxTokens: 256,
              systemPrompt: 'Responde corto a {{nombre}}.',
              userPrompt: 'Consulta de {{nombre}}'
            }
          },
          inputMessage: 'Hola',
          variables: { nombre: 'Edward' }
        }
      });

      expect(testOpenAiRes.statusCode).toBe(200);
      const openAiBody = testOpenAiRes.json() as {
        ok: boolean;
        provider: string;
        text: string;
        keySource: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
      };
      expect(openAiBody.ok).toBe(true);
      expect(openAiBody.provider).toBe('openai');
      expect(openAiBody.keySource).toBe('organization');
      expect(openAiBody.text).toBe('Hola, soy tu asistente de ByteMV.');
      expect(openAiBody.usage?.totalTokens).toBe(60);

      const budgetSetRes = await app.inject({
        method: 'PUT',
        url: '/api/settings/ai-budget',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { monthlyLimit: 50 }
      });
      expect(budgetSetRes.statusCode).toBe(200);
      const budgetSetBody = budgetSetRes.json() as {
        aiTokenBudget: { monthlyLimit: number; tokensUsed: number };
      };
      expect(budgetSetBody.aiTokenBudget.monthlyLimit).toBe(50);
      expect(budgetSetBody.aiTokenBudget.tokensUsed).toBe(60);

      const blockedByBudgetRes = await app.inject({
        method: 'POST',
        url: `/api/flows/${flowId}/test-ai`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          node: {
            id: 'ai-budget-block',
            type: 'AI_PROMPT',
            position: { x: 0, y: 0 },
            data: { model: 'gpt-4o-mini', maxTokens: 256, systemPrompt: 'Ayuda' }
          },
          inputMessage: 'Hola'
        }
      });
      expect(blockedByBudgetRes.statusCode).toBe(200);
      const blockedBody = blockedByBudgetRes.json() as { ok: boolean; errorMessage: string };
      expect(blockedBody.ok).toBe(false);
      expect(blockedBody.errorMessage).toContain('Límite mensual de tokens IA alcanzado');

      const budgetResetRes = await app.inject({
        method: 'PUT',
        url: '/api/settings/ai-budget',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { monthlyLimit: 1000, resetUsage: true }
      });
      expect(budgetResetRes.statusCode).toBe(200);
      expect(
        (budgetResetRes.json() as { aiTokenBudget: { tokensUsed: number } }).aiTokenBudget
          .tokensUsed
      ).toBe(0);

      const testGeminiRes = await app.inject({
        method: 'POST',
        url: `/api/flows/${flowId}/test-ai`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          node: {
            id: 'ai-2',
            type: 'AI_PROMPT',
            position: { x: 0, y: 0 },
            data: {
              model: 'gemini-2.5-flash',
              systemPrompt: 'Ayuda al cliente'
            }
          },
          inputMessage: 'Hola'
        }
      });

      expect(testGeminiRes.statusCode).toBe(200);
      const geminiBody = testGeminiRes.json() as {
        ok: boolean;
        provider: string;
        errorMessage: string;
      };
      expect(geminiBody.ok).toBe(false);
      expect(geminiBody.provider).toBe('gemini');
      expect(geminiBody.errorMessage).toContain('API key expired');
    } finally {
      globalThis.fetch = originalFetch;
      if (prevEnvOpenAi !== undefined) process.env.OPENAI_API_KEY = prevEnvOpenAi;
      if (prevEnvGemini !== undefined) process.env.GEMINI_API_KEY = prevEnvGemini;
    }

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/settings/ai-providers/openai',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(deleteRes.statusCode).toBe(200);
    const afterDelete = (
      deleteRes.json() as { aiProviders: Array<{ provider: string; hasKey: boolean }> }
    ).aiProviders.find((p) => p.provider === 'openai');
    expect(afterDelete?.hasKey).toBe(false);
  });

  it('retries transient HTTP 503 responses on Gemini 3.8 Flash and succeeds on recovery', async () => {
    const app = await buildApp();
    await provisionAdminAccountFromServer({
      email: 'ai-retry@bothub.test',
      password: 'AiRetryPass2026!',
      name: 'AI Retry Admin',
      organizationName: 'AI Retry Org'
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ai-retry@bothub.test', password: 'AiRetryPass2026!' }
    });
    const token = (loginRes.json() as { accessToken: string }).accessToken;

    const flowRes = await app.inject({
      method: 'POST',
      url: '/api/flows',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Flujo Retry Gemini', description: 'Retry 503' }
    });
    const flowId = (flowRes.json() as { flow: { id: string } }).flow.id;

    await app.inject({
      method: 'PUT',
      url: '/api/settings/ai-providers',
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: 'gemini', apiKey: 'AIzaSyRetryGeminiKey12345' }
    });

    const originalFetch = globalThis.fetch;
    let attempts = 0;
    vi.useFakeTimers();

    try {
      globalThis.fetch = (async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Respuesta recuperada con éxito' }] } }],
            usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10, totalTokenCount: 25 }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      const callPromise = app.inject({
        method: 'POST',
        url: `/api/flows/${flowId}/test-ai`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          node: {
            id: 'ai-retry-1',
            type: 'AI_PROMPT',
            position: { x: 0, y: 0 },
            data: { model: 'gemini-3.8-flash', systemPrompt: 'Responde breve' }
          },
          inputMessage: 'Hola'
        }
      });

      await vi.advanceTimersByTimeAsync(1500);
      const res = await callPromise;

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; text: string; usage?: { totalTokens: number } };
      expect(attempts).toBe(2);
      expect(body.ok).toBe(true);
      expect(body.text).toBe('Respuesta recuperada con éxito');
      expect(body.usage?.totalTokens).toBe(25);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = originalFetch;
    }
  });
});
