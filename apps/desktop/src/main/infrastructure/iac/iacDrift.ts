/**
 * The IaC DRIFT engine (P6.10). PURE + deterministic + READ-ONLY — it reconciles DESIRED state (config /
 * planned values / program intent) against ACTUAL state (the tfstate / Pulumi stack export, or live discovery)
 * and reports, per resource, whether it is in sync, drifted (changed outside IaC), changed (a pending plan
 * change), missing (declared but absent), or unmanaged (present but undeclared) — with a blast-radius impact
 * score and a risk tier. It NEVER applies, refreshes, or mutates anything.
 *
 * Topology is REUSED, not recomputed: the engine builds ONE `buildResourceGraph` over the union (actual wins on
 * conflict) and reads reverse-reachability (transitive dependents) from its edges to score impact — the same
 * blast-radius the Resource Graph already computes for the Cloud Platform Center. Risk = f(drift status / change
 * action, blast-radius tier), a deterministic matrix. `nowMs` only stamps `builtAt`.
 */
import { buildResourceGraph, type CloudResource, type ResourceImpactRank } from '@neuropause/shared';
import type { ChangeSet, ChangeAction } from './iacPlan';

export type DriftStatus = 'in_sync' | 'drifted' | 'changed' | 'missing' | 'unmanaged';
export type DriftRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';
export const DRIFT_RISKS: readonly DriftRisk[] = ['none', 'low', 'medium', 'high', 'critical'] as const;
export const DRIFT_STATUSES: readonly DriftStatus[] = ['in_sync', 'drifted', 'changed', 'missing', 'unmanaged'] as const;

export interface ResourceDrift {
  resourceId: string;
  address: string;
  resourceType: string;
  provider: string;
  name: string;
  status: DriftStatus;
  action: ChangeAction | null;
  changedAttributes: string[];
  /** Transitive dependents (blast radius) — reused from the Resource Graph, not recomputed. */
  impactScore: number;
  dependents: number;
  risk: DriftRisk;
}

export interface DriftCounts {
  total: number;
  inSync: number;
  drifted: number;
  changed: number;
  missing: number;
  unmanaged: number;
  byRisk: Record<DriftRisk, number>;
  byStatus: Record<DriftStatus, number>;
}

export interface DriftReport {
  resources: ResourceDrift[];
  counts: DriftCounts;
  /** Drifted/changed/missing/unmanaged nodes ranked by blast radius (single-point-of-failure candidates). */
  topImpact: ResourceImpactRank[];
  /** 0–100, 100 = fully in sync (deterministic, clamped). */
  driftScore: number;
  builtAt: string;
}

export interface DriftInput {
  desired: CloudResource[];
  actual: CloudResource[];
  /** Optional `analyzePlan()` output — enriches action + out-of-band drift flags. */
  changes?: ChangeSet;
}

/** A content signature EXCLUDING run-clock timestamps, so an unchanged re-read is a true no-op. */
function signature(r: CloudResource): string {
  return JSON.stringify([
    r.name,
    r.resourceType,
    r.status,
    r.health,
    Object.entries(r.tags).sort(),
    Object.entries(r.attributes).sort(),
    r.relationships.map((x) => `${x.type}:${x.targetId}`).sort(),
  ]);
}

function attrDiff(a: CloudResource | undefined, b: CloudResource | undefined): string[] {
  const av = a?.attributes ?? {};
  const bv = b?.attributes ?? {};
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  const out: string[] = [];
  for (const k of keys) if (JSON.stringify(av[k]) !== JSON.stringify(bv[k])) out.push(k);
  return out.sort();
}

function blastTier(blast: number): 'spof' | 'high' | 'med' | 'iso' {
  if (blast >= 10) return 'spof';
  if (blast >= 3) return 'high';
  if (blast >= 1) return 'med';
  return 'iso';
}

