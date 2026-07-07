/**
 * BackendBackfillClient (V8.2 Part 2 inc3b). Posts memory batches to the backend
 * backfill endpoint, which embeds them into org-scoped Qdrant vectors. Mirrors
 * backendSemanticClient: authService token, config.backendUrl, structured error.
 * The token getter + fetch are injected so the request/parse logic is testable;
 * the singleton binding lives in backendBackfillInstance.ts.
 */
import type { FetchLike, FetchResponse } from './backendSemanticClient';

export class BackendBackfillError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackendBackfillError';
  }
}

export interface BackfillResult {
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

export interface BackendBackfillDeps {
  backendUrl: string;
  getValidAccessToken: () => Promise<string | null>;
  fetchFn: FetchLike;
}

export type BackfillFn = (
  orgId: string,
  memories: Array<{ memoryId: string; content: string }>,
) => Promise<BackfillResult>;

export function createBackendBackfill(deps: BackendBackfillDeps): BackfillFn {
  return async (orgId, memories) => {
    const token = await deps.getValidAccessToken();
    if (!token) {
      throw new BackendBackfillError(401, 'not_authenticated', 'Sign in to back up memories.');
    }

    const url = `${deps.backendUrl}/memory/semantic/${encodeURIComponent(orgId)}/backfill`;
    let res: FetchResponse;
    try {
      res = await deps.fetchFn(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memories }),
      });
    } catch (err) {
      throw new BackendBackfillError(0, 'network_error', (err as Error).message || 'Network request failed');
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;

    if (!res.ok) {
      const body = (json ?? {}) as { error?: { code?: string; message?: string } };
      throw new BackendBackfillError(
        res.status,
        body.error?.code ?? 'request_failed',
        body.error?.message ?? `Backfill failed with status ${res.status}`,
      );
    }

    const r = (json ?? {}) as Partial<BackfillResult>;
    return {
      processed: Number(r.processed) || 0,
      embedded: Number(r.embedded) || 0,
      skipped: Number(r.skipped) || 0,
      failed: Number(r.failed) || 0,
    };
  };
}
