/**
 * AI Operating Platform — Decision Intelligence tab derivation (Phase 3).
 *
 * A PURE lens over the platform's already-persisted executive decisions
 * (`ipc.decisions.list()` -> `{ decisions: ExecutiveDecision[] }`,
 * packages/shared/src/types/executiveCenter.ts). It adds NO new runtime, IPC
 * channel, engine, or store — it only re-reads existing decision records and reports,
 * honestly, how much of an *ideal decision* each one actually carries.
 *
 * An ideal decision carries NINE things:
 *
 *   evidence · alternatives · policies · risks · recommendations · approvals ·
 *   execution history · outcome · lessons learned
 *
 * Of these, the real `ExecutiveDecision` record genuinely backs FIVE with concrete
 * fields — evidence[], fromRecommendationId/relatedRecommendations, the status
 * lifecycle, history[], and expectedOutcome. The other FOUR have no source in the
 * platform at all, so they are surfaced as honest, labeled `OpGap`s ("Requires ...")
 * rather than invented numbers. That is the production-authenticity contract: every
 * stat and row below is derived from a real field; every gap is a genuine
 * architectural absence; an empty dataset shows the honest empty state.
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from './aiOperationsModel';

/**
 * Minimal structural view of a persisted `ExecutiveDecision`. Every field is
 * optional and the derivation never trusts the shape: absent or ill-typed fields
 * degrade to honest zeros/gaps, never to fabricated values. Field names mirror the
 * verified real type (executiveCenter.ts), so a raw record — or the whole
 * `ipc.decisions.list()` result — can be passed straight through.
 */
export interface DecisionRecord {
  id?: string;
  /** Lifecycle status: draft | suggested | accepted | in_progress | blocked | completed | rejected | archived. */
  status?: string;
  /** 0..1 model/heuristic confidence. */
  confidence?: number;
  /** Source-linked evidence references. */
  evidence?: unknown[];
  reasoning?: string;
  /** The outcome the decision is EXPECTED to achieve — not a measured result. */
  expectedOutcome?: string;
  /** ISO completion timestamp (presence only; not an outcome measurement). */
  completedAt?: string;
  /** Back-reference to the originating recommendation, for traceability. */
  fromRecommendationId?: string;
  /** Further related recommendation ids. */
  relatedRecommendations?: unknown[];
  /** Append-only lifecycle history events. */
  history?: unknown[];
}

/**
 * Input to the Decision Intelligence derivation. Mirrors the `ipc.decisions.list()`
 * envelope (`{ decisions }`) so the awaited IPC result passes straight through.
 * Defensively optional throughout.
 */
export interface DecisionInput {
  decisions?: DecisionRecord[] | null;
}

/** Neutral tone for every honest gap row — never a misleading status hue. */
const GAP_TONE: OpsTone = 'gray';

/**
 * The four capabilities an `ExecutiveDecision` genuinely cannot back today. These
 * are architectural truths independent of how many decisions exist, so they are
 * surfaced in every lens — populated or empty.
 */
const DECISION_GAPS: OpGap[] = [
  {
    capability: 'Alternatives considered',
    requires: 'a decision-alternatives model — no such field/source exists',
  },
  {
    capability: 'Lessons learned',
    requires: 'a post-decision learning store — no field/source exists',
  },
  {
    capability: 'Measured outcome (actual vs expected)',
    requires: 'outcome telemetry — decisions record only expected outcome + completedAt',
  },
  {
    capability: 'Policy & approver trail on general decisions',
    requires:
      'populating them — the governance-trace builder returns empty approvals/policies today',
  },
];

/** Deep-links to the existing surfaces that own decision governance (reuse, not duplicate). */
const DECISION_LINKS: OpLink[] = [
  { label: 'Decision Center', section: 'decision-center', icon: 'sparkles' },
  { label: 'Governance & approvals', section: 'administration', icon: 'shield' },
  { label: 'Worker approvals', section: 'workforce', icon: 'cpu' },
];

/** Statuses that mean the decision has NOT yet been ruled on (pre-approval). */
const PENDING_STATUSES = new Set(['draft', 'suggested']);

/** Human labels for the raw lifecycle statuses. */
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  suggested: 'Suggested',
  accepted: 'Accepted',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
  rejected: 'Rejected',
  archived: 'Archived',
};

const hasItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

/** A populated coverage row: "<n> of <total>" toned by how much of the field is filled. */
function presentRow(label: string, n: number, total: number, sub: string): OpRow {
  const ratio = total > 0 ? n / total : Number.NaN;
  return {
    label,
    value: `${count(n)} of ${count(total)}`,
    tone: healthTone(ratio),
    sub: `${pctText(ratio)} populated · ${sub}`,
  };
}

/** An honest gap row: no fabricated number, only the reason the field is absent. */
function gapRow(label: string, reason: string): OpRow {
  return { label, value: 'Gap', tone: GAP_TONE, sub: reason };
}

