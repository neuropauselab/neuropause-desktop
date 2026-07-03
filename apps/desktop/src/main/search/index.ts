/**
 * Enterprise Search composition root. Wires the live retrieval surfaces (the
 * UDM search backend, the knowledge graph, and AI memory) into the federated
 * search and exposes it over the secure IPC bridge. Stateless — no load step.
 */
import type { EnterpriseSearchRequest as TEnterpriseSearchRequest } from '@neuropause/shared';
import { EnterpriseSearchRequest, IpcChannel } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { getEnterpriseTimeline } from '../timeline';
import { runEnterpriseSearch } from './enterpriseSearch';

const log = createLogger('search');

export interface EnterpriseSearchSubsystem {
  handlers: SecureHandlerDef[];
}

export function initEnterpriseSearch(): EnterpriseSearchSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EnterpriseSearch,
      schema: EnterpriseSearchRequest,
      handler: (p) =>
        runEnterpriseSearch(p as TEnterpriseSearchRequest, {
          entity: unifiedStore.searchBackend,
          graph: graphStore,
          memory: memoryStore,
          timeline: getEnterpriseTimeline() ?? undefined,
        }),
    },
  ];

  log.info('Enterprise search initialized', { sources: ['entity', 'graph', 'memory', 'timeline'] });
  return { handlers };
}
