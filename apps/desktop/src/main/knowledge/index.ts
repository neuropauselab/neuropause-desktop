/**
 * Knowledge composition root (V8.3). Derives structured knowledge from the memory
 * store (the source of truth) plus the existing graph — it adds no store and
 * copies no data. Registers the knowledge:related IPC handler over the secure
 * bridge, mirroring the memory subsystem's shape.
 */
import { IpcChannel, KnowledgeRelatedRequest } from '@neuropause/shared';
import type { KnowledgeRelatedRequest as TKnowledgeRelatedRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { memoryStore } from '../memory/memoryInstance';
import { graphStore } from '../graph/graphInstance';
import { handleRelatedMemories } from './knowledgeHandler';

export interface KnowledgeSubsystem {
  handlers: SecureHandlerDef[];
}

export function initKnowledge(): KnowledgeSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.KnowledgeRelated,
      schema: KnowledgeRelatedRequest,
      handler: (p) =>
        handleRelatedMemories(
          { listItems: () => memoryStore.allItems(), graph: graphStore },
          p as TKnowledgeRelatedRequest,
        ),
    },
  ];
  return { handlers };
}
