/**
 * Phase 6 Stage 6 (D-2 + enhancement #1) — the Enterprise Signal Registry.
 *
 * The audit's §3 Enterprise Signal Map as TYPED DATA, so the inventory can
 * never silently drift from code: every signal the intelligence layer consumes
 * is declared here with its owner, update frequency, and — enhancement #1 —
 * freshness, completeness, and trust metadata. A test locks registry ↔ doc
 * integrity against `docs/desktop/insight/SIGNAL-MAP.md`.
 *
 * Pure data + small pure helpers. Nothing here reads a store.
 */
import type {
  SignalDefinition,
  SignalRuntimeStatus,
} from '@neuropause/shared';

/** The 22 signals of the Enterprise Signal Map (audit §3), in map order. */
export const SIGNAL_REGISTRY: readonly SignalDefinition[] = [
  {
    id: 'work-entities',
    mapIndex: 1,
    name: 'Work entities (tasks, projects, meetings, emails, docs, notifications)',
    owner: 'unified/unifiedStore',
    freshness: { cadence: 'per-sync', staleAfterMinutes: 240 },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'provider-authoritative', score: 0.95 },
    dependsOn: [],
    consumers: ['search', 'briefings', 'recommendations', 'hub', 'assistant-retrieval'],
  },
  {
    id: 'timeline-events',
    mapIndex: 2,
    name: 'Enterprise timeline events',
    owner: 'timeline/ over platform/eventBus',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'live event window (bounded buffer)' },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['briefings', 'p7-incidents', 'assistant', 'hub', 'webhooks'],
  },
  {
    id: 'workforce-jobs',
    mapIndex: 3,
    name: 'Workforce jobs + parked approvals',
    owner: 'workforce/runtime/jobInstance',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'durable, capped at 2000 jobs' },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: ['timeline-events'],
    consumers: ['approval-center', 'executive-snapshot', 'recommendations', 'hub', 'notifications'],
  },
  {
    id: 'executions',
    mapIndex: 4,
    name: 'Executions (all kinds)',
    owner: 'executeEngine + executionStore',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'ring of last 200 sessions' },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['operations-center', 'p19', 'hub-timeline', 'work-summary'],
  },
  {
    id: 'workflow-runs',
    mapIndex: 5,
    name: 'Workflow runs',
    owner: 'workforce orchestrator (workflow.* events)',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'observed via the timeline event window' },
    trust: { tier: 'runtime-recorded', score: 0.85 },
    dependsOn: ['timeline-events', 'workforce-jobs'],
    consumers: ['timeline', 'notifications'],
  },
  {
    id: 'automation-runs',
    mapIndex: 6,
    name: 'Automation runs',
    owner: 'AutomationRunHistory + per-rule lastRun',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'ring of last 200 runs' },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['automation-monitor', 'recommendations', 'work-summary'],
  },
  {
    id: 'connector-health',
    mapIndex: 7,
    name: 'Connector health & sync state',
    owner: 'connectorService + runtime supervisor + sync snapshots',
    freshness: { cadence: 'per-sync', staleAfterMinutes: 120 },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['diagnostics', 'assistant-snapshot', 'recommendations', 'notifications'],
  },
  {
    id: 'assistant-conversations',
    mapIndex: 8,
    name: 'Assistant conversations (incl. waiting steps)',
    owner: 'assistant/conversationStore',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['recommendations', 'hub', 'productivity-timeline'],
  },
  {
    id: 'ai-invocations',
    mapIndex: 9,
    name: 'AI invocations & usage',
    owner: 'ai/aiEngine audit log',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['session-inspector', 'ai-health', 'cost-views'],
  },
  {
    id: 'memory-corpus',
    mapIndex: 10,
    name: 'Memory corpus + memory audit',
    owner: 'memory/memoryStore + memoryAuditLog',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'partial', note: 'distilled from #1/#2, not a full copy' },
    trust: { tier: 'derived', score: 0.7 },
    dependsOn: ['work-entities', 'timeline-events'],
    consumers: ['retrieval', 'recall', 'meeting-prep', 'assistant-tasks'],
  },
  {
    id: 'recommendations',
    mapIndex: 11,
    name: 'Recommendations',
    owner: 'recommendations/ (computed, stateless)',
    freshness: { cadence: 'on-demand', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'derived', score: 0.8 },
    dependsOn: ['work-entities', 'timeline-events', 'workforce-jobs', 'automation-runs', 'connector-health', 'assistant-conversations'],
    consumers: ['hub', 'executive-snapshot', 'decisions'],
  },
  {
    id: 'notification-inbox',
    mapIndex: 12,
    name: 'Notification inbox',
    owner: 'notifications/inboxStore',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'durable, capped at 200 items' },
    trust: { tier: 'runtime-recorded', score: 0.85 },
    dependsOn: ['timeline-events'],
    consumers: ['bell', 'notifications-view', 'productivity-timeline'],
  },
  {
    id: 'briefings',
    mapIndex: 13,
    name: 'Briefings (5 periods)',
    owner: 'intelligence/briefingGenerator (computed)',
    freshness: { cadence: 'scheduled', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'derived', score: 0.8 },
    dependsOn: ['work-entities', 'timeline-events'],
    consumers: ['delivery', 'assistant', 'hub-today'],
  },
  {
    id: 'org-structure',
    mapIndex: 14,
    name: 'Org structure & metrics',
    owner: 'enterprise/org/orgStore',
    freshness: { cadence: 'per-sync', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['org-ui', 'org-health', 'executive-snapshot'],
  },
  {
    id: 'org-health',
    mapIndex: 15,
    name: 'Org-health scores + findings',
    owner: 'orgIntelligence + healthHistoryStore (90-day daily history)',
    freshness: { cadence: 'daily', staleAfterMinutes: 2880 },
    completeness: { coverage: 'bounded', note: '90 daily points' },
    trust: { tier: 'heuristic', score: 0.65 },
    dependsOn: ['workforce-jobs', 'automation-runs', 'connector-health', 'org-structure'],
    consumers: ['executive-center', 'org-intelligence-delivery'],
  },
  {
    id: 'executive-snapshots',
    mapIndex: 16,
    name: 'Executive snapshots',
    owner: 'computeExecutiveSnapshot + ExecutiveCenterSnapshot',
    freshness: { cadence: 'on-demand', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'derived', score: 0.8 },
    dependsOn: ['workforce-jobs', 'connector-health', 'recommendations', 'org-structure', 'org-health'],
    consumers: ['enterprise-dashboard', 'hub-executive', 'decisions'],
  },
  {
    id: 'p7-intelligence',
    mapIndex: 17,
    name: 'P7 intelligence report',
    owner: 'enterpriseIntelligenceSubsystem (computed, 3 s TTL)',
    freshness: { cadence: 'on-demand', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'heuristic', score: 0.7 },
    dependsOn: ['timeline-events'],
    consumers: ['ops-surfaces', 'p14-p19-layers'],
  },
  {
    id: 'system-health',
    mapIndex: 18,
    name: 'System health',
    owner: 'NeuroCore.snapshot()',
    freshness: { cadence: 'on-demand', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: ['automation-runs'],
    consumers: ['settings-ops-surfaces'],
  },
  {
    id: 'workforce-kpis',
    mapIndex: 19,
    name: 'Workforce KPIs & bottlenecks',
    owner: 'workforce/intelligence/*',
    freshness: { cadence: 'on-demand', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'derived', score: 0.8 },
    dependsOn: ['workforce-jobs'],
    consumers: ['workforce-center', 'insights'],
  },
  {
    id: 'decisions',
    mapIndex: 20,
    name: 'Decisions',
    owner: 'enterprise/decisionStore',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'bounded', note: 'durable, capped at 500 decisions' },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['decision-ui', 'hub-executive', 'meeting-prep'],
  },
  {
    id: 'workspace-contexts',
    mapIndex: 21,
    name: 'Workspaces & contexts',
    owner: 'ipc/handlers/workspaceContexts',
    freshness: { cadence: 'realtime', staleAfterMinutes: null },
    completeness: { coverage: 'full', note: null },
    trust: { tier: 'runtime-recorded', score: 0.9 },
    dependsOn: [],
    consumers: ['assistant-context', 'shell'],
  },
  {
    id: 'hub-feeds',
    mapIndex: 22,
    name: 'Mission Control / Hub feeds',
    owner: 'renderer compositions (per-view)',
    freshness: { cadence: 'on-view', staleAfterMinutes: null },
    completeness: { coverage: 'partial', note: 'composite of #1–#16 — not raw evidence' },
    trust: { tier: 'derived', score: 0.6 },
    dependsOn: ['work-entities', 'timeline-events', 'workforce-jobs', 'executions', 'recommendations', 'executive-snapshots'],
    consumers: ['users'],
  },
] as const;

