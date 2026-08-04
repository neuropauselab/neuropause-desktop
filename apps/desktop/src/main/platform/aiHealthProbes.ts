/**
 * AI health probes for the existing diagnostics framework — read-only checks over
 * subsystems that already exist (no new AI capability). Dependencies are injected
 * so each probe is unit-testable: the Ollama probe takes a base URL + fetch, the
 * store probes take narrow count getters (the wiring adapts the real stores).
 */
import type { RetrievalHealthSnapshot } from '@neuropause/shared';
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

/**
 * Semantic retrieval health (A6). Projects the live `RetrievalHealthTracker`
 * snapshot — the breaker state and the observed counters — into the existing
 * diagnostics report. Before A6 there was no retrieval probe at all: a dead
 * Qdrant or an expired session showed up only as recall quietly getting worse.
 *
 * It never reports `down` for a retrieval *outcome*, only ever `degraded`. That
 * is not softening: `down` is the aggregator's worst rank and would drag the
 * whole report down, while a suspended semantic leg still leaves memory search
 * fully answering from the lexical retriever. `down` is reserved for the probe
 * being unable to read health at all, which is a genuine defect — the same line
 * the two probes above draw.
 */
export function retrievalProbe(getHealth: () => RetrievalHealthSnapshot): DiagnosticProbe {
  const ID = 'ai.retrieval';
  const LABEL = 'Semantic retrieval';
  return () => {
    let health: RetrievalHealthSnapshot;
    try {
      health = getHealth();
    } catch (err) {
      return makeCheck(ID, LABEL, 'down', {
        detail: (err as Error).message || 'Retrieval health unavailable',
        recommendation: 'The retrieval health tracker failed to answer; check the main-process logs.',
      });
    }

    const { breaker, consecutiveFailures, retryAt, lastOutcome, totals, avgSuccessLatencyMs } =
      health;
    const served = `${totals.successes}/${totals.attempts} call(s) succeeded`;
    const latency = avgSuccessLatencyMs === null ? '' : ` · avg ${avgSuccessLatencyMs} ms`;

    if (breaker !== 'closed') {
      return makeCheck(ID, LABEL, 'degraded', {
        detail: `Suspended after ${consecutiveFailures} consecutive failure(s) · ${served}`,
        latencyMs: avgSuccessLatencyMs,
        recommendation:
          breaker === 'open'
            ? `Recall is keyword-only until the semantic source is retried${retryAt ? ` at ${retryAt}` : ''}. Check the backend semantic API and the vector store.`
            : 'Recall is keyword-only; the next search will trial the semantic source.',
      });
    }

    if (lastOutcome?.state === 'failed') {
      return makeCheck(ID, LABEL, 'degraded', {
        detail: `Last semantic call failed (${lastOutcome.kind}): ${lastOutcome.detail}`,
        latencyMs: lastOutcome.latencyMs,
        recommendation: lastOutcome.retryable
          ? 'Transient so far — the breaker will suspend the semantic leg if it keeps failing.'
          : 'This will not fix itself: re-authenticate, or check the query the backend rejected.',
      });
    }

    if (totals.successes > 0) {
      return makeCheck(ID, LABEL, 'ok', {
        detail: `Hybrid recall active · ${served}${latency}`,
        latencyMs: avgSuccessLatencyMs,
      });
    }

    // Nothing has served yet. `unknown` rather than `ok`, because claiming health
    // for a leg that has never run is exactly the false reassurance A6 removes.
    return makeCheck(ID, LABEL, 'unknown', {
      detail:
        lastOutcome?.state === 'skipped'
          ? `Not exercised · last recall skipped semantic (${lastOutcome.reason})`
          : 'No semantic retrieval attempted yet',
      recommendation:
        lastOutcome?.state === 'skipped' && lastOutcome.reason === 'not_configured'
          ? 'No semantic source is wired in this build; recall is keyword-only by design.'
          : null,
    });
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
