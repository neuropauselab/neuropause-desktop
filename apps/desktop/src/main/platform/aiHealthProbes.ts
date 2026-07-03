/**
 * AI health probes for the existing diagnostics framework — read-only checks over
 * subsystems that already exist (no new AI capability). Dependencies are injected
 * so each probe is unit-testable: the Ollama probe takes a base URL + fetch, the
 * store probes take narrow count getters (the wiring adapts the real stores).
 */
import { makeCheck, type DiagnosticProbe } from './diagnostics';

export function ollamaProbe(deps: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): DiagnosticProbe {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 2500;
  return async () => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${deps.baseUrl}/api/tags`, { signal: controller.signal });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return makeCheck('ai.ollama', 'Local AI engine (Ollama)', 'degraded', {
          detail: `Responded with HTTP ${res.status}`,
          latencyMs,
          recommendation: 'The Ollama server answered abnormally; consider restarting it.',
        });
      }
      const body = (await res.json().catch(() => ({}))) as { models?: unknown[] };
      const models = Array.isArray(body.models) ? body.models.length : 0;
      return makeCheck('ai.ollama', 'Local AI engine (Ollama)', 'ok', {
        detail: `Reachable · ${models} model(s) available`,
        latencyMs,
      });
    } catch (err) {
      return makeCheck('ai.ollama', 'Local AI engine (Ollama)', 'down', {
        detail: (err as Error).message || 'Unreachable',
        latencyMs: Date.now() - started,
        recommendation: `Could not reach Ollama at ${deps.baseUrl}. Try: ollama serve`,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

export function aiMemoryProbe(getTotal: () => number): DiagnosticProbe {
  return () => {
    try {
      const total = getTotal();
      return makeCheck('ai.memory', 'AI memory', 'ok', {
        detail: `${total} memory item(s) indexed`,
      });
    } catch (err) {
      return makeCheck('ai.memory', 'AI memory', 'down', {
        detail: (err as Error).message || 'Store unavailable',
        recommendation: 'The memory store failed to answer; check the main-process logs.',
      });
    }
  };
}

export function knowledgeGraphProbe(
  getCounts: () => { nodes: number; edges: number },
): DiagnosticProbe {
  return () => {
    try {
      const c = getCounts();
      return makeCheck('ai.graph', 'Knowledge graph', 'ok', {
        detail: `${c.nodes} node(s) · ${c.edges} edge(s)`,
      });
    } catch (err) {
      return makeCheck('ai.graph', 'Knowledge graph', 'down', {
        detail: (err as Error).message || 'Store unavailable',
        recommendation: 'The graph store failed to answer; check the main-process logs.',
      });
    }
  };
}