/** Registry lookup by id. */
export const SIGNAL_BY_ID: ReadonlyMap<string, SignalDefinition> = new Map(
  SIGNAL_REGISTRY.map((s) => [s.id, s] as const),
);

/** The signal ids the Stage 6 projection actually consumes at report time. */
export const PROJECTED_SIGNAL_IDS: readonly string[] = [
  'work-entities',
  'timeline-events',
  'workforce-jobs',
  'executions',
  'workflow-runs',
  'automation-runs',
  'connector-health',
  'assistant-conversations',
  'notification-inbox',
  'org-health',
  'system-health',
  'decisions',
] as const;

/**
 * Observed freshness vs the registry's expectation. Signals without a
 * staleness window are 'fresh' whenever a read succeeded; a missing latest
 * timestamp on a time-windowed signal is 'unknown', never assumed fresh.
 */
export function freshnessStateFor(
  def: SignalDefinition,
  latestAtMs: number | null,
  nowMs: number,
): 'fresh' | 'aging' | 'stale' | 'unknown' {
  if (def.freshness.staleAfterMinutes == null) return 'fresh';
  if (latestAtMs == null || !Number.isFinite(latestAtMs)) return 'unknown';
  const ageMinutes = Math.max(0, (nowMs - latestAtMs) / 60_000);
  if (ageMinutes <= def.freshness.staleAfterMinutes) return 'fresh';
  if (ageMinutes <= def.freshness.staleAfterMinutes * 2) return 'aging';
  return 'stale';
}

