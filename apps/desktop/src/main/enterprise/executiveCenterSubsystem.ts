/**
 * Executive Intelligence Center — subsystem wiring.
 *
 * Connects the pure composer to the REAL existing producers and exposes one IPC
 * handler the renderer calls. No new intelligence; it calls V2.2/V2.3 build
 * functions and the V2.3 health model.
 */
import { EmptyRequest, IpcChannel, type ExecutiveCenterSnapshot } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildFounderProactiveItems } from '../ai/founderProactive';
import { buildOrgIntelligenceItems, collectOrgHealthInputs } from './orgIntelligence';
import { composeExecutiveSnapshot, type TimelineEntryLite } from './executiveCenter';
import { getEnterpriseTimeline } from '../timeline';
import { healthHistoryStore } from './healthHistoryInstance';

const log = createLogger('executive-center');

export interface ExecutiveCenterSubsystem {
  handlers: SecureHandlerDef[];
  snapshot: () => ExecutiveCenterSnapshot;
}

/** Read recent timeline entries in the composer's minimal shape (reuses the store). */
function recentTimeline(): TimelineEntryLite[] {
  const tl = getEnterpriseTimeline();
  if (!tl) return [];
  return tl.query({ limit: 200, order: 'desc' }).entries.map((e) => ({
    id: e.id,
    at: e.at,
    kind: e.kind,
    category: e.category,
    title: e.title,
    summary: e.summary,
  }));
}

export function initExecutiveCenter(): ExecutiveCenterSubsystem {
  const snapshot = (): ExecutiveCenterSnapshot => {
    const snap = composeExecutiveSnapshot({
      now: () => new Date(),
      founderItems: () => buildFounderProactiveItems('morning'),
      orgItems: () => buildOrgIntelligenceItems(),
      orgHealthInputs: (nowMs) => collectOrgHealthInputs(nowMs),
      timelineEntries: () => recentTimeline(),
      // V3.0: feed last week's health from the persisted history store so Weekly
      // Trends is live. Returns null until ≥1 older datapoint exists.
      previousWeek: () => {
        const p = healthHistoryStore.valueAround(7);
        return p ? { overall: p.overall, engineering: p.engineering } : null;
      },
    });
    // Record today's datapoint (one per calendar day; last write wins). Fire-and-
    // forget — persistence failure must never break the snapshot response.
    void healthHistoryStore
      .record(snap.orgHealth.overall, snap.orgHealth.engineering)
      .catch((err) => log.warn('health-history record failed', { err: String(err) }));
    return snap;
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.ExecutiveCenterSnapshot,
      schema: EmptyRequest,
      handler: () => snapshot(),
    },
  ];

  log.info('Executive Intelligence Center initialized');
  return { handlers, snapshot };
}
