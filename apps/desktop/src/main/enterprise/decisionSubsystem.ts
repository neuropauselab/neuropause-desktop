/**
 * Executive Decision Intelligence — subsystem wiring (V3.3).
 *
 * Exposes decision persistence + lifecycle over IPC. Reuses the DecisionStore and
 * the Executive Center snapshot (to convert a recommendation → decision, preserving
 * traceability). No new intelligence; decisions derive from existing recommendations.
 */
import {
  DecisionCreateFromRecommendationRequest,
  DecisionSetStatusRequest,
  EmptyRequest,
  IpcChannel,
  type ExecutiveCenterSnapshot,
  type ExecutiveDecision,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { decisionStore } from './decisionInstance';
import { decisionFromRecommendation } from './decisionStore';

const log = createLogger('executive-decisions');

export interface DecisionSubsystem {
  handlers: SecureHandlerDef[];
}

/**
 * @param getSnapshot reads the current Executive Center snapshot (source of the
 * recommendation being converted). Injected to avoid a hard subsystem dependency.
 */
export function initDecisions(getSnapshot: () => ExecutiveCenterSnapshot): DecisionSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.DecisionList,
      schema: EmptyRequest,
      handler: (): { decisions: ExecutiveDecision[] } => ({ decisions: decisionStore.all() }),
    },
    {
      channel: IpcChannel.DecisionCreateFromRecommendation,
      schema: DecisionCreateFromRecommendationRequest,
      handler: async (payload: unknown): Promise<{ decision: ExecutiveDecision | null }> => {
        const req = payload as { recommendationId: string };
        const snap = getSnapshot();
        const rec = snap.recommendations?.find((r) => r.id === req.recommendationId);
        if (!rec) {
          log.warn('recommendation not found for decision', { id: req.recommendationId });
          return { decision: null };
        }
        const now = new Date().toISOString();
        // Deterministic id from the recommendation + timestamp keeps traceability.
        const suffix = `${rec.metric}-${Date.parse(now)}`;
        const decision = decisionFromRecommendation(rec, now, suffix);
        await decisionStore.create(decision);
        return { decision };
      },
    },
    {
      channel: IpcChannel.DecisionSetStatus,
      schema: DecisionSetStatusRequest,
      handler: async (payload: unknown): Promise<{ decision: ExecutiveDecision | null }> => {
        const req = payload as { id: string; status: ExecutiveDecision['status'] };
        const now = new Date().toISOString();
        const decision = await decisionStore.setStatus(req.id, req.status, now);
        return { decision };
      },
    },
  ];

  log.info('Executive Decision Intelligence initialized');
  return { handlers };
}