/** Build one signal's runtime status from an observed read. Pure. */
export function signalStatus(
  id: string,
  read: { available: boolean; itemCount: number | null; latestAt: string | null; note: string | null },
  nowMs: number,
): SignalRuntimeStatus {
  const def = SIGNAL_BY_ID.get(id);
  if (!def) {
    return { id, available: false, itemCount: null, latestAt: null, freshness: 'unknown', completeness: 0, note: 'unknown signal id' };
  }
  if (!read.available) {
    return { id, available: false, itemCount: null, latestAt: null, freshness: 'unknown', completeness: 0, note: read.note ?? 'read unavailable' };
  }
  const latestMs = read.latestAt ? Date.parse(read.latestAt) : NaN;
  const freshness = freshnessStateFor(def, Number.isFinite(latestMs) ? latestMs : null, nowMs);
  // Observed completeness: an available full-coverage signal is 1; bounded/partial
  // coverage declares its structural ceiling; staleness degrades it further.
  const structural = def.completeness.coverage === 'full' ? 1 : def.completeness.coverage === 'bounded' ? 0.85 : 0.6;
  const freshnessFactor = freshness === 'fresh' ? 1 : freshness === 'aging' ? 0.75 : freshness === 'stale' ? 0.5 : 0.9;
  return {
    id,
    available: true,
    itemCount: read.itemCount,
    latestAt: read.latestAt,
    freshness,
    completeness: Math.round(structural * freshnessFactor * 100) / 100,
    note: read.note,
  };
}

/** Integrity check used by the registry test + the doc lock. Pure. */
export function registryIntegrityIssues(): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const indexes = new Set<number>();
  for (const s of SIGNAL_REGISTRY) {
    if (ids.has(s.id)) issues.push(`duplicate id: ${s.id}`);
    ids.add(s.id);
    if (indexes.has(s.mapIndex)) issues.push(`duplicate mapIndex: ${s.mapIndex}`);
    indexes.add(s.mapIndex);
    if (!s.name.trim()) issues.push(`${s.id}: empty name`);
    if (!s.owner.trim()) issues.push(`${s.id}: empty owner`);
    if (s.trust.score < 0 || s.trust.score > 1) issues.push(`${s.id}: trust score out of range`);
    if (s.completeness.coverage !== 'full' && !s.completeness.note) {
      issues.push(`${s.id}: non-full coverage must state its bound`);
    }
    for (const dep of s.dependsOn) {
      if (!SIGNAL_REGISTRY.some((x) => x.id === dep)) issues.push(`${s.id}: unknown dependency ${dep}`);
    }
  }
  for (let i = 1; i <= SIGNAL_REGISTRY.length; i += 1) {
    if (!indexes.has(i)) issues.push(`missing mapIndex ${i}`);
  }
  for (const pid of PROJECTED_SIGNAL_IDS) {
    if (!ids.has(pid)) issues.push(`projected signal not in registry: ${pid}`);
  }
  return issues;
}
