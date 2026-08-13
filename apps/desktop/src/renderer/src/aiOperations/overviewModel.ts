/**
 * AI Operating Platform — Overview (operating loop) + the two reuse-only deep-link tabs.
 *
 * The Overview derives an at-a-glance status for each stage of the operating loop
 * from the ALREADY-computed tab lenses (no extra data fetch, no fabrication). The
 * Orchestration and Memory tabs are deliberately THIN: the platform already ships a
 * canonical Orchestration Center (P17) and a unified knowledge/memory workspace
 * (knowledge2), so these tabs present a real summary and DEEP-LINK to those centers
 * rather than duplicating them — honoring the "reuse, never duplicate" rule.
 */
import type { IconName } from '@renderer/components/ui/Icon';
import { type OpLens, type OpsTone, count, pctText, healthTone } from './aiOperationsModel';

export type OpsTab =
  | 'overview'
  | 'planning'
  | 'reasoning'
  | 'orchestration'
  | 'memory'
  | 'simulation'
  | 'decisions'
  | 'governance'
  | 'learning'
  | 'executive';

/** One stage of the operating loop, summarized for the Overview grid. */
export interface LoopStage {
  key: OpsTab;
  verb: string;
  label: string;
  icon: IconName;
  headline: string;
  gaps: number;
  tone: OpsTone;
}

/** Canonical order of the operating loop: plan -> reason -> ... -> optimize. */
export const LOOP_ORDER: { key: OpsTab; verb: string; label: string; icon: IconName }[] = [
  { key: 'planning', verb: 'Plan', label: 'Planning', icon: 'checklist' },
  { key: 'reasoning', verb: 'Reason', label: 'Reasoning', icon: 'lightbulb' },
  { key: 'orchestration', verb: 'Orchestrate', label: 'Orchestration', icon: 'command' },
  { key: 'simulation', verb: 'Simulate', label: 'Simulation', icon: 'beaker' },
  { key: 'decisions', verb: 'Decide', label: 'Decisions', icon: 'verified' },
  { key: 'governance', verb: 'Govern', label: 'AI Governance', icon: 'shield' },
  { key: 'learning', verb: 'Learn', label: 'Learning', icon: 'pulse' },
  { key: 'memory', verb: 'Remember', label: 'Memory', icon: 'memory' },
  { key: 'executive', verb: 'Optimize', label: 'Executive', icon: 'sparkles' },
];

/**
 * Derive the operating-loop overview from the computed lenses. Each stage's headline
 * is that lens's first real stat (or an honest "No live data yet"), and the gap count
 * is that lens's honest-gap list length. No new data, no fabrication.
 */
export function operatingLoop(lenses: Partial<Record<OpsTab, OpLens>>): LoopStage[] {
  return LOOP_ORDER.map(({ key, verb, label, icon }) => {
    const lens = lenses[key];
    const s0 = lens?.stats?.[0];
    return {
      key,
      verb,
      label,
      icon,
      headline: s0 ? `${s0.label}: ${s0.value}` : 'No live data yet',
      gaps: lens?.gaps?.length ?? 0,
      tone: s0?.tone ?? 'gray',
    };
  });
}

/* ── Orchestration tab (thin: summary + deep-link to the canonical Orchestration Center) ── */

export interface OrchestrationInput {
  /** ipc.orchestration.overview() -> OrchestrationOverview (P17, read-only projection). */
  orchestration?: {
    orchestrators?: readonly unknown[];
    flows?: readonly unknown[];
  } | null;
  /** ipc.workforce.intelligence() -> WorkforceIntelligence (real job-history-derived signal). */
  workforce?: {
    overallSuccessRate?: number;
    execution?: { totals?: { total?: number; failed?: number } };
    bottlenecks?: readonly unknown[];
  } | null;
}

