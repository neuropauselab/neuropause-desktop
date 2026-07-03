/**
 * Founder AI composition root. Answers a question on demand by reading the live
 * UDM and Enterprise Timeline and providing a knowledge-graph neighbor lookup,
 * then running the rule-based engine. Stateless — answers are computed, not
 * stored. Reads only derived state.
 */
import type { FounderAnswer, FounderAskRequest as TFounderAskRequest } from '@neuropause/shared';
import { FounderAskRequest, IpcChannel } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { getEnterpriseTimeline } from '../timeline';
import { answerFounderQuestion, type FounderNeighbor } from './founderEngine';

const log = createLogger('founder-ai');

export interface FounderSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export function initFounderAI(): FounderSubsystem {
  const neighbors = (nodeId: string): FounderNeighbor[] => {
    const n = graphStore.neighbors({ id: nodeId, limit: 50 });
    if (!n) return [];
    return n.neighbors.map((x) => ({
      id: x.node.id,
      type: x.node.type,
      label: x.node.label,
      rel: x.edge.type,
      direction: x.direction,
    }));
  };

  const ask = (req: TFounderAskRequest): FounderAnswer => {
    const now = req.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    return answerFounderQuestion(req.text, { entities, events, now, neighbors });
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.FounderAsk,
      schema: FounderAskRequest,
      handler: (p) => ask(p as TFounderAskRequest),
    },
  ];

  log.info('Founder AI initialized', { intents: 7 });
  return { handlers, dispose: () => undefined };
}
