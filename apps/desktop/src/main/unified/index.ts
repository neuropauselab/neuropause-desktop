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

  const onChanged = (): void => deps.broadcast(IpcChannel.UnifiedEventBroadcast, unifiedStore.counts());
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
