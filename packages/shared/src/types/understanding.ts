/**
 * Understanding — what NeuroPause currently believes about the user, with the
 * one property that keeps it honest: **every attribute carries its
 * provenance.** "Business owner" answered by the user and "manufacturing"
 * inferred from a sentence they typed are different kinds of knowledge, and
 * the product must never silently promote the second into the first.
 *
 * The profile is a MODEL OF THE USER'S WORDS, not objective truth. It is
 * editable; a correction supersedes an inference and is recorded as such.
 *
 * Also here: the HOLD vocabulary — the first-class "we understand, but we are
 * not ready to execute safely" state — and the Decision Record shapes that
 * make consequential actions reconstructable later. Pure types + pure helpers.
 */

/* ── understanding attributes ──────────────────────────────────────────────── */

/** Where a belief came from. Ordered roughly by strength of grounding. */
export type AttributeStatus =
  | 'stated' // the user answered this directly
  | 'inferred' // NeuroPause derived it from something the user said
  | 'corrected' // the user overrode an earlier value
  | 'imported' // arrived with imported data
  | 'connected' // arrived from a connected system
  | 'system_derived'; // computed from real records

export const ATTRIBUTE_STATUS_LABELS: Record<AttributeStatus, string> = {
  stated: 'You told us',
  inferred: 'Inferred — please confirm',
  corrected: 'Corrected by you',
  imported: 'From imported data',
  connected: 'From a connected system',
  system_derived: 'Derived from your records',
};

export interface UnderstandingAttribute {
  /** Stable key, e.g. 'role', 'domain', 'priority.growth'. */
  key: string;
  /** Human label, e.g. 'You', 'You work on'. */
  label: string;
  value: string;
  status: AttributeStatus;
  /** The evidence sentence: what this belief is based on, in plain words. */
  source: string;
  updatedAt: string;
}

/** An inference is never silently a fact — the UI renders these distinctly. */
export function isVerifiedAttribute(a: UnderstandingAttribute): boolean {
  return a.status === 'stated' || a.status === 'corrected';
}

/* ── deterministic discovery inference ─────────────────────────────────────── */

/**
 * Infer candidate attributes from a free-form "what do you work on" sentence.
 *
 * DETERMINISTIC keyword mapping — not a model. That is deliberate: at
 * first-run no AI route may be configured yet, the stakes are low, and a
 * wrong inference is cheap because everything it produces is marked
 * `inferred` and shown for confirmation. Unmatched text infers nothing.
 */
const DOMAIN_HINTS: readonly { pattern: RegExp; value: string }[] = [
  { pattern: /manufactur|factory|production|assembl/i, value: 'Manufacturing' },
  { pattern: /medical|healthcare|clinic|pharma|device/i, value: 'Medical / Healthcare' },
  { pattern: /software|saas|app|developer|coding|tech startup/i, value: 'Software' },
  { pattern: /retail|shop|store|e-?commerce/i, value: 'Retail / Commerce' },
  { pattern: /consult|agency|advisory/i, value: 'Consulting / Services' },
  { pattern: /finance|accounting|invest|bank/i, value: 'Finance' },
  { pattern: /construction|real estate|property/i, value: 'Construction / Real Estate' },
  { pattern: /logistics|shipping|transport|warehouse/i, value: 'Logistics' },
  { pattern: /education|teaching|school|university|research/i, value: 'Education / Research' },
];

const MODEL_HINTS: readonly { pattern: RegExp; value: string }[] = [
  { pattern: /\bb2b\b|other businesses|wholesal|distributor|component/i, value: 'B2B' },
  { pattern: /\bb2c\b|consumers|direct to (customer|consumer)|d2c/i, value: 'B2C' },
];

export interface InferredUnderstanding {
  attributes: { key: string; label: string; value: string; source: string }[];
}

