/**
 * S113 harvest (H8) — decision-quality: surface MISSING EVIDENCE and caveats so weak
 * recommendations/decisions are visible. ADVISORY ONLY.
 *
 * HARVESTED (adapted, not imported) from packages/ckdl/src/analysis.ts `missingEvidence()`. Pure,
 * dependency-light (only the S108 evidence types). It NEVER grants authority, sets no permission,
 * gates nothing — it identifies evidence gaps to improve recommendation/decision explainability,
 * composing with the S108 TrustModel (which scores evidence quality). No import path to
 * authz/cst/command-bus/store.
 */
import type { TrustEvidenceItem, TrustAssessment } from './trustModel';

export type EvidenceGapKind = 'human-input' | 'verification' | 'metric' | 'confidence' | 'insufficient-evidence' | 'rationale';

export interface EvidenceGap {
  kind: EvidenceGapKind;
  detail: string;
}

export interface DecisionQualityInput {
  /** the evidence backing the decision/recommendation (S108 shape). */
  evidence: TrustEvidenceItem[];
  /** whether the owner stated a confidence level (a self-reported number, if any). */
  statedConfidence?: number;
  /** alternatives considered; an alternative without a rationale is a gap. */
  alternatives?: Array<{ label: string; rationale?: string }>;
  /** the number of distinct evidence pieces expected for "complete" (default 3, matching S108 heuristic). */
  expectedEvidence?: number;
}

/**
 * The honest list of evidence gaps. Deterministic, pure. Never fabricates evidence; an absent signal
 * yields a gap (not a silent pass).
 */
export function missingEvidenceGaps(input: DecisionQualityInput): EvidenceGap[] {
  const ev = input.evidence ?? [];
  const gaps: EvidenceGap[] = [];
  if (!ev.some((e) => e.type === 'human-input')) gaps.push({ kind: 'human-input', detail: 'no human input is recorded for this decision' });
  if (!ev.some((e) => e.verified)) gaps.push({ kind: 'verification', detail: 'no evidence has been independently verified' });
  if (!ev.some((e) => e.type === 'metric')) gaps.push({ kind: 'metric', detail: 'no quantitative metric backs this decision' });
  const expected = input.expectedEvidence ?? 3;
  if (ev.length < expected) gaps.push({ kind: 'insufficient-evidence', detail: `only ${ev.length} of ~${expected} expected evidence pieces are present` });
  for (const alt of input.alternatives ?? []) {
    if (!alt.rationale || alt.rationale.trim() === '') gaps.push({ kind: 'rationale', detail: `alternative "${alt.label}" has no rationale` });
  }
  if (input.statedConfidence === undefined) gaps.push({ kind: 'confidence', detail: 'no confidence level has been stated' });
  return gaps;
}

export interface DecisionQuality {
  /** advisory band from the S108 trust assessment (evidence quality). */
  trustBand: TrustAssessment['band'];
  trustScore: number;
  gaps: EvidenceGap[];
  /** true when there are no gaps AND trust is not low — a purely advisory readiness hint. */
  strong: boolean;
  summary: string;
}

/**
 * Combine an S108 trust assessment with the evidence gaps into an advisory decision-quality view.
 * ADVISORY ONLY — `strong` is a hint for a human/UI, never a permission or an execution gate.
 */
export function decisionQuality(assessment: TrustAssessment, input: DecisionQualityInput): DecisionQuality {
  const gaps = missingEvidenceGaps(input);
  const strong = gaps.length === 0 && assessment.band !== 'low';
  return {
    trustBand: assessment.band,
    trustScore: assessment.score,
    gaps,
    strong,
    summary: strong
      ? `Evidence looks complete (trust ${assessment.band}); no gaps found — advisory only.`
      : `Evidence trust ${assessment.band}; ${gaps.length} gap(s): ${gaps.map((g) => g.kind).join(', ') || 'none'} — advisory only, not a permission.`,
  };
}
