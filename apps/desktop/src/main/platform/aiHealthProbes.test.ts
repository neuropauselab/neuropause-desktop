import { describe, expect, it } from 'vitest';
import { aiMemoryProbe, knowledgeGraphProbe, ollamaProbe } from './aiHealthProbes';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('ollamaProbe', () => {
  it('reports ok with the model count and latency when reachable', async () => {
    const probe = ollamaProbe({
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: async () => jsonResponse(200, { models: [{}, {}, {}] }),
    });
    const check = await probe();
    expect(check).toMatchObject({ id: 'ai.ollama', status: 'ok' });
    expect(check.detail).toContain('3 model(s)');
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports degraded on a non-2xx response', async () => {
    const probe = ollamaProbe({
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: async () => jsonResponse(500, {}),
    });
    const check = await probe();
    expect(check.status).toBe('degraded');
    expect(check.detail).toContain('HTTP 500');
  });

  it('reports down with the ollama serve hint when unreachable', async () => {
    const probe = ollamaProbe({
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const check = await probe();
    expect(check.status).toBe('down');
    expect(check.recommendation).toContain('ollama serve');
  });
});

describe('store probes', () => {
  it('aiMemoryProbe reports the indexed total', async () => {
    const check = await aiMemoryProbe(() => 12)();
    expect(check).toMatchObject({ id: 'ai.memory', status: 'ok' });
    expect(check.detail).toContain('12');
  });

  it('knowledgeGraphProbe reports node and edge counts', async () => {
    const check = await knowledgeGraphProbe(() => ({ nodes: 30, edges: 12 }))();
    expect(check).toMatchObject({ id: 'ai.graph', status: 'ok' });
    expect(check.detail).toContain('30 node(s)');
    expect(check.detail).toContain('12 edge(s)');
  });

  it('a throwing getter turns into a down check, never a crash', async () => {
    const check = await aiMemoryProbe(() => {
      throw new Error('store offline');
    })();
    expect(check.status).toBe('down');
    expect(check.detail).toBe('store offline');
  });
});
