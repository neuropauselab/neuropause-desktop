/**
 * Daily Intelligence composition root. Generates a briefing on demand by reading
 * the live UDM and Enterprise Timeline, then running the deterministic generator.
 * Stateless — briefings are computed, not stored. Reads only derived state.
 */
import type { Briefing, BriefingRequest as TBriefingRequest } from '@neuropause/shared';
import { BriefingRequest, IpcChannel } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { getEnterpriseTimeline } from '../timeline';
import { generateBriefing } from './briefingGenerator';

const log = createLogger('daily-intelligence');

export interface DailyIntelligenceSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export function initDailyIntelligence(): DailyIntelligenceSubsystem {
  const build = (req: TBriefingRequest): Briefing => {
    const now = req.now ?? new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const tl = getEnterpriseTimeline();
    const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
    return generateBriefing(req.period, { entities, events, now });
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.BriefingGenerate,
      schema: BriefingRequest,
      handler: (p) => build(p as TBriefingRequest),
    },
  ];

  log.info('Daily intelligence initialized', { periods: 5 });
  return { handlers, dispose: () => undefined };
}