export function summarizeOrchestration(input: OrchestrationInput = {}): OpLens {
  const orch = input.orchestration ?? undefined;
  const wf = input.workforce ?? undefined;
  const orchestrators = orch?.orchestrators?.length ?? 0;
  const flows = orch?.flows?.length ?? 0;
  const totalJobs = wf?.execution?.totals?.total ?? 0;
  const failed = wf?.execution?.totals?.failed ?? 0;
  const bottlenecks = wf?.bottlenecks?.length ?? 0;
  const successRate = typeof wf?.overallSuccessRate === 'number' ? wf.overallSuccessRate : undefined;

  const stats: OpLens['stats'] = [
    { icon: 'command', label: 'Orchestrators', value: count(orchestrators), tone: orchestrators > 0 ? 'blue' : 'gray' },
    { icon: 'layers', label: 'Coordination flows', value: count(flows), tone: flows > 0 ? 'blue' : 'gray' },
  ];
  if (successRate !== undefined) {
    stats.push({
      icon: 'pulse',
      label: 'Delegated success rate',
      value: pctText(successRate),
      tone: healthTone(successRate),
      hint: `${count(totalJobs)} jobs · ${count(failed)} failed`,
    });
  }
  stats.push({ icon: 'activity', label: 'Bottlenecks', value: count(bottlenecks), tone: bottlenecks > 0 ? 'orange' : 'green' });

  const groups: OpLens['groups'] = [
    {
      title: 'Delegation & routing (reused)',
      note: 'Live routing, capability-matching and retry/fallback run in the Orchestration Center and Workforce delegation — this tab summarizes them.',
      rows: [
        { label: 'Registered orchestrators', value: count(orchestrators) },
        { label: 'Coordination flows', value: count(flows) },
        { label: 'Jobs executed (all-time)', value: count(totalJobs), sub: `${count(failed)} failed` },
      ],
    },
  ];

  return {
    stats,
    groups,
    gaps: [
      { capability: 'Worker scheduling / next-run', requires: 'a schedule store + UI — the runtime scheduler is FIFO drain-on-tick with no cron/next-run' },
      { capability: 'Runtime priority queue', requires: 'a priority scheduler — priority today only tie-breaks planning order' },
      { capability: 'Live parallel-concurrency meter', requires: 'a concurrency runtime — the orchestrator advances DAG branches in one synchronous pass' },
      { capability: 'Retry back-off timer', requires: 'enforced back-off — the delay is computed but not applied (synchronous contract)' },
    ],
    links: [
      { label: 'Orchestration Center', section: 'orchestration-center', icon: 'command' },
      { label: 'Workforce delegation', section: 'workforce-center', icon: 'cpu' },
    ],
  };
}

/* ── Memory tab (thin: summary + deep-link to the unified knowledge/memory workspace) ── */

export interface MemoryInput {
  /** ipc.memory.counts() -> MemoryCounts. */
  memory?: { total?: number; lastBuiltAt?: string | null } | null;
  /** ipc.graph.counts() -> GraphCounts. */
  graph?: { nodes?: number; edges?: number } | null;
}

export function summarizeMemory(input: MemoryInput = {}): OpLens {
  const mem = input.memory ?? undefined;
  const graph = input.graph ?? undefined;
  const memTotal = mem?.total ?? 0;
  const nodes = graph?.nodes ?? 0;
  const edges = graph?.edges ?? 0;

  const stats: OpLens['stats'] = [
    { icon: 'memory', label: 'Memory items', value: count(memTotal), tone: memTotal > 0 ? 'purple' : 'gray' },
    { icon: 'database', label: 'Graph nodes', value: count(nodes), tone: nodes > 0 ? 'blue' : 'gray' },
    { icon: 'layers', label: 'Graph edges', value: count(edges), tone: edges > 0 ? 'blue' : 'gray' },
  ];

  const groups: OpLens['groups'] = [
    {
      title: 'Unified recall (reused)',
      note: 'Enterprise Search, AI Memory, the knowledge graph, topics, decisions and governance are already unified in the Knowledge workspace — this tab summarizes them and links out.',
      rows: [
        { label: 'Operational memory items', value: count(memTotal), sub: mem?.lastBuiltAt ? `built ${mem.lastBuiltAt}` : 'empty until connectors sync' },
        { label: 'Knowledge graph', value: `${count(nodes)} nodes · ${count(edges)} edges` },
      ],
    },
  ];

  return {
    stats,
    groups,
    gaps: [
      { capability: 'Memory analytics aggregation', requires: 'a memory.analytics endpoint — counts + audit + topics exist, but no dedicated aggregation channel' },
      { capability: 'Curated document / research library, playbooks, SOPs', requires: 'a content store — not present in-app (surfaced honestly by the Knowledge workspace)' },
    ],
    links: [
      { label: 'Knowledge workspace', section: 'knowledge', icon: 'doc' },
      { label: 'Enterprise Knowledge', section: 'knowledge-center', icon: 'database' },
    ],
  };
}
