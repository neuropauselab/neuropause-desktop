/**
 * GitHub sync runner — the SyncRunner implementation that activates real data
 * sync for the GitHub connector.
 *
 * This is the piece that fills the connector service's dormant `syncRunner` seam.
 * It composes the already-built, already-tested pieces and adds no new pipeline:
 *
 *   getValidAccessToken (service, vault-backed, auto-refresh)
 *     → GitHubClient.fetchAll (read-only REST, incremental, retry)   [inc2]
 *     → normalizeGitHub (pure → UnifiedEntity[])                       [inc1]
 *     → unifiedStore.upsertMany (source-authoritative merge + dedup)  [existing]
 *     → [downstream, existing] projectMemory → memory / timeline / knowledge / semantic
 *
 * Registered once at connector init via connectorService.setSyncRunner(). Returns
 * the SyncRunner contract shape `{ ok, total, hadAdapter, error }`; the connector
 * lifecycle records lastSyncAt / lastSyncState from it (observability, Part 6).
 *
 * Dependencies are injected (token getter, client, store, clock) so the routing,
 * token-guard, count-reporting, and error-handling logic is unit-testable without
 * a live GitHub, a real vault, or Electron.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { UpsertResult } from '../../../unified/unifiedStore';
import { GitHubClient, type FetchFn } from './githubClient';
import { normalizeGitHub } from './githubNormalize';

export interface SyncRunResult {
  ok: boolean;
  total: number;
  hadAdapter: boolean;
  error: string | null;
}

export interface GitHubSyncDeps {
  /** Vault-backed token accessor (connectorService.getValidAccessToken). */
  getToken: (connectorId: string, accountId: string) => Promise<string | null>;
  /** The account's last successful sync time, for incremental fetch. */
  getLastSyncAt: (connectorId: string, accountId: string) => string | null;
  /** Persist the normalized entities (unifiedStore.upsertMany). */
  upsert: (entities: UnifiedEntity[]) => Promise<UpsertResult>;
  /** Injected fetch for the GitHub client (platform fetch in prod). */
  fetchImpl: FetchFn;
  now?: () => string;
}

const CONNECTOR_ID = 'github';

/**
 * Build the GitHub SyncRunner. The returned function matches the connector
 * service's `SyncRunner` type: (connectorId, accountId) => Promise<result>.
 */
export function createGitHubSyncRunner(deps: GitHubSyncDeps) {
  const now = deps.now ?? ((): string => new Date().toISOString());

  return async function runGitHubSync(connectorId: string, accountId: string): Promise<SyncRunResult> {
    // Only claim GitHub; other connectors fall through as "no adapter" so the
    // service can try another runner or record a no-op.
    if (connectorId !== CONNECTOR_ID) {
      return { ok: true, total: 0, hadAdapter: false, error: null };
    }

    try {
      const token = await deps.getToken(CONNECTOR_ID, accountId);
      if (!token) {
        return { ok: false, total: 0, hadAdapter: true, error: 'No valid access token; reconnect required' };
      }

      const sinceIso = deps.getLastSyncAt(CONNECTOR_ID, accountId);
      const client = new GitHubClient({ fetchImpl: deps.fetchImpl });
      const payload = await client.fetchAll(token, sinceIso);

      const entities = normalizeGitHub(payload, accountId, now());
      if (entities.length > 0) await deps.upsert(entities);

      return { ok: true, total: entities.length, hadAdapter: true, error: null };
    } catch (err) {
      return {
        ok: false,
        total: 0,
        hadAdapter: true,
        error: err instanceof Error ? err.message : 'GitHub sync failed',
      };
    }
  };
}
