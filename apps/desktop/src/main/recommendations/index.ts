/**
 * Recommendation composition root. Builds a recommendation set on demand from
 * the live UDM and Enterprise Timeline. Stateless — recommendations are computed,
 * not stored. Reads only derived state.
 */
import type {
  RecommendationQuery,
  RecommendationQueryRequest as TRecommendationQueryRequest,
  RecommendationSet,
} from '@neuropause/shared';
import { IpcChannel, RecommendationQueryRequest } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { getEnterpriseTimeline } from '../timeline';
import { generateRecommendations, type RecommendationInput } from './recommendationEngine';

const log = createLogger('recommendations');

/**
 * Phase 6 Stage 5 — late-bound auxiliary read ports (workforce approvals,
 * connector health, execution history, assistant conversations). The subsystems
 * behind them are constructed AFTER this one in the composition root, so they
 * bind late — exactly the workforce `setExecutionSubmit` precedent. Absent
 * ports simply mean the corresponding rules stay silent (never a guess).
 */
export interface RecommendationAuxPorts {
  pendingApprovals?: () => NonNullable<RecommendationInput['pendingApprovals']>;
  connectors?: () => NonNullable<RecommendationInput['connectors']>;
  executionHistory?: () => NonNullable<RecommendationInput['executionHistory']>;
  conversations?: () => NonNullable<RecommendationInput['conversations']>;
}

export interface RecommendationsSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
  /** Phase 6 Stage 5 — bind the aux read ports once their subsystems exist. */
  setAuxPorts: (ports: RecommendationAuxPorts) => void;
}

export function initRecommendations(): RecommendationsSubsystem {
  let aux: RecommendationAuxPorts = {};
  const readAux = <K extends keyof RecommendationAuxPorts>(
    key: K,
  ): ReturnType<NonNullable<RecommendationAuxPorts[K]>> | undefined => {
    const fn = aux[key];
    if (!fn) return undefined;
    try {
      return fn() as ReturnType<NonNullable<RecommendationAuxPorts[K]>>;
    } catch {
      return undefined; // a failing port silences its rules; it never fabricates
    }
  };

  const build = (query: RecommendationQuery): RecommendationSet => {
    const now = query.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const input: RecommendationInput = { entities, events, now };
    const pendingApprovals = readAux('pendingApprovals');
    if (pendingApprovals) input.pendingApprovals = pendingApprovals;
    const connectors = readAux('connectors');
    if (connectors) input.connectors = connectors;
    const executionHistory = readAux('executionHistory');
    if (executionHistory) input.executionHistory = executionHistory;
    const conversations = readAux('conversations');
    if (conversations) input.conversations = conversations;
    const recommendations = generateRecommendations(input, query);
    const byKind: Record<string, number> = {};
    for (const r of recommendations) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    return {
      generatedAt: now,
      recommendations,
      total: recommendations.length,
      byKind,
      grounded: entities.length > 0,
    };
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.RecommendationsGenerate,
      schema: RecommendationQueryRequest,
      handler: (p) => build(p as TRecommendationQueryRequest),
    },
  ];

  log.info('Recommendation engine initialized', { rules: 10 });
  return {
    handlers,
    dispose: () => undefined,
    setAuxPorts: (ports) => {
      aux = ports;
    },
  };
}
