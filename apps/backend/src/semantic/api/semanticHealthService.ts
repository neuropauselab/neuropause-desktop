/**
 * Semantic health aggregation (V8.2 Part 2 inc3). Reports whether the semantic
 * stack is operational: the embedding provider reachable, Qdrant reachable, and
 * how much of an org's memory is embedded (coverage). Pure and dependency-injected
 * so it unit-tests without live infra; each probe is isolated so one failing check
 * never masks the others, and an overall `healthy` flag summarizes provider+store.
 */
import type { Embedding, EmbeddingVersion } from '../embedding/embeddingTypes';

export interface SemanticHealthDeps {
  embeddingProvider: { version: EmbeddingVersion; embed(text: string): Promise<Embedding> };
  vectorStore: { health(): Promise<{ ok: boolean }> };
  /** embedded vs total memories for the org (backend counts embedded; total may be supplied by the caller). */
  getCoverage: (orgId: string) => Promise<{ embedded: number; total: number }>;
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

export async function semanticHealth(deps: SemanticHealthDeps, orgId: string): Promise<SemanticHealthResult> {
  const version = deps.embeddingProvider.version;

  // Probe 1: embedding provider (isolated).
  let provider: SemanticHealthResult['provider'];
  try {
    await deps.embeddingProvider.embed(PROBE);
    provider = { ok: true, model: version.model, dimensions: version.dimensions };
  } catch (err) {
    provider = {
      ok: false,
      model: version.model,
      dimensions: version.dimensions,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Probe 2: vector store (isolated).
  let vectorStore: SemanticHealthResult['vectorStore'];
  try {
    const h = await deps.vectorStore.health();
    vectorStore = { ok: h.ok };
  } catch (err) {
    vectorStore = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Coverage (isolated).
  let coverage: SemanticHealthResult['coverage'];
  try {
    const c = await deps.getCoverage(orgId);
    const total = Math.max(0, c.total);
    const embedded = Math.max(0, Math.min(c.embedded, total || c.embedded));
    coverage = { embedded, total, percent: total > 0 ? Math.round((embedded / total) * 100) : 100 };
  } catch {
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