export function inferFromWorkDescription(text: string): InferredUnderstanding {
  const trimmed = text.trim();
  const attributes: InferredUnderstanding['attributes'] = [];
  if (!trimmed) return { attributes };

  for (const hint of DOMAIN_HINTS) {
    if (hint.pattern.test(trimmed)) {
      attributes.push({
        key: 'domain',
        label: 'You work on',
        value: hint.value,
        source: `Inferred from your description: “${clip(trimmed)}”`,
      });
      break; // one domain inference; a person can correct it, not fight a list
    }
  }
  for (const hint of MODEL_HINTS) {
    if (hint.pattern.test(trimmed)) {
      attributes.push({
        key: 'businessModel',
        label: 'Business model',
        value: hint.value,
        source: `Inferred from your description: “${clip(trimmed)}”`,
      });
      break;
    }
  }
  return { attributes };
}

function clip(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/* ── HOLD ──────────────────────────────────────────────────────────────────── */

/** The structured reasons NeuroPause holds instead of executing. */
export type HoldReason =
  | 'insufficient_evidence'
  | 'insufficient_permission'
  | 'policy_conflict'
  | 'high_risk'
  | 'unresolved_dependency'
  | 'ambiguous_request'
  | 'ambiguous_identity'
  | 'external_unavailable'
  | 'approval_required'
  | 'verification_unavailable';

export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  insufficient_evidence: 'Not enough evidence',
  insufficient_permission: 'Missing permission',
  policy_conflict: 'Policy conflict',
  high_risk: 'High risk',
  unresolved_dependency: 'Unresolved dependency',
  ambiguous_request: 'Ambiguous request',
  ambiguous_identity: 'Ambiguous identity',
  external_unavailable: 'A required system is unavailable',
  approval_required: 'Approval required',
  verification_unavailable: 'Cannot verify the outcome',
};

/** The full Hold card: everything a person needs to resolve it. */
export interface HoldView {
  reason: HoldReason;
  /** One sentence: why NeuroPause is holding. */
  why: string;
  /** What NeuroPause DOES know (real evidence lines). */
  known: readonly string[];
  /** What is missing. */
  unknown: readonly string[];
  /** The specific action that would resolve the hold. */
  resolution: string;
  /** What could happen if the user forces ahead (empty = forcing not offered). */
  ifProceeding: string;
}

/** How a hold ended. Mirrors the decision outcomes so the pair reconciles. */
export type HoldOutcome = 'proceeded' | 'took_alternative' | 'cancelled';

export const HOLD_OUTCOME_LABELS: Record<HoldOutcome, string> = {
  proceeded: 'Proceeded anyway',
  took_alternative: 'Took the safer alternative',
  cancelled: 'Cancelled',
};

/**
 * A hold that OUTLIVES the dialog that raised it.
 *
 * HOLD is a third terminal state next to SUCCESS and FAILURE, and a state you
 * can only act on later is a state that has to be persisted: the person who
 * hits the hold is often not the person who can clear it. Every open hold is
 * therefore a durable item with the action that would resolve it, paired with
 * the Decision Record that explains how it arose.
 */
export interface HoldRecord extends HoldView {
  /**
   * P12 — the tenant this record belongs to.
   *
   * Optional in the TYPE so a file written before P12 still parses. Absent means
   * UNRESOLVED: visible to no tenant, counted, never auto-assigned.
   */
  tenantId?: string | null;
  /** The workspace inside that tenant. Absent means tenant-level. */
  workspaceId?: string | null;
  id: string;
  at: string;
  actor: string | null;
  /** Plain-words title, e.g. 'Delete customer "Acme Ltd"'. */
  title: string;
  /** The subject, e.g. 'crm-customers/rec_abc (Acme Ltd)'. */
  subject: string;
  /** The Decision Record written when this hold was raised. */
  decisionId: string | null;
  status: 'open' | 'resolved';
  resolvedAt: string | null;
  resolvedOutcome: HoldOutcome | null;
  /** What actually happened when it was resolved, in plain words. */
  resolvedNote: string | null;
}

