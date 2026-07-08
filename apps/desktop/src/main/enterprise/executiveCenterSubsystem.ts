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
import { decisionStore } from './decisionInstance';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { summarizeWorkforceHealth } from './workforceHealth';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { knowledgeHealth } from '../knowledge/knowledgeHealth';
import { enterpriseRecommendations } from './intelligence/enterpriseRecommendations';
import { memoryStore } from '../memory/memoryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import {
  buildUnifiedTimeline,
  deriveCrmInsights,
  deriveCustomerInsights,
  deriveLeadInsights,
  contactFromRecord,
  customerFromRecord,
  leadFromRecord,
  type UnifiedItemLite,
} from '@neuropause/shared';
import { contactModule } from './modules/crm/contactModuleInstance';
import { leadModule } from './modules/crm/leadModuleInstance';
import { customerModule } from './modules/crm/customerModuleInstance';
import { buildExecutiveRecommendations, buildExecutiveSummary } from './executiveRecommendations';
import type { MonthlyTrend } from '@neuropause/shared';

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

/** Derive a MonthlyTrend for one metric from the store's 30-day windowStats. Pure. */
function monthlyTrendFor(
  key: MonthlyTrend['key'],
  label: string,
  metric: 'overall' | 'engineering',
  current: number,
): MonthlyTrend | null {
  const s = healthHistoryStore.windowStats(30, metric);
  if (!s) return null;
  const monthAgo = s.windowStart;
  const delta = current - monthAgo;
  const percentChange = monthAgo === 0 ? 0 : Math.round((delta / monthAgo) * 100);
  const direction: MonthlyTrend['direction'] = delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat';
  // Stability: low spread relative to the average ⇒ stable.
  const stability: MonthlyTrend['stability'] = s.stddev <= 5 ? 'stable' : 'volatile';
  // Confidence grows with datapoint count over the window.
  const confidence: MonthlyTrend['confidence'] =
    s.count >= 20 ? 'high' : s.count >= 7 ? 'medium' : 'low';
  return {
    key,
    label,
    current,
    monthAgo,
    delta,
    percentChange,
    direction,
    movingAverage: s.movingAverage,
    highest: s.highest,
    lowest: s.lowest,
    stability,
    sparkline: s.values,
    confidence,
  };
}

export function initExecutiveCenter(): ExecutiveCenterSubsystem {
  const snapshot = (): ExecutiveCenterSnapshot => {
    // Record today's datapoint FIRST (one per calendar day; last write wins) so the
    // monthly-trends source sees today's value as "current". Compute the current
    // scores once from the same inputs the composer will use.
    const nowMs = Date.now();
    const curInputs = collectOrgHealthInputs(nowMs);
    // computeOrgHealth is what the composer uses; import lazily via the composer's
    // own path would duplicate — instead record after compose but read current from
    // the freshly-composed snapshot (below), and expose monthly via a closure that
    // captures it. Simpler: compose first, then the monthly source reads the snap.
    let composed: ExecutiveCenterSnapshot | null = null;
    const snap = composeExecutiveSnapshot({
      now: () => new Date(nowMs),
      founderItems: () => buildFounderProactiveItems('morning'),
      orgItems: () => buildOrgIntelligenceItems(),
      orgHealthInputs: () => curInputs,
      timelineEntries: () => recentTimeline(),
      workforceHealth: () => summarizeWorkforceHealth(workerRegistry.healthSummaries()),
      workforceIntelligence: () => workforceIntelligence(jobStore.page({ limit: 2000 }).jobs),
      knowledgeHealth: () => knowledgeHealth(memoryStore.allItems()),
      memoryCounts: () => memoryStore.counts(),
      // CRM KPIs: read the registered CRM module's contacts (same pattern as the
      // other domain sources above) and roll them into Active Contacts / New
      // Leads / Customer Health / Follow-up Risk / High-Value Accounts.
      crmInsights: () =>
        deriveCrmInsights(
          contactModule.store.list({ status: 'active', limit: 5000 }).map(contactFromRecord),
          nowMs,
        ),
      // CRM lead-pipeline KPIs from the registered Leads module.
      leadInsights: () =>
        deriveLeadInsights(
          leadModule.store.list({ status: 'active', limit: 5000 }).map(leadFromRecord),
          nowMs,
        ),
      // CRM customer-account KPIs from the registered Customers module.
      customerInsights: () =>
        deriveCustomerInsights(
          customerModule.store.list({ status: 'active', limit: 5000 }).map(customerFromRecord),
          nowMs,
        ),
      // V2.9: feed last week's health from the persisted history store so Weekly
      // Trends is live. Returns null until ≥1 older datapoint exists.
      previousWeek: () => {
        const p = healthHistoryStore.valueAround(7, nowMs);
        return p ? { overall: p.overall, engineering: p.engineering } : null;
      },
      // V3.1: rich 30-day trends from the SAME store (no new persistence). Uses the
      // current composed scores as "current" and the store window for history.
      monthlyTrends: () => {
        const cur = composed?.orgHealth;
        const trends = [
          monthlyTrendFor('overall', 'Organization Health', 'overall', cur?.overall ?? 0),
          monthlyTrendFor(
            'engineering',
            'Engineering Health',
            'engineering',
            cur?.engineering ?? 0,
          ),
        ].filter((t): t is MonthlyTrend => t !== null);
        return trends.length > 0 ? trends : undefined;
      },
    });
    composed = snap;
    // V3.2: derive ranked recommendations + executive summary from the composed
    // snapshot (pure; explains existing metrics — no new intelligence).
    const recommendations = [
      ...buildExecutiveRecommendations(snap),
      ...(snap.enterprise ? enterpriseRecommendations(snap.enterprise) : []),
    ];
    snap.recommendations = recommendations;
    snap.executiveSummary = buildExecutiveSummary(snap, recommendations);
    // V3.3: attach the persisted decisions overview (read-only view; no new logic).
    snap.decisions = decisionStore.summary();
    // V3.8: compose the unified executive event stream from sources already in the
    // snapshot + decision history. Pure; no new persistence. Wrapped so a malformed
    // item can never reject the whole executive snapshot (V5.2.2 hardening).
    try {
      const toLite = (card: typeof snap.executiveTimeline): UnifiedItemLite[] =>
        (card?.items ?? []).map((it) => ({
          id: it.id,
          title: it.title,
          body: it.body,
          priority: (it.priority === 'normal'
            ? 'medium'
            : it.priority) as UnifiedItemLite['priority'],
          producedAt: it.producedAt,
          deepLink: it.deepLink,
          evidenceCount: it.governance?.evidence?.length ?? 0,
        }));
      snap.unifiedTimeline = buildUnifiedTimeline({
        decisions: decisionStore.all(),
        organization: toLite(snap.executiveTimeline),
        delivery: toLite(snap.recentDeliveries),
        recommendations: (snap.recommendations ?? []).map((r) => ({
          id: r.id,
          title: r.problem,
          body: r.recommendedAction,
          priority: r.priority,
          producedAt: snap.generatedAt,
          deepLink: 'enterprise/executive',
          evidenceCount: r.evidence?.length ?? 0,
          owner: r.owner,
        })),
      });
    } catch (err) {
      log.warn('unified timeline compose failed; returning snapshot without it', {
        err: String(err),
      });
      snap.unifiedTimeline = [];
    }
    // Record today's datapoint. Fire-and-forget — persistence failure must never
    // break the snapshot response.
    void healthHistoryStore
      .record(snap.orgHealth.overall, snap.orgHealth.engineering, nowMs)
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
