/**
 * Executive Intelligence Center (V2.4) — composition layer.
 *
 * Assembles ONE executive snapshot by calling capabilities that ALREADY EXIST:
 *   - buildFounderProactiveItems()  (V2.2)  → founder recommendations
 *   - buildOrgIntelligenceItems()   (V2.3)  → organization findings
 *   - collectOrgHealthInputs() + computeOrgHealth() (V2.3) → KPIs + health scores
 *   - generateBriefing()            (V1)    → today's brief / upcoming priorities
 *
 * It creates NO new intelligence and NO new dashboard framework. Every card
 * carries a deepLink to the existing page that owns the detail — no duplicated
 * views. This is a pure function of the existing sources, so it is unit-testable
 * by injecting those sources.
 */
import {
  computeOrgHealth,
  crmInsightsToKpis,
  customerInsightsToKpis,
  inventoryInsightsToKpis,
  invoiceInsightsToKpis,
  leadInsightsToKpis,
  orderInsightsToKpis,
  orgHealthBand,
  paymentInsightsToKpis,
  procurementInsightsToKpis,
  warehouseInsightsToKpis,
  manufacturingInsightsToKpis,
  maintenanceInsightsToKpis,
  fulfillmentInsightsToKpis,
  planningInsightsToKpis,
  mrpInsightsToKpis,
  timePhasedInsightsToKpis,
  capacityInsightsToKpis,
  routingInsightsToKpis,
  mesInsightsToKpis,
  eventInsightsToKpis,
  quoteInsightsToKpis,
  type CrmModuleInsights,
  type CustomerModuleInsights,
  type InventoryModuleInsights,
  type InvoiceModuleInsights,
  type LeadModuleInsights,
  type OrderModuleInsights,
  type PaymentModuleInsights,
  type ProcurementModuleInsights,
  type WarehouseModuleInsights,
  type ManufacturingModuleInsights,
  type MaintenanceModuleInsights,
  type FulfillmentModuleInsights,
  type PlanningModuleInsights,
  type MrpModuleInsights,
  type TimePhasedInsights,
  type CapacityInsights,
  type RoutingInsights,
  type MesExecutionInsights,
  type EventInsights,
  type QuoteModuleInsights,
  type ExecutiveCard,
  type ExecutiveKpi,
  type ExecutiveCenterSnapshot,
  type ExecutiveTrend,
  type MonthlyTrend,
  type IntelligenceItem,
  type OrgHealthInputs,
  type OrgHealthScores,
  type WorkforceHealthSummary,
} from '@neuropause/shared';
import { workforceHealthKpi } from './workforceHealth';
import { workforcePerformanceKpi } from '../workforce/intelligence/workforcePerformanceKpi';
import type { WorkforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import {
  enterpriseInsights,
  type KnowledgeHealthLike,
  type MemoryCountsLike,
} from './intelligence/enterpriseInsights';
import { enterpriseInsightsKpi } from './intelligence/enterpriseKpi';

/** The existing producers the Center composes. Injected for testability. */
export interface ExecutiveCenterSources {
  now: () => Date;
  founderItems: () => IntelligenceItem[];
  orgItems: () => IntelligenceItem[];
  orgHealthInputs: (nowMs: number) => OrgHealthInputs;
  /** V2.9: recent timeline entries for Timeline/Deliveries cards (optional). */
  timelineEntries?: (nowMs: number) => TimelineEntryLite[];
  /** V2.9: last week's org-health overall/engineering for Weekly Trends (optional). */
  previousWeek?: () => { overall: number; engineering: number } | null;
  /** V3.1: rich 30-day monthly trends, computed from the history store (optional). */
  monthlyTrends?: () => MonthlyTrend[] | undefined;
  /** V8.1: aggregate AI-workforce health (optional). */
  workforceHealth?: () => WorkforceHealthSummary | undefined;
  workforceIntelligence?: () => WorkforceIntelligence | undefined;
  knowledgeHealth?: () => KnowledgeHealthLike | undefined;
  memoryCounts?: () => MemoryCountsLike | undefined;
  /** CRM module insights → Executive Center KPI tiles (optional). */
  crmInsights?: () => CrmModuleInsights | undefined;
  /** CRM lead-pipeline insights → Executive Center KPI tiles (optional). */
  leadInsights?: () => LeadModuleInsights | undefined;
  /** CRM customer-account insights → Executive Center KPI tiles (optional). */
  customerInsights?: () => CustomerModuleInsights | undefined;
  /** Sales quote-pipeline insights → Executive Center KPI tiles (optional). */
  quoteInsights?: () => QuoteModuleInsights | undefined;
  /** Sales order-fulfillment insights → Executive Center KPI tiles (optional). */
  orderInsights?: () => OrderModuleInsights | undefined;
  /** Finance invoice-receivables insights → Executive Center KPI tiles (optional). */
  invoiceInsights?: () => InvoiceModuleInsights | undefined;
  /** Finance payment-collection insights → Executive Center KPI tiles (optional). */
  paymentInsights?: () => PaymentModuleInsights | undefined;
  /** Inventory stock insights → Executive Center KPI tiles (optional). */
  inventoryInsights?: () => InventoryModuleInsights | undefined;
  /** Procurement insights → Executive Center KPI tiles (optional). */
  procurementInsights?: () => ProcurementModuleInsights | undefined;
  /** Warehouse operations insights → Executive Center KPI tiles (optional). */
  warehouseInsights?: () => WarehouseModuleInsights | undefined;
  /** Manufacturing execution insights → Executive Center KPI tiles (optional). */
  manufacturingInsights?: () => ManufacturingModuleInsights | undefined;
  /** Maintenance management insights → Executive Center KPI tiles (optional). */
  maintenanceInsights?: () => MaintenanceModuleInsights | undefined;
  /** Finished-goods fulfillment insights → Executive Center KPI tiles (optional). */
  fulfillmentInsights?: () => FulfillmentModuleInsights | undefined;
  /** Enterprise planning insights → Executive Center KPI tiles (optional). */
  planningInsights?: () => PlanningModuleInsights | undefined;
  /** Multi-level MRP insights → Executive Center KPI tiles (optional). */
  mrpInsights?: () => MrpModuleInsights | undefined;
  /** Time-phased MRP scheduling insights → Executive Center KPI tiles (optional). */
  timePhasedInsights?: () => TimePhasedInsights | undefined;
  /** Finite-capacity (APS) scheduling insights → Executive Center KPI tiles (optional). */
  capacityInsights?: () => CapacityInsights | undefined;
  /** Routing-aware (APS) scheduling insights → Executive Center KPI tiles (optional). */
  routingInsights?: () => RoutingInsights | undefined;
  /** Manufacturing Execution (MES) shop-floor insights → Executive Center KPI tiles (optional). */
  mesInsights?: () => MesExecutionInsights | undefined;
  /** Shop-floor event-ledger telemetry insights → Executive Center KPI tiles (optional). */
  eventInsights?: () => EventInsights | undefined;
}

/** The minimal timeline fields the composer reads (kept local; no new dep). */
export interface TimelineEntryLite {
  id: string;
  at: string;
  kind: string;
  category: string;
  title: string;
  summary: string | null;
}

function card(
  key: string,
  title: string,
  items: IntelligenceItem[],
  deepLink: string,
  summary?: string,
): ExecutiveCard {
  return { key, title, items, deepLink, summary };
}

/** Split items by priority for the attention glance + critical-alerts card. */
function byPriority(items: IntelligenceItem[]) {
  const critical = items.filter((i) => i.priority === 'critical');
  const high = items.filter((i) => i.priority === 'high');
  const normal = items.filter((i) => i.priority === 'normal' || i.priority === 'low');
  return { critical, high, normal };
}

/** Build a weekly trend delta. */
function trend(key: string, label: string, current: number, previous: number): ExecutiveTrend {
  const delta = current - previous;
  return {
    key,
    label,
    current,
    previous,
    delta,
    direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
  };
}

/** Build the KPI strip (STEP 4) purely from the org-health scores + raw inputs. */
function buildKpis(scores: OrgHealthScores, inputs: OrgHealthInputs): ExecutiveKpi[] {
  const band = (v: number) => orgHealthBand(v);
  const licenseDisplay =
    inputs.licenseValid === false
      ? 'invalid'
      : inputs.licenseDaysToExpiry != null
        ? `${inputs.licenseDaysToExpiry}d left`
        : 'unknown';
  return [
    {
      key: 'org-health',
      label: 'Organization Health',
      value: scores.overall,
      display: `${scores.overall}/100`,
      band: band(scores.overall),
      deepLink: 'enterprise/organization',
    },
    {
      key: 'engineering-health',
      label: 'Engineering Health',
      value: scores.engineering,
      display: `${scores.engineering}/100`,
      band: band(scores.engineering),
      deepLink: 'ai-workforce/engineering',
    },
    {
      key: 'ai-adoption',
      label: 'AI Adoption',
      value: scores.adoption,
      display: `${scores.adoption}/100`,
      band: band(scores.adoption),
      deepLink: 'enterprise/organization',
    },
    {
      key: 'connector-health',
      label: 'Connector Health',
      value: scores.connectorHealth,
      display: `${inputs.connectorsHealthy ?? 0}/${inputs.connectorsTotal ?? 0} healthy`,
      band: band(scores.connectorHealth),
      deepLink: 'connectors',
    },
    {
      key: 'license-status',
      label: 'License',
      value: scores.licenseHealth,
      display: licenseDisplay,
      band: band(scores.licenseHealth),
      deepLink: 'settings/billing',
    },
    {
      key: 'active-members',
      label: 'Active Members',
      value: null,
      display: `${inputs.activeMemberCount ?? 0}/${inputs.memberCount ?? 0}`,
      deepLink: 'enterprise/organization',
    },
  ];
}

/**
 * Compose the full executive snapshot. Pure over the injected sources — the same
 * data the individual pages already show, assembled into one 30-second view.
 */
export function composeExecutiveSnapshot(sources: ExecutiveCenterSources): ExecutiveCenterSnapshot {
  const nowMs = sources.now().getTime();
  const generatedAt = new Date(nowMs).toISOString();

  const founder = sources.founderItems();
  const org = sources.orgItems();
  const inputs = sources.orgHealthInputs(nowMs);
  const scores = computeOrgHealth(inputs);

  // Critical alerts = all critical items across founder + org (deduped by id).
  const allItems = [...founder, ...org];
  const seen = new Set<string>();
  const critical = allItems.filter((i) => {
    if (i.priority !== 'critical') return false;
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  // Engineering-flavored items (from either source) for the engineering card.
  const engineering = allItems.filter(
    (i) =>
      i.id.includes('engineering') || (i.governance?.sourceSystems ?? []).includes('engineering'),
  );

  // Upcoming priorities = high-priority, non-critical items.
  const upcoming = allItems.filter((i) => i.priority === 'high');

  const counts = byPriority(allItems);

  // ── V2.9 completion cards (STEP 3) — all composed from existing data ──
  const timeline = sources.timelineEntries?.(nowMs) ?? [];
  const weekAgo = nowMs - 7 * 86_400_000;
  const recentTimeline = timeline.filter((e) => new Date(e.at).getTime() >= weekAgo);

  // Executive Timeline: the most recent activity across the org.
  const timelineItems: IntelligenceItem[] = recentTimeline.slice(0, 8).map((e) => ({
    id: `timeline:${e.id}`,
    title: e.title,
    body: e.summary ?? e.category,
    priority: 'normal',
    producedAt: e.at,
  }));

  // Recent Deliveries: timeline entries that represent shipped/completed work.
  const deliveryItems: IntelligenceItem[] = recentTimeline
    .filter((e) =>
      /deploy|release|ship|complete|mer[g]e|deliver|done/i.test(
        `${e.kind} ${e.category} ${e.title}`,
      ),
    )
    .slice(0, 6)
    .map((e) => ({
      id: `delivery:${e.id}`,
      title: e.title,
      body: e.summary ?? e.category,
      priority: 'normal',
      producedAt: e.at,
    }));

  // Recent Decisions: decision-flavored timeline entries (or founder recommendations acted on).
  const decisionItems: IntelligenceItem[] = recentTimeline
    .filter((e) =>
      /decision|approve|decide|chose|selected|sign-?off/i.test(
        `${e.kind} ${e.category} ${e.title}`,
      ),
    )
    .slice(0, 6)
    .map((e) => ({
      id: `decision:${e.id}`,
      title: e.title,
      body: e.summary ?? e.category,
      priority: 'normal',
      producedAt: e.at,
    }));

  // Evidence Summary: the governance evidence behind the current critical/high items.
  const evidenceItems: IntelligenceItem[] = allItems
    .filter((i) => (i.priority === 'critical' || i.priority === 'high') && i.governance)
    .slice(0, 6)
    .map((i) => ({
      id: `evidence:${i.id}`,
      title: i.title,
      body: (i.governance?.evidence ?? []).slice(0, 3).join(' · ') || 'No evidence recorded',
      priority: i.priority,
      producedAt: i.producedAt,
      governance: i.governance,
    }));

  // Weekly Trends: deltas vs last week for the headline metrics.
  const prev = sources.previousWeek?.() ?? null;
  const weeklyTrends = prev
    ? [
        trend('overall', 'Organization Health', scores.overall, prev.overall),
        trend('engineering', 'Engineering Health', scores.engineering, prev.engineering),
      ]
    : undefined;

  const monthlyTrends = sources.monthlyTrends?.();
  const workforceHealth = sources.workforceHealth?.();
  const workforceIntel = sources.workforceIntelligence?.();
  const crmInsightsForKpis = sources.crmInsights?.();
  const leadInsightsForKpis = sources.leadInsights?.();
  const customerInsightsForKpis = sources.customerInsights?.();
  const quoteInsightsForKpis = sources.quoteInsights?.();
  const orderInsightsForKpis = sources.orderInsights?.();
  const invoiceInsightsForKpis = sources.invoiceInsights?.();
  const paymentInsightsForKpis = sources.paymentInsights?.();
  const inventoryInsightsForKpis = sources.inventoryInsights?.();
  const procurementInsightsForKpis = sources.procurementInsights?.();
  const warehouseInsightsForKpis = sources.warehouseInsights?.();
  const manufacturingInsightsForKpis = sources.manufacturingInsights?.();
  const maintenanceInsightsForKpis = sources.maintenanceInsights?.();
  const fulfillmentInsightsForKpis = sources.fulfillmentInsights?.();
  const planningInsightsForKpis = sources.planningInsights?.();
  const mrpInsightsForKpis = sources.mrpInsights?.();
  const timePhasedInsightsForKpis = sources.timePhasedInsights?.();
  const capacityInsightsForKpis = sources.capacityInsights?.();
  const routingInsightsForKpis = sources.routingInsights?.();
  const mesInsightsForKpis = sources.mesInsights?.();
  const eventInsightsForKpis = sources.eventInsights?.();
  const enterprise = enterpriseInsights({
    knowledge: sources.knowledgeHealth?.(),
    memory: sources.memoryCounts?.(),
    workforce: workforceIntel,
  });

  return {
    generatedAt,
    kpis: [
      ...buildKpis(scores, inputs),
      ...(workforceHealth ? [workforceHealthKpi(workforceHealth)] : []),
      ...(workforceIntel ? [workforcePerformanceKpi(workforceIntel)] : []),
      enterpriseInsightsKpi(enterprise),
      ...(crmInsightsForKpis ? crmInsightsToKpis(crmInsightsForKpis) : []),
      ...(leadInsightsForKpis ? leadInsightsToKpis(leadInsightsForKpis) : []),
      ...(customerInsightsForKpis ? customerInsightsToKpis(customerInsightsForKpis) : []),
      ...(quoteInsightsForKpis ? quoteInsightsToKpis(quoteInsightsForKpis) : []),
      ...(orderInsightsForKpis ? orderInsightsToKpis(orderInsightsForKpis) : []),
      ...(invoiceInsightsForKpis ? invoiceInsightsToKpis(invoiceInsightsForKpis) : []),
      ...(paymentInsightsForKpis ? paymentInsightsToKpis(paymentInsightsForKpis) : []),
      ...(inventoryInsightsForKpis ? inventoryInsightsToKpis(inventoryInsightsForKpis) : []),
      ...(procurementInsightsForKpis ? procurementInsightsToKpis(procurementInsightsForKpis) : []),
      ...(warehouseInsightsForKpis ? warehouseInsightsToKpis(warehouseInsightsForKpis) : []),
      ...(manufacturingInsightsForKpis ? manufacturingInsightsToKpis(manufacturingInsightsForKpis) : []),
      ...(maintenanceInsightsForKpis ? maintenanceInsightsToKpis(maintenanceInsightsForKpis) : []),
      ...(fulfillmentInsightsForKpis ? fulfillmentInsightsToKpis(fulfillmentInsightsForKpis) : []),
      ...(planningInsightsForKpis ? planningInsightsToKpis(planningInsightsForKpis) : []),
      ...(mrpInsightsForKpis ? mrpInsightsToKpis(mrpInsightsForKpis) : []),
      ...(timePhasedInsightsForKpis ? timePhasedInsightsToKpis(timePhasedInsightsForKpis) : []),
      ...(capacityInsightsForKpis ? capacityInsightsToKpis(capacityInsightsForKpis) : []),
      ...(routingInsightsForKpis ? routingInsightsToKpis(routingInsightsForKpis) : []),
      ...(mesInsightsForKpis ? mesInsightsToKpis(mesInsightsForKpis) : []),
      ...(eventInsightsForKpis ? eventInsightsToKpis(eventInsightsForKpis) : []),
    ],
    enterprise,
    orgHealth: scores,
    workforceHealth,
    criticalAlerts: card(
      'critical-alerts',
      'Critical Alerts',
      critical,
      'notifications',
      critical.length === 0 ? 'No critical alerts' : `${critical.length} need attention`,
    ),
    founderRecommendations: card(
      'founder-recommendations',
      'Founder Recommendations',
      founder,
      'ai-workforce/founder',
      founder.length === 0 ? 'Nothing to recommend right now' : undefined,
    ),
    organizationHealth: card(
      'organization-health',
      'Organization Health',
      org,
      'enterprise/organization',
      `${orgHealthBand(scores.overall)} — ${scores.overall}/100`,
    ),
    engineeringHealth: card(
      'engineering-health',
      'Engineering Health',
      engineering,
      'ai-workforce/engineering',
      `${orgHealthBand(scores.engineering)} — ${scores.engineering}/100`,
    ),
    upcomingPriorities: card(
      'upcoming-priorities',
      'Upcoming Priorities',
      upcoming,
      'enterprise/briefings',
      upcoming.length === 0 ? 'Nothing urgent upcoming' : undefined,
    ),
    attentionCounts: {
      critical: counts.critical.length,
      high: counts.high.length,
      normal: counts.normal.length,
    },
    executiveTimeline: card(
      'executive-timeline',
      'Executive Timeline',
      timelineItems,
      'enterprise/organization',
      timelineItems.length === 0 ? 'No recent activity' : undefined,
    ),
    recentDecisions: card(
      'recent-decisions',
      'Recent Decisions',
      decisionItems,
      'enterprise/organization',
      decisionItems.length === 0 ? 'No decisions recorded this week' : undefined,
    ),
    recentDeliveries: card(
      'recent-deliveries',
      'Recent Deliveries',
      deliveryItems,
      'ai-workforce/engineering',
      deliveryItems.length === 0 ? 'No deliveries this week' : undefined,
    ),
    evidenceSummary: card(
      'evidence-summary',
      'Evidence Summary',
      evidenceItems,
      'notifications',
      evidenceItems.length === 0 ? 'No evidence to summarize' : undefined,
    ),
    weeklyTrends,
    monthlyTrends,
  };
}
