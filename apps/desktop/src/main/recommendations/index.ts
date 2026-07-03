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
import { generateRecommendations } from './recommendationEngine';

const log = createLogger('recommendations');

export interface RecommendationsSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export function initRecommendations(): RecommendationsSubsystem {
  const build = (query: RecommendationQuery): RecommendationSet => {
    const now = query.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    const recommendations = generateRecommendations({ entities, events, now }, query);
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

  log.info('Recommendation engine initialized', { rules: 5 });
  return { handlers, dispose: () => undefined };
}