/** Run states. HOLD is not a failure — it is a governed, resolvable pause. */
export type RunState = 'success' | 'failure' | 'hold';

export const RUN_STATE_LABELS: Record<RunState, string> = {
  success: 'Done',
  failure: 'Failed',
  hold: 'On hold',
};

/* ── decision records ──────────────────────────────────────────────────────── */

export type DecisionRisk = 'supported' | 'questionable' | 'high_risk' | 'insufficient_evidence';

export const DECISION_RISK_LABELS: Record<DecisionRisk, string> = {
  supported: 'Supported',
  questionable: 'Questionable',
  high_risk: 'High risk',
  insufficient_evidence: 'Insufficient evidence',
};

export const DECISION_RISK_RECOMMENDATIONS: Record<DecisionRisk, string> = {
  supported: 'Proceed',
  questionable: 'Review before proceeding',
  high_risk: 'Do not proceed',
  insufficient_evidence: 'Hold until more is known',
};

/** One evidence line inside an assessment — always a real, counted fact. */
export interface DecisionEvidence {
  label: string;
  detail: string;
  count: number | null;
}

/**
 * A deterministic assessment of a requested action, produced BEFORE anything
 * is written. `risk` comes from rules over real records, never from a model.
 */
export interface ActionAssessment {
  risk: DecisionRisk;
  recommendation: string;
  evidence: readonly DecisionEvidence[];
  /** The safer alternative, when one exists (e.g. archive instead of delete). */
  alternative: string | null;
}

/**
 * The persistent record of a consequential decision — who wanted what, what
 * the evidence said, what NeuroPause recommended, what actually happened.
 */
export interface DecisionRecord {
  /**
   * P12 — the tenant this record belongs to.
   *
   * Optional in the TYPE so a file written before P12 still parses. Absent means
   * UNRESOLVED: visible to no tenant, counted, never auto-assigned.
   */
  tenantId?: string | null;
  /** The workspace inside that tenant. Absent means tenant-level. */
  workspaceId?: string | null;
  id: string;
  at: string;
  actor: string | null;
  /** What the user asked for, in plain words. */
  requestedAction: string;
  /** The subject, e.g. 'crm-customers/rec_abc (Acme Ltd)'. */
  subject: string;
  assessment: ActionAssessment;
  /** What the user chose: 'proceeded' | 'took_alternative' | 'cancelled'. */
  outcome: 'proceeded' | 'took_alternative' | 'cancelled';
  /** What was actually executed, in plain words. */
  executed: string;
  /** The hold this decision raised or resolved, when there was one. */
  holdId?: string | null;
}

/**
 * What the Holds surface reads.
 *
 * `assessmentLive` is deliberately part of the payload. Dependency assessment
 * depends on a runtime binding to the relationship store, and an unbound reader
 * finds no links — indistinguishable, on screen, from "nothing depends on this".
 * The surface must be able to say which of the two it is rather than present an
 * empty list as an all-clear.
 */
export interface HoldCenterView {
  open: HoldRecord[];
  resolved: HoldRecord[];
  assessmentLive: boolean;
  /** Declared relationships the assessor can see. 0 = it can never find links. */
  relationshipsDeclared: number;
}

/** One Decision Record with the full history of its subject. */
export interface DecisionRecordDetail {
  record: DecisionRecord;
  /** Every decision on the same subject, oldest first. */
  subjectHistory: DecisionRecord[];
  /** The hold this decision raised, if it is still on file. */
  hold: HoldRecord | null;
}

/* ── assessment → hold ─────────────────────────────────────────────────────── */

/**
 * Turn a refused assessment into the Hold a person can actually act on.
 *
 * Pure and deterministic: `known` is the assessment's own counted evidence
 * (real records, never prose), `unknown` names the judgement NeuroPause cannot
 * make for you, and `ifProceeding` states the consequence plainly instead of
 * hiding it behind a confirm button. Kept in shared so main and renderer
 * render the SAME hold text and a test can assert it once.
 */
