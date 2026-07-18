/**
 * Knowledge Workspace v1.0 — the pure view-model (no React, no I/O; tested).
 *
 * The Knowledge Workspace is a REUSE-ONLY presentation lens. It composes the already-real retrieval and
 * knowledge surfaces — federated Enterprise Search, AI Memory, the Knowledge Graph (EKG) + Enterprise org
 * graph, the P16 Knowledge Fabric, Executive Decisions + Governance traces, and enterprise Governance /
 * Compliance — and deep-links to their existing centers (AI Memory, Knowledge Fabric, Enterprise). It
 * creates NO store, index, search engine, or graph, duplicates nothing, and mutates nothing. This file only
 * labels/tones/summarises that real data, and records — honestly — the knowledge capabilities the platform
 * does NOT have in-app (a curated document / research / architecture library, playbooks, SOPs), so the
 * workspace never fabricates them.
 */
import type {
  ComplianceSeverity,
  ComplianceStatus,
  EnterpriseSearchResult,
  ExecutiveDecision,
  FabricBand,
  MemoryCounts,
  SearchSourceKind,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

/** The section id the coordinator registers this workspace under. */
export const KNOWLEDGE_SECTION_ID = 'knowledge';

/* ── status / band → tone maps (reuse the ops tone system) ──────────────────── */

/** Compliance finding status → tone (pass = green, warn = orange, fail = red). */
export function complianceStatusTone(s: ComplianceStatus): OpsTone {
  return s === 'pass' ? 'green' : s === 'warn' ? 'orange' : 'red';
}

/**
 * Health/confidence band → tone. The fabric + KPI band is a 4-level escalation
 * (healthy → watch → at-risk → critical); the monochrome tone system collapses
 * the two worst bands to `red`, keeping the escalation honest and legible.
 */
export function bandTone(b: FabricBand): OpsTone {
  return b === 'healthy' ? 'green' : b === 'watch' ? 'orange' : 'red';
}

/** Governance/compliance rule severity → tone (critical = red, warning = orange, info = gray). */
export function severityTone(s: ComplianceSeverity): OpsTone {
  return s === 'critical' ? 'red' : s === 'warning' ? 'orange' : 'gray';
}

/**
 * Generic keyword tone for the varying string states the workspace renders (decision status + priority,
 * enabled/disabled). Defensive: negative words are matched FIRST so a positive substring never reads green,
 * and an unknown value falls back to gray — it never invents a status.
 */
export function keywordTone(raw: string | null | undefined): OpsTone {
  const s = (raw ?? '').toLowerCase();
  if (/(critical|blocked|rejected|fail|invalid|error|disabled|high)/.test(s)) return 'red';
  if (/(warn|watch|pending|draft|suggested|medium|in_progress|in progress|at-risk|at risk)/.test(s)) return 'orange';
  if (/(pass|healthy|accepted|completed|active|approved|enabled|running|low|ok)/.test(s)) return 'green';
  return 'gray';
}

/* ── the honest knowledge-gap catalog (verified ABSENT in-app; never fabricated) ── */

/**
 * Knowledge capabilities the platform does NOT surface in-app. Each is verified ABSENT from source: there is
 * no curated/editable document corpus (only read-only connector-synced documents are reachable through
 * Search + the graph), and no playbook / SOP store. Every entry `Requires architecture` — a new persisted
 * store + engine — so the workspace shows them as honest, labeled rows rather than inventing them.
 */
export interface KnowledgeGap {
  area: string;
  capability: string;
  /** Always 'Requires architecture' — closing the gap needs a new store/engine, not a new lens. */
  requirement: 'Requires architecture';
  reason: string;
}

export const KNOWLEDGE_GAPS: KnowledgeGap[] = [
  {
    area: 'Documents',
    capability: 'Curated document store',
    requirement: 'Requires architecture',
    reason:
      'No curated or editable document corpus exists — only read-only connector-synced documents surface through Enterprise Search and the graph; there is no in-app document library store.',
  },
  {
    area: 'Research Library',
    capability: 'Research library',
    requirement: 'Requires architecture',
    reason:
      'No research-library store or curation surface exists; research artifacts are not modeled as a first-class, browsable corpus.',
  },
  {
    area: 'Architecture Library',
    capability: 'Architecture / decision-record library',
    requirement: 'Requires architecture',
    reason:
      'No architecture-document or ADR library store exists; only connector-synced documents are reachable, read-only, via Search.',
  },
  {
    area: 'Playbooks',
    capability: 'Playbooks',
    requirement: 'Requires architecture',
    reason: 'No playbook authoring or persistence surface exists in the platform.',
  },
  {
    area: 'SOPs',
    capability: 'Standard operating procedures',
    requirement: 'Requires architecture',
    reason: 'No SOP store or authoring surface exists; procedures are not a modeled entity.',
  },
];

/** The single, honest meta every knowledge gap shares (all require new architecture). */
export function knowledgeGapMeta(): { label: string; tone: OpsTone; icon: IconName } {
  return { label: 'Requires architecture', tone: 'gray', icon: 'info' };
}

/* ── pure summaries over the real knowledge data ────────────────────────────── */

export interface MemorySummary {
  total: number;
  /** Distinct memory kinds present. */
  kinds: number;
  /** Distinct origin sources present. */
  origins: number;
  /** The single most common kind, or null when the corpus is empty. */
  topKind: { kind: string; count: number } | null;
  lastBuiltAt: string | null;
}

export function summarizeMemory(counts: MemoryCounts | null): MemorySummary {
  if (!counts) return { total: 0, kinds: 0, origins: 0, topKind: null, lastBuiltAt: null };
  const kindEntries = Object.entries(counts.byKind);
  const top = kindEntries.length ? kindEntries.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  return {
    total: counts.total,
    kinds: kindEntries.length,
    origins: Object.keys(counts.byOrigin).length,
    topKind: top ? { kind: top[0], count: top[1] } : null,
    lastBuiltAt: counts.lastBuiltAt,
  };
}

export interface SearchSummary {
  /** Total matches across all sources (server-reported). */
  total: number;
  /** Merged + ranked hits actually returned. */
  hitCount: number;
  /** Which retrievers answered. */
  backends: string[];
  /** Per-source breakdown, in the result's order. */
  bySource: { source: SearchSourceKind; total: number }[];
}

export function summarizeSearch(result: EnterpriseSearchResult | null): SearchSummary {
  if (!result) return { total: 0, hitCount: 0, backends: [], bySource: [] };
  return {
    total: result.total,
    hitCount: result.hits.length,
    backends: result.backends,
    bySource: result.groups.map((g) => ({ source: g.source, total: g.total })),
  };
}

export interface DecisionSummary {
  total: number;
  byStatus: Record<string, number>;
  /** Mean confidence across decisions, 0..1 (0 when empty). */
  avgConfidence: number;
  /** Decisions at `critical` or `high` priority. */
  highPriority: number;
}

export function summarizeDecisions(decisions: ExecutiveDecision[]): DecisionSummary {
  const byStatus: Record<string, number> = {};
  let confSum = 0;
  let highPriority = 0;
  for (const d of decisions) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    confSum += d.confidence;
    if (d.priority === 'critical' || d.priority === 'high') highPriority += 1;
  }
  return {
    total: decisions.length,
    byStatus,
    avgConfidence: decisions.length ? confSum / decisions.length : 0,
    highPriority,
  };
}
