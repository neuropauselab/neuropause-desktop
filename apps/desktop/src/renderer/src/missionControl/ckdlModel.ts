/**
 * NCEA 11.1, Phase 9 — Mission Control × CKDL projection (pure view-model).
 *
 * Mission Control gains evidence-aware navigation WITHOUT adding business logic to
 * the UI. Every function here is a pure projection over a snapshot the host
 * marshals from the Constitutional Knowledge & Decision Layer's runtime APIs
 * (decisions, objectives, evidence, trust, relationships). The layer computes the
 * facts — trust scores, derived progress, provenance — and this model only shapes
 * them for display: decision history, trust badges, purpose rollups, evidence
 * coverage, linked work, and risks. Read-only; no runtime logic is duplicated.
 */

export type TrustBand = 'low' | 'moderate' | 'high';
export type DecisionStatus = 'proposed' | 'approved' | 'rejected' | 'executed' | 'superseded';

export interface DecisionSummary {
  id: string;
  purpose: string;
  status: DecisionStatus;
  owner: string;
  approval: 'pending' | 'approved' | 'rejected';
  evidenceCount: number;
  trustBand?: TrustBand;
  trustScore?: number;
  at: number;
  linkedWorkKeys: string[];
}

export interface ObjectiveSummary {
  id: string;
  kind: 'mission' | 'goal' | 'objective';
  title: string;
  owner: string;
  /** Progress is DERIVED by the CKDL layer from key results — the UI only displays it. */
  progress: number;
}

export interface EntityContext {
  key: string;
  label: string;
  kind: string;
  evidenceCount: number;
  trustBand?: TrustBand;
  trustScore?: number;
  decisionIds: string[];
  objectiveIds: string[];
  linkedWorkKeys: string[];
  riskKeys: string[];
}

export interface RiskItem {
  key: string;
  label: string;
  linkedDecisionIds: string[];
}

export interface CkdlSnapshot {
  decisions: DecisionSummary[];
  objectives: ObjectiveSummary[];
  entities: EntityContext[];
  risks: RiskItem[];
}

export interface TrustBadge {
  band: TrustBand;
  label: string;
  tone: 'ok' | 'warn' | 'crit';
  percent: number;
}

/** Map a trust band + score to a display badge (tone + label). */
export function trustBadge(band: TrustBand, score: number): TrustBadge {
  const tone = band === 'high' ? 'ok' : band === 'moderate' ? 'warn' : 'crit';
  return { band, label: band, tone, percent: Math.round(score * 100) };
}

/** Decision history, newest first. */
export function decisionHistory(snapshot: CkdlSnapshot, opts: { limit?: number; status?: DecisionStatus } = {}): DecisionSummary[] {
  return snapshot.decisions
    .filter((d) => opts.status === undefined || d.status === opts.status)
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, opts.limit ?? 25);
}

/** Decisions still awaiting a human decision — the approval surface. */
export function decisionsAwaitingApproval(snapshot: CkdlSnapshot): DecisionSummary[] {
  return snapshot.decisions.filter((d) => d.approval === 'pending');
}

/**
 * Evidence coverage — honest visibility into how well-backed the decisions are.
 * `weakest` lists decisions with the fewest evidence items so gaps are obvious.
 */
export function evidenceCoverage(snapshot: CkdlSnapshot): { decisions: number; avgEvidence: number; unbacked: number; weakest: DecisionSummary[] } {
  const decisions = snapshot.decisions;
  if (decisions.length === 0) return { decisions: 0, avgEvidence: 0, unbacked: 0, weakest: [] };
  const totalEvidence = decisions.reduce((s, d) => s + d.evidenceCount, 0);
  return {
    decisions: decisions.length,
    avgEvidence: totalEvidence / decisions.length,
    unbacked: decisions.filter((d) => d.evidenceCount === 0).length,
    weakest: [...decisions].sort((a, b) => a.evidenceCount - b.evidenceCount).slice(0, 3),
  };
}

/** Purpose rollup: objective count + mean derived progress. */
export function purposeRollup(snapshot: CkdlSnapshot): { objectives: number; avgProgress: number; atRisk: ObjectiveSummary[] } {
  const objectives = snapshot.objectives;
  if (objectives.length === 0) return { objectives: 0, avgProgress: 0, atRisk: [] };
  const avgProgress = objectives.reduce((s, o) => s + o.progress, 0) / objectives.length;
  return { objectives: objectives.length, avgProgress, atRisk: objectives.filter((o) => o.progress < 0.4) };
}

/** Full context panel for one entity — purpose/evidence/trust/linked work/risks. */
export function entityContext(snapshot: CkdlSnapshot, key: string): EntityContext | undefined {
  return snapshot.entities.find((e) => e.key === key);
}

/** Entities carrying a low trust indicator — surfaced so weak knowledge is visible. */
export function lowTrustEntities(snapshot: CkdlSnapshot): EntityContext[] {
  return snapshot.entities.filter((e) => e.trustBand === 'low');
}

/** Risks with the decisions they touch — the risk panel. */
export function riskPanel(snapshot: CkdlSnapshot): RiskItem[] {
  return [...snapshot.risks].sort((a, b) => b.linkedDecisionIds.length - a.linkedDecisionIds.length);
}