export function holdFromAssessment(assessment: ActionAssessment, subjectLabel: string): HoldView {
  const known = assessment.evidence.map((e) => e.detail);
  const linked = assessment.evidence.reduce((sum, e) => sum + (e.count ?? 0), 0);
  return {
    reason: assessment.risk === 'insufficient_evidence' ? 'insufficient_evidence' : 'high_risk',
    why:
      assessment.risk === 'insufficient_evidence'
        ? `NeuroPause does not have enough evidence to judge this safely, so it has not run.`
        : `${sentenceCase(subjectLabel)} has ${linked} live dependenc${linked === 1 ? 'y' : 'ies'}. Removing it would leave ${linked === 1 ? 'that record' : 'those records'} pointing at nothing, and that cannot be undone by re-creating the record.`,
    known,
    unknown: [
      'Whether those dependencies are still needed by your business.',
      'Whether a person elsewhere is relying on them right now.',
    ],
    resolution:
      assessment.alternative ??
      'Remove or repoint the dependent records first, then this action becomes safe.',
    ifProceeding:
      assessment.risk === 'high_risk'
        ? `The ${linked} dependent record${linked === 1 ? '' : 's'} keep their reference but it stops resolving. Nothing is destroyed — the record is soft-deleted and recoverable — but reports and traces that walk this link will show a gap until it is restored.`
        : '',
  };
}

/** Capitalise a subject label without touching an already-capitalised name. */
function sentenceCase(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/* ── understanding, grouped for display ────────────────────────────────────── */

export type UnderstandingGroupId = 'confirmed' | 'needs_confirmation' | 'derived';

export const UNDERSTANDING_GROUP_LABELS: Record<UnderstandingGroupId, string> = {
  confirmed: 'Confirmed by you',
  needs_confirmation: 'Inferred — not yet confirmed',
  derived: 'From your data and connections',
};

export const UNDERSTANDING_GROUP_BLURBS: Record<UnderstandingGroupId, string> = {
  confirmed: 'You stated or corrected these. NeuroPause treats them as your words.',
  needs_confirmation:
    'NeuroPause derived these from something you said. They are guesses until you confirm them, and are never used as fact.',
  derived:
    'Computed from real records, imported files and connected systems. Read-only here — change the source and this changes with it.',
};

export function understandingGroupOf(status: AttributeStatus): UnderstandingGroupId {
  if (status === 'stated' || status === 'corrected') return 'confirmed';
  if (status === 'inferred') return 'needs_confirmation';
  return 'derived';
}

export interface UnderstandingGroup {
  id: UnderstandingGroupId;
  label: string;
  blurb: string;
  attributes: UnderstandingAttribute[];
}

/**
 * Group attributes for display, in a fixed order, dropping empty groups.
 * The ordering is the point: what you confirmed comes first, what NeuroPause
 * guessed is called out second, and machine-derived facts sit last where they
 * cannot be mistaken for something you said.
 */
export function groupUnderstanding(
  attributes: readonly UnderstandingAttribute[],
): UnderstandingGroup[] {
  const order: UnderstandingGroupId[] = ['confirmed', 'needs_confirmation', 'derived'];
  return order
    .map((id) => ({
      id,
      label: UNDERSTANDING_GROUP_LABELS[id],
      blurb: UNDERSTANDING_GROUP_BLURBS[id],
      attributes: attributes.filter((a) => understandingGroupOf(a.status) === id),
    }))
    .filter((g) => g.attributes.length > 0);
}

/** How complete the picture is — a count of real answers, never a score. */
export interface UnderstandingCoverage {
  total: number;
  confirmed: number;
  awaitingConfirmation: number;
}

export function understandingCoverage(
  attributes: readonly UnderstandingAttribute[],
): UnderstandingCoverage {
  return {
    total: attributes.length,
    confirmed: attributes.filter((a) => isVerifiedAttribute(a)).length,
    awaitingConfirmation: attributes.filter((a) => a.status === 'inferred').length,
  };
}
