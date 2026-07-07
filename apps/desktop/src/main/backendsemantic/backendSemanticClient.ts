/**
 * BackendSemanticClient (V8.2 Part 2). Implements the desktop's `SemanticSearchFn`
 * by calling the authenticated backend semantic API — the desktop never talks to
 * Qdrant or an embedding provider directly (backend-only, per Part 1). Mirrors
 * catalogClient: access token via authService, `config.backendUrl`, structured
 * error on non-2xx.
 *
 * The token getter and fetch are injected, so the request/parse/error logic is
 * unit-testable with mocks; the singleton binding at the bottom wires the real
 * authService/config/fetch (verified by the gate, not the sandbox).
 */
import type { RetrievalHit } from '../memory/memoryHybridSearch';
import type { SemanticSearchFn, SemanticSearchRequest } from '../memory/memorySemanticRecall';

export class BackendSemanticError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackendSemanticError';
  }
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export interface BackendSemanticDeps {
  backendUrl: string;
  getValidAccessToken: () => Promise<string | null>;
  fetchFn: FetchLike;
}

/** Build a SemanticSearchFn that queries POST /memory/semantic/:orgId/search. */
export function createBackendSemanticSearch(deps: BackendSemanticDeps): SemanticSearchFn {
  return async (query: SemanticSearchRequest): Promise<RetrievalHit[]> => {
    const token = await deps.getValidAccessToken();
    if (!token) {
      throw new BackendSemanticError(401, 'not_authenticated', 'Sign in to use semantic search.');
    }

    const url = `${deps.backendUrl}/memory/semantic/${encodeURIComponent(query.orgId)}/search`;
    let res: FetchResponse;
    try {
      res = await deps.fetchFn(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: query.text, limit: query.topK }),
      });
    } catch (err) {
      throw new BackendSemanticError(0, 'network_error', (err as Error).message || 'Network request failed');
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;

    if (!res.ok) {
      const body = (json ?? {}) as { error?: { code?: string; message?: string } };
      throw new BackendSemanticError(
        res.status,
        body.error?.code ?? 'request_failed',
        body.error?.message ?? `Semantic search failed with status ${res.status}`,
      );
    }

    return parseHits(json);
  };
}

/** Map the API's `{ orgId, hits: [{ memoryId, score, payload }] }` to RetrievalHit[]. */
function parseHits(json: unknown): RetrievalHit[] {
  const hits = (json as { hits?: unknown } | undefined)?.hits;
  if (!Array.isArray(hits)) return [];
  const out: RetrievalHit[] = [];
  for (const h of hits) {
    const row = h as { memoryId?: unknown; score?: unknown };
    if (typeof row.memoryId === 'string' && typeof row.score === 'number') {
      out.push({ memoryId: row.memoryId, score: row.score });
    }
  }
  return out;
}