/** Deterministic risk matrix = f(status/action, blast tier). Destructive actions (delete/replace) escalate. */
function riskFor(status: DriftStatus, action: ChangeAction | null, tier: 'spof' | 'high' | 'med' | 'iso'): DriftRisk {
  const destructive = action === 'delete' || action === 'replace';
  if (destructive) return tier === 'spof' ? 'critical' : tier === 'high' ? 'critical' : tier === 'med' ? 'high' : 'medium';
  switch (status) {
    case 'in_sync':
      return 'none';
    case 'drifted':
      return tier === 'spof' ? 'high' : tier === 'high' ? 'high' : tier === 'med' ? 'medium' : 'low';
    case 'changed':
      return tier === 'spof' ? 'high' : tier === 'high' ? 'medium' : tier === 'med' ? 'medium' : 'low';
    case 'missing':
      return tier === 'spof' ? 'medium' : tier === 'high' ? 'medium' : 'low';
    case 'unmanaged':
      return tier === 'spof' ? 'medium' : 'low';
    default:
      return 'low';
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Reconcile desired vs actual into a `DriftReport`. Pure, read-only, deterministic. */
export function computeDrift(input: DriftInput, nowMs: number): DriftReport {
  const desiredById = new Map(input.desired.map((r) => [r.id, r] as const));
  const actualById = new Map(input.actual.map((r) => [r.id, r] as const));
  // Union graph — actual wins on conflict so topology reflects reality; desired-only nodes still contribute edges.
  const merged = new Map<string, CloudResource>();
  for (const r of input.desired) merged.set(r.id, r);
  for (const r of input.actual) merged.set(r.id, r);
  const model = buildResourceGraph({ resources: [...merged.values()] }, nowMs);

  // Reverse adjacency (dep → dependents) for blast radius, built once.
  const inAdj = new Map<string, string[]>();
  for (const e of model.edges) (inAdj.get(e.to) ?? inAdj.set(e.to, []).get(e.to)!).push(e.from);
  const blastOf = (id: string): number => {
    const seen = new Set<string>([id]);
    const stack = [...(inAdj.get(id) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const p of inAdj.get(n) ?? []) if (!seen.has(p)) stack.push(p);
    }
    return seen.size - 1;
  };

  const changeByAddress = new Map((input.changes?.changes ?? []).map((c) => [c.address, c] as const));

  const rows: ResourceDrift[] = [];
  for (const [id, r] of merged) {
    const inActual = actualById.has(id);
    const inDesired = desiredById.has(id);
    const change = changeByAddress.get(r.nativeId);
    let status: DriftStatus;
    const action: ChangeAction | null = change?.action ?? null;

    if (change) {
      if (change.fromDrift) status = 'drifted';
      else if (change.action === 'create') status = 'missing';
      else if (change.action === 'delete') status = 'unmanaged';
      else if (change.action === 'update' || change.action === 'replace') status = 'changed';
      else status = 'in_sync'; // no-op / read
    } else if (inActual && inDesired) {
      status = signature(desiredById.get(id)!) === signature(actualById.get(id)!) ? 'in_sync' : 'drifted';
    } else if (inActual) {
      status = 'unmanaged';
    } else {
      status = 'missing';
    }

    const changedAttributes = change?.changedKeys.length ? change.changedKeys : attrDiff(desiredById.get(id), actualById.get(id));
    const impactScore = status === 'in_sync' ? 0 : blastOf(id); // only score the interesting set
    const dependents = inAdj.get(id)?.length ?? 0;
    rows.push({
      resourceId: id,
      address: r.nativeId,
      resourceType: r.resourceType,
      provider: r.provider,
      name: r.name,
      status,
      action,
      changedAttributes,
      impactScore,
      dependents,
      risk: riskFor(status, action, blastTier(impactScore)),
    });
  }

  rows.sort((a, b) => {
    const ri = DRIFT_RISKS.indexOf(b.risk) - DRIFT_RISKS.indexOf(a.risk);
    if (ri !== 0) return ri;
    if (b.impactScore !== a.impactScore) return b.impactScore - a.impactScore;
    return a.address.localeCompare(b.address);
  });

  const counts: DriftCounts = {
    total: rows.length,
    inSync: 0,
    drifted: 0,
    changed: 0,
    missing: 0,
    unmanaged: 0,
    byRisk: { none: 0, low: 0, medium: 0, high: 0, critical: 0 },
    byStatus: { in_sync: 0, drifted: 0, changed: 0, missing: 0, unmanaged: 0 },
  };
  for (const row of rows) {
    counts.byStatus[row.status] += 1;
    counts.byRisk[row.risk] += 1;
  }
  counts.inSync = counts.byStatus.in_sync;
  counts.drifted = counts.byStatus.drifted;
  counts.changed = counts.byStatus.changed;
  counts.missing = counts.byStatus.missing;
  counts.unmanaged = counts.byStatus.unmanaged;

  const topImpact: ResourceImpactRank[] = rows
    .filter((r) => r.status !== 'in_sync' && r.impactScore > 0)
    .sort((a, b) => b.impactScore - a.impactScore || a.address.localeCompare(b.address)) // ranked by blast radius, per the field
    .slice(0, 10)
    .map((r) => ({ resourceId: r.resourceId, name: r.name, resourceType: r.resourceType, blastRadius: r.impactScore }));

  const total = rows.length;
  const driftScore = total === 0 ? 100 : clamp(Math.round((100 * counts.inSync) / total - counts.byRisk.critical * 10 - counts.byRisk.high * 4 - counts.drifted * 2), 0, 100);

  return { resources: rows, counts, topImpact, driftScore, builtAt: new Date(nowMs).toISOString() };
}
