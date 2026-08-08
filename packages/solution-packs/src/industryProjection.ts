/**
 * Industry projection (IP-02) — the Desktop Industry Integration Layer.
 *
 * PURE functions that project the CANONICAL `@neuropause/industry` platform data
 * (its `IndustrySolution[]`, capability matrix, and readiness) into the compact
 * view-models the desktop app and the mobile companion render. The canonical
 * types are imported from `@neuropause/industry` (single source of truth) as
 * TYPES ONLY, so this stays a pure, dependency-light adapter: it does NOT
 * re-implement the Industry SDK, registry, configuration engine, marketplace, or
 * the 20 packs — those live in `@neuropause/industry`. The desktop/backend wires
 * the real `createIndustryPlatform(runtime)` (IP-03) and feeds its data through
 * these projections.
 */
import type {
  CapabilityEvidence,
  IndustryReadiness,
  IndustrySolution,
} from '@neuropause/industry/catalog';

export interface IndustryCounts {
  objects: number;
  workflows: number;
  kpis: number;
  compliancePacks: number;
  connectors: number;
  aiSkills: number;
  documentTemplates: number;
}

/** A compact per-industry card for the desktop/mobile Industry list. */
export interface IndustrySummary {
  key: string;
  name: string;
  /** Wave-8 core domains this pack reuses (never duplicates). */
  reusesDomains: string[];
  counts: IndustryCounts;
  /** Workflows that gate on an approval (governance-relevant). */
  approvalWorkflows: number;
}

/** Project one canonical solution into its compact summary. */
export function projectIndustry(solution: IndustrySolution): IndustrySummary {
  return {
    key: solution.key,
    name: solution.name,
    reusesDomains: [...solution.reusesDomains],
    counts: {
      objects: solution.objects.length,
      workflows: solution.workflows.length,
      kpis: solution.kpis.length,
      compliancePacks: solution.compliancePacks.length,
      connectors: solution.connectors.length,
      aiSkills: solution.aiSkills.length,
      documentTemplates: solution.documentTemplates.length,
    },
    approvalWorkflows: solution.workflows.filter((w) => w.requiresApproval).length,
  };
}

/** Project all solutions, sorted by name for a stable desktop list. */
export function projectIndustries(solutions: IndustrySolution[]): IndustrySummary[] {
  return solutions.map(projectIndustry).sort((a, b) => a.name.localeCompare(b.name));
}

export interface IndustryAreaGroup {
  area: string;
  items: CapabilityEvidence[];
}

/** Group the capability-evidence matrix by area, preserving first-seen order. */
export function groupCapabilitiesByArea(matrix: CapabilityEvidence[]): IndustryAreaGroup[] {
  const order: string[] = [];
  const byArea = new Map<string, IndustryAreaGroup>();
  for (const item of matrix) {
    let group = byArea.get(item.area);
    if (!group) {
      group = { area: item.area, items: [] };
      byArea.set(item.area, group);
      order.push(item.area);
    }
    group.items.push(item);
  }
  return order.map((a) => byArea.get(a) as IndustryAreaGroup);
}

export interface IndustryReadinessView extends IndustryReadiness {
  /** live-verified as a whole-number % of total (0 when total is 0). */
  liveVerifiedPct: number;
}

/** Add a headline percentage to the honest readiness counts. */
export function readinessView(readiness: IndustryReadiness): IndustryReadinessView {
  const pct =
    readiness.total > 0 ? Math.round((readiness.liveVerified / readiness.total) * 100) : 0;
  return { ...readiness, liveVerifiedPct: pct };
}

/** Human labels for the honest evidence levels (desktop/mobile badges). */
const EVIDENCE_LABELS: Record<string, string> = {
  'live-verified': 'Live',
  'adapter-verified': 'Adapter-verified',
  'business-data-pending': 'Data pending',
  'regulated-external': 'External',
};

/** Label an evidence level; unknown levels pass through unchanged. */
export function evidenceLevelLabel(level: string): string {
  return EVIDENCE_LABELS[level] ?? level;
}
