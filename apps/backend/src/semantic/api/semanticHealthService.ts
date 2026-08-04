/**
 * Semantic health aggregation (V8.2 Part 2 inc3). Reports whether the semantic
 * stack is operational: the embedding provider reachable, Qdrant reachable, and
 * how much of an org's memory is embedded (coverage). Pure and dependency-injected
 * so it unit-tests without live infra; each probe is isolated so one failing check
 * never masks the others, and an overall `healthy` flag summarizes provider+store.
 */
import type { Embedding, EmbeddingVersion } from '../embedding/embeddingTypes';

/** Which isolated probe failed — the argument to `onProbeFailure`. */
export type SemanticHealthProbe = 'provider' | 'vectorStore' | 'coverage';

export interface SemanticHealthDeps {
  embeddingProvider: { version: EmbeddingVersion; embed(text: string): Promise<Embedding> };
  vectorStore: { health(): Promise<{ ok: boolean }> };
  /** embedded vs total memories for the org (backend counts embedded; total may be supplied by the caller). */
  getCoverage: (orgId: string) => Promise<{ embedded: number; total: number }>;
  /**
   * Notified with the *raw* failure whenever a probe fails, so the detail this
   * function deliberately keeps out of its result still reaches an operator.
   *
   * A callback rather than a logger import so the module stays pure and unit-
   * testable without infra, matching how the desktop's resilient retrieval path
   * surfaces its failures (`resilientSemanticSearch`'s `onOutcome`,
   * `memory/index.ts`'s `onSemanticError`). The router supplies the logger.
   */
  onProbeFailure?: (probe: SemanticHealthProbe, err: unknown) => void;
}

export interface SemanticHealthResult {
  provider: { ok: boolean; model: string; dimensions: number; error?: string };
  vectorStore: { ok: boolean; error?: string };
  coverage: { embedded: number; total: number; percent: number };
  /** provider AND vector store both reachable. */
  healthy: boolean;
  checkedAt: string;
}

const PROBE = 'health probe';

/**
 * A stable, client-safe classifier for a failed probe — never the raw message.
 *
 * This response goes to any *member* of the org, and the upstream messages are
 * not member-safe: `embeddingHttp.ts` builds them as `HTTP ${status} from ${url}:
 * ${detail}` and `Request to ${url} failed: ${e.message}`, so the raw text carries
 * the embedding provider's base URL (an internal host for a self-hosted Ollama)
 * and the upstream response body verbatim. Returning `err.code` instead gives an
 * operator everything actionable — `provider_unavailable` vs `config_invalid` vs
 * `invalid_response` are different problems with different fixes — while the
 * URL and body go to `onProbeFailure`, which is server-side.
 *
 * The code is read structurally rather than via `instanceof EmbeddingError`, so
 * an injected provider from another layer that follows the same
 * `{ code }` convention (`QdrantError`, `SemanticError`) classifies correctly
 * without this module importing all of them.
 */
function classifyProbeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'probe_failed';
}

export async function semanticHealth(deps: SemanticHealthDeps, orgId: string): Promise<SemanticHealthResult> {
  const version = deps.embeddingProvider.version;

  // Probe 1: embedding provider (isolated).
  let provider: SemanticHealthResult['provider'];
  try {
    await deps.embeddingProvider.embed(PROBE);
    provider = { ok: true, model: version.model, dimensions: version.dimensions };
  } catch (err) {
    deps.onProbeFailure?.('provider', err);
    provider = {
      ok: false,
      model: version.model,
      dimensions: version.dimensions,
      error: classifyProbeError(err),
    };
  }

  // Probe 2: vector store (isolated).
  let vectorStore: SemanticHealthResult['vectorStore'];
  try {
    const h = await deps.vectorStore.health();
    vectorStore = { ok: h.ok };
  } catch (err) {
    deps.onProbeFailure?.('vectorStore', err);
    vectorStore = { ok: false, error: classifyProbeError(err) };
  }

  // Coverage (isolated).
  let coverage: SemanticHealthResult['coverage'];
  try {
    const c = await deps.getCoverage(orgId);
    const total = Math.max(0, c.total);
    const embedded = Math.max(0, Math.min(c.embedded, total || c.embedded));
    coverage = { embedded, total, percent: total > 0 ? Math.round((embedded / total) * 100) : 100 };
  } catch (err) {
    deps.onProbeFailure?.('coverage', err);
    coverage = { embedded: 0, total: 0, percent: 0 };
  }

  return {
    provider,
    vectorStore,
    coverage,
    healthy: provider.ok && vectorStore.ok,
    checkedAt: new Date().toISOString(),
  };
}
