/**
 * Unified knowledge layer composition root.
 *
 * Loads the store and exposes the read side over the secure IPC bridge: the
 * structured Query Engine, entity lookup, aggregate counts, and Local Search.
 * Broadcasts a `counts` snapshot whenever the store changes so the renderer
 * (search UI, health dashboard) can refresh live. The write side — adapters and
 * the sync engine that populate the store — arrives in Drop 2.
 */
import type {
  UnifiedGetRequest as TUnifiedGetRequest,
  UnifiedQueryRequest as TUnifiedQueryRequest,
  UnifiedSearchRequest as TUnifiedSearchRequest,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  UnifiedGetRequest,
  UnifiedQueryRequest,
  UnifiedSearchRequest,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from './storeInstance';
import { unifiedSearch } from './search';
import { runOutsidePrincipal } from '../tenancy/backgroundPrincipal';

const log = createLogger('unified');

export interface UnifiedSubsystemDeps {
  broadcast: IpcBroadcaster;
}

export interface UnifiedSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export async function initUnified(deps: UnifiedSubsystemDeps): Promise<UnifiedSubsystem> {
  await unifiedStore.load();

  /**
   * P13C ROUND 7 — COMPUTED FOR THE VIEWER, NOT FOR THE JOB.
   *
   * THE CLASS: a background pass runs as tenant A while the window in front of
   * the user is showing tenant B. Any value computed for the RENDERER during
   * that pass is computed under A's principal, so a correctly-scoped store
   * honestly answers for A — and the answer is delivered into B's window.
   *
   * The store is not the defect. The store is right, which is exactly why this
   * survived seven rounds of auditing stores: every isolation test on it passes,
   * because the boundary holds and the READER is standing on the wrong side of
   * it.
   *
   * `runOutsidePrincipal` exists for precisely this and had ONE caller in the
   * whole main process (the unread badge), with a comment describing the general
   * case. This is the general case, in the five other places it occurs.
   *
   * It grants nothing: leaving the principal falls back to the SESSION, so the
   * value is what the signed-in viewer is entitled to and never more.
   */
  // `UnifiedCounts` carries `byConnector` — WHICH SaaS PROVIDERS a tenant has
  // connected — and `lastUpdatedAt`, which is activity timing. Not a bare number.
  const onChanged = (): void =>
    deps.broadcast(IpcChannel.UnifiedEventBroadcast, runOutsidePrincipal(() => unifiedStore.counts()));
  unifiedStore.on('changed', onChanged);

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.UnifiedQuery,
      schema: UnifiedQueryRequest,
      handler: (p) => unifiedStore.query(p as TUnifiedQueryRequest),
    },
    {
      channel: IpcChannel.UnifiedGet,
      schema: UnifiedGetRequest,
      handler: (p) => unifiedStore.get((p as TUnifiedGetRequest).id),
    },
    { channel: IpcChannel.UnifiedCounts, schema: EmptyRequest, handler: () => unifiedStore.counts() },
    {
      channel: IpcChannel.UnifiedSearch,
      schema: UnifiedSearchRequest,
      handler: (p) => unifiedSearch.search(p as TUnifiedSearchRequest),
    },
  ];

  log.info('Unified knowledge layer initialized', { entities: unifiedStore.counts().total });
  return { handlers, dispose: () => unifiedStore.off('changed', onChanged) };
}