/** Tone for a lifecycle status (only where a status genuinely implies health). */
function statusTone(status: string): OpsTone | undefined {
  switch (status) {
    case 'completed':
      return 'green';
    case 'blocked':
    case 'rejected':
      return 'red';
    case 'archived':
      return 'gray';
    default:
      return undefined;
  }
}

/**
 * Decision Intelligence lens. Over REAL decision records, reports which of the nine
 * ideal-decision fields are genuinely populated and labels the remaining four as
 * honest architectural gaps.
 */
export function summarizeDecisions(input: DecisionInput = {}): OpLens {
  const decisions: DecisionRecord[] =
    input && Array.isArray(input.decisions) ? input.decisions : [];
  const total = decisions.length;

  // The four architectural gaps and the deep-links hold regardless of data volume,
  // so an empty dataset still shows them — the honest empty state, not a placeholder.
  if (total === 0) {
    return { stats: [], groups: [], gaps: [...DECISION_GAPS], links: [...DECISION_LINKS] };
  }

  // ── Real per-record signals — each a genuine field on ExecutiveDecision. ──
  let withEvidence = 0;
  let linkedReco = 0;
  let decided = 0; // status past the pending stage → an approval decision was made
  let withHistory = 0;
  let withExpectedOutcome = 0;
  let pending = 0;
  let confidenceSum = 0;
  let confidenceN = 0;
  const byStatus = new Map<string, number>();

  for (const d of decisions) {
    if (hasItems(d.evidence)) withEvidence += 1;
    if (hasText(d.fromRecommendationId) || hasItems(d.relatedRecommendations)) linkedReco += 1;
    if (hasItems(d.history)) withHistory += 1;
    if (hasText(d.expectedOutcome)) withExpectedOutcome += 1;

    const status = typeof d.status === 'string' ? d.status.trim() : '';
    if (status) {
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      if (PENDING_STATUSES.has(status)) pending += 1;
      else decided += 1;
    }

    if (typeof d.confidence === 'number' && Number.isFinite(d.confidence)) {
      confidenceSum += d.confidence;
      confidenceN += 1;
    }
  }

  // Completeness across the FIVE fields the record can really back (0..1).
  const coverageRatio =
    (withEvidence + linkedReco + decided + withHistory + withExpectedOutcome) / (5 * total);
  const evidenceRatio = withEvidence / total;
  const pendingRatio = pending / total;
  const meanConfidence = confidenceN > 0 ? confidenceSum / confidenceN : Number.NaN;

  const stats: OpStat[] = [
    { icon: 'checklist', label: 'Decisions', value: count(total), hint: 'real records' },
    {
      icon: 'gauge',
      label: 'Field coverage',
      value: pctText(coverageRatio),
      tone: healthTone(coverageRatio),
      hint: '5 real fields per record',
    },
    {
      icon: 'sparkles',
      label: 'Model confidence',
      value: pctText(meanConfidence),
      tone: healthTone(meanConfidence),
      hint: 'model/heuristic, mean',
    },
    {
      icon: 'clipboard',
      label: 'Evidence-backed',
      value: pctText(evidenceRatio),
      tone: healthTone(evidenceRatio),
      hint: '≥1 evidence reference',
    },
    {
      icon: 'clock',
      label: 'Awaiting decision',
      value: pctText(pendingRatio),
      tone: riskTone(pendingRatio),
      hint: 'draft/suggested — not yet ruled on',
    },
  ];

  // ── The nine ideal-decision fields: five backed by real data, four honest gaps. ──
  const coverageRows: OpRow[] = [
    presentRow('Evidence', withEvidence, total, 'source-linked references'),
    gapRow('Alternatives', 'No alternatives model — options are never recorded'),
    gapRow('Policies', 'Governance-trace builder returns empty policies'),
    gapRow('Risks', 'No risk field on the decision record'),
    presentRow('Recommendations', linkedReco, total, 'linked to a recommendation'),
    presentRow('Approvals', decided, total, 'status/approval lifecycle'),
    presentRow('Execution history', withHistory, total, 'lifecycle history events'),
    presentRow('Outcome', withExpectedOutcome, total, 'expected only — actual not measured'),
    gapRow('Lessons learned', 'No post-decision learning store'),
  ];

  const groups: OpGroup[] = [
    {
      title: 'Ideal decision — 9-field coverage',
      rows: coverageRows,
      note:
        `Over ${count(total)} real decision record(s): 5 of 9 fields have a genuine source; ` +
        'the remaining 4 are architectural gaps, not zeros.',
    },
  ];

  // ── Lifecycle-status breakdown — only statuses that genuinely occur. ──
  const statusRows: OpRow[] = [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => ({
      label: STATUS_LABELS[status] ?? status,
      value: count(n),
      tone: statusTone(status),
      sub: pctText(n / total),
    }));
  if (statusRows.length > 0) {
    groups.push({ title: 'Lifecycle status', rows: statusRows });
  }

  return { stats, groups, gaps: [...DECISION_GAPS], links: [...DECISION_LINKS] };
}
