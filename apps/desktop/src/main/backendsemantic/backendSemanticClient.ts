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
import type {
  SemanticSearchFn,
  SemanticSearchOptions,
  SemanticSearchRequest,
} from '../memory/memorySemanticRecall';
import { isAbortError } from '../memory/semanticFailure';

/**
 * An HTTP-level semantic failure: the status the backend gave and the error code
 * from its body. It deliberately carries no `kind`/`retryable` verdict of its own —
 * `classifySemanticError` (`memory/semanticFailure.ts`) is the single place that
 * maps status → kind, and a second copy on this class would be two sources of
 * truth for the same table. This throws the *facts*; that module renders the verdict.
 */
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
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    /**
     * Forwarded from `SemanticSearchOptions.signal` (A6). Before A6 nothing in this
     * chain carried a deadline, so a black-holed connection held the recall open
     * until the 30 s IPC timeout at `secureBridge.ts:26`; now the socket is released
     * when the caller's deadline elapses.
     */
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

export interface BackendSemanticDeps {
  backendUrl: string;
  getValidAccessToken: () => Promise<string | null>;
  fetchFn: FetchLike;
}

/** Build a SemanticSearchFn that queries POST /memory/semantic/:orgId/search. */
export function createBackendSemanticSearch(deps: BackendSemanticDeps): SemanticSearchFn {
  return async (
    query: SemanticSearchRequest,
    options?: SemanticSearchOptions,
  ): Promise<RetrievalHit[]> => {
    // Already cancelled: don't spend a token refresh or a socket on a dead call.
    options?.signal?.throwIfAborted();

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
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new BackendSemanticError(
        0,
        'network_error',
        (err as Error).message || 'Network request failed',
      );
    }

    // Reading the body can fail independently of the request: a connection dropped
    // mid-response, or the deadline elapsing between headers and body.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new BackendSemanticError(
        0,
        'network_error',
        (err as Error).message || 'Response body could not be read',
      );
    }

    if (!res.ok) {
      // The status is authoritative here, so an unreadable error body must not
      // mask it: a proxy's HTML 502 is a retryable outage, and parsing it before
      // the status check (as this did pre-A6) surfaced a bare `SyntaxError`
      // instead — read downstream as a permanent, non-retryable malformed response.
      const body = parseErrorBody(text);
      throw new BackendSemanticError(
        res.status,
        body.code ?? 'request_failed',
        body.message ?? `Semantic search failed with status ${res.status}`,
      );
    }

    // On a 2xx the body must parse. A `SyntaxError` escaping here is the honest
    // signal — `classifySemanticError` reads it as `malformed_response`, which is
    // exactly what a success status carrying an unreadable payload is.
    return parseHits(text ? (JSON.parse(text) as unknown) : undefined);
  };
}

/** Best-effort read of the API's `{ error: { code, message } }` envelope. */
function parseErrorBody(text: string): { code?: string; message?: string } {
  if (!text) return {};
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return {};
  }
  const error = (json as { error?: unknown } | null)?.error;
  if (typeof error !== 'object' || error === null) return {};
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof message === 'string' ? { message } : {}),
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
