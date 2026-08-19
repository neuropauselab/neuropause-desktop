/**
 * L5 · Purpose Engine — SLICE 1 (the OBSERVABLE OBJECT).
 *
 * A PURE evaluator: `evaluatePurpose(candidate, sources)` → a `PurposeEvaluation`, a
 * queryable read-model that climbs a NINE-STATE ladder from an untrusted candidate
 * purpose to a human-confirmable proposal, HALTING at the first rung whose evidence or
 * policy is missing. It PROPOSES; it never decides, grants, confirms, or executes.
 *
 * Doctrine honored (CLAUDE.md §2):
 *  - UNKNOWN stays UNKNOWN (§2.9): no candidate → UNKNOWN; an UNRESOLVED route/authority
 *    HALTS one rung below, never auto-promotes ("uncertainty is never success").
 *  - Deny-by-default (§2.8): unrecognized or unroutable → UNSUPPORTED; authority deny → DENIED.
 *  - One confirmation architecture (§2.7): the ceiling is CONSENT_READY — "the human
 *    confirms next", NEVER "executed". The engine forms a proposal; it sets no `confirmed`.
 *  - AI output is untrusted data (§2.6): the candidate is data; the engine grants it no authority.
 *
 * Zero-runtime-import invariant (pinned): this module imports NOTHING but its own types.
 * Every fact (recognition, route, authority, proposal) arrives through injected `sources`,
 * so there is no import path from the Purpose Engine into L4, governance, or execution.
 */

/** The nine states. Six ascending rungs + three honest off-ramps. */
export type PurposeState =
  // ascending ladder
  | 'UNKNOWN' //         floor — no resolvable purpose
  | 'STATED' //          a candidate purpose is present, not yet matched
  | 'RECOGNIZED' //      matched to the known purpose vocabulary
  | 'ROUTED' //          a governed-certified capability route serves it (from L4)
  | 'PERMITTED' //       authority/policy admits the routed action
  | 'CONSENT_READY' //   ceiling — a human-confirmable proposal is formed (awaits CONSENT; never executed)
  // honest off-ramps
  | 'NEEDS_CLARIFICATION' // underspecified — a human detail is required
  | 'UNSUPPORTED' //        recognized/stated but no governed capability serves it (deny-by-default)
  | 'DENIED'; //            a governed route exists but authority/policy refuses

/** A lite route fact (mirrors L4's route; defined locally to keep zero-runtime-import). */
export interface PurposeRoute {
  readonly capability: string;
  readonly connector: string;
  readonly workflow: string;
}

/**
 * A human-confirmable proposal candidate. Carries NO `confirmed`, no token, no callable —
 * it is data the confirmation architecture consumes, never authority.
 */
export interface PurposeProposal {
  readonly capability: string;
  readonly summary: string;
}

/** One rung of the trace: what evidence or policy justified (or halted) the climb. */
export interface PurposeTraceEntry {
  readonly rung: PurposeState;
  readonly basis: 'evidence' | 'policy';
  readonly detail: string;
}

/** The untrusted candidate purpose (from intelligence). */
export interface PurposeCandidate {
  readonly text: string;
  /** The proposer flagged it as under-specified / multiple readings. */
  readonly ambiguous?: boolean;
}

/** Injected facts — the ONLY way authority enters. Each may report UNKNOWN honestly. */
export interface PurposeSources {
  /** Is this a purpose we recognize (known vocabulary)? */
  readonly recognize: (purpose: string) => boolean;
  /** A governed route (from L4), `null` = none governed, `'unknown'` = unresolved. */
  readonly route: (purpose: string) => PurposeRoute | null | 'unknown';
  /** Authority/policy verdict on the routed action, or `'unknown'` if unresolved. */
  readonly authority: (purpose: string, route: PurposeRoute) => 'permit' | 'deny' | 'unknown';
  /** Form a human-confirmable proposal, or `null` if one cannot be formed yet. */
  readonly propose: (purpose: string, route: PurposeRoute) => PurposeProposal | null;
}

/** The observable object. `proposal` is non-null ONLY at CONSENT_READY. */
export interface PurposeEvaluation {
  readonly state: PurposeState;
  readonly purpose: string | null;
  readonly trace: readonly PurposeTraceEntry[];
  readonly proposal: PurposeProposal | null;
}

export function evaluatePurpose(candidate: PurposeCandidate, sources: PurposeSources): PurposeEvaluation {
  const trace: PurposeTraceEntry[] = [];
  const at = (rung: PurposeState, basis: 'evidence' | 'policy', detail: string): void => {
    trace.push({ rung, basis, detail });
  };
  const halt = (state: PurposeState, purpose: string | null): PurposeEvaluation => ({
    state,
    purpose,
    trace,
    proposal: null,
  });

  const purpose = candidate.text.trim();

  // Floor: no candidate → UNKNOWN, and nothing promotes it.
  if (purpose === '') {
    at('UNKNOWN', 'evidence', 'no candidate purpose');
    return halt('UNKNOWN', null);
  }

  // Under-specified → NEEDS_CLARIFICATION (a human detail is required before any climb).
  if (candidate.ambiguous === true) {
    at('NEEDS_CLARIFICATION', 'evidence', 'candidate flagged ambiguous');
    return halt('NEEDS_CLARIFICATION', purpose);
  }

  at('STATED', 'evidence', `candidate purpose "${purpose}"`);

  // Deny-by-default: not in the known vocabulary → UNSUPPORTED.
  if (!sources.recognize(purpose)) {
    at('UNSUPPORTED', 'policy', 'purpose not in known vocabulary');
    return halt('UNSUPPORTED', purpose);
  }
  at('RECOGNIZED', 'evidence', 'matched known purpose vocabulary');

  const route = sources.route(purpose);
  // Uncertainty never promotes: an unresolved route HALTS at RECOGNIZED.
  if (route === 'unknown') {
    at('RECOGNIZED', 'evidence', 'route unresolved — halting (uncertainty is never success)');
    return halt('RECOGNIZED', purpose);
  }
  // Deny-by-default: no governed route serves it → UNSUPPORTED.
  if (route === null) {
    at('UNSUPPORTED', 'policy', 'no governed capability serves this purpose');
    return halt('UNSUPPORTED', purpose);
  }
  at('ROUTED', 'evidence', `governed route ${route.capability} → ${route.workflow}`);

  const verdict = sources.authority(purpose, route);
  if (verdict === 'deny') {
    at('DENIED', 'policy', 'authority/policy refused the routed action');
    return halt('DENIED', purpose);
  }
  // Uncertainty never promotes: an unresolved authority HALTS at ROUTED.
  if (verdict === 'unknown') {
    at('ROUTED', 'policy', 'authority unresolved — halting (never auto-permit)');
    return halt('ROUTED', purpose);
  }
  at('PERMITTED', 'policy', 'authority/policy admitted the routed action');

  const proposal = sources.propose(purpose, route);
  // No proposal formed yet → HALT at PERMITTED (never fabricate a proposal).
  if (proposal === null) {
    at('PERMITTED', 'evidence', 'no confirmable proposal formed yet');
    return halt('PERMITTED', purpose);
  }

  // Ceiling: a human-confirmable proposal exists. The human confirms next — NOT executed here.
  at('CONSENT_READY', 'evidence', `proposal ready for human confirmation: ${proposal.summary}`);
  return { state: 'CONSENT_READY', purpose, trace, proposal };
}
