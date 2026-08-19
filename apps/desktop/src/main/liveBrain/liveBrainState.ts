/**
 * L6 · Live Brain — SLICE 1 · the STATE MODEL (the OBSERVABLE OBJECT).
 *
 * `composeLiveBrainState(inputs)` → a `LiveBrainState`: ONE truthful operational state
 * object composed as a PURE JOIN over the real L1–L5 read-models + the S34a ActionRecord.
 * It never invents state. Uncertainty is first-class — every section carries one of five
 * values: KNOWN / UNKNOWN / UNAVAILABLE / CONFLICTING / VERIFIED — and UNKNOWN never
 * becomes "probably okay."
 *
 * Non-negotiable (CLAUDE.md §2 #13 — "The Brain proposes; it never reaches."): this module
 * OBSERVES only. It holds ZERO execution or grant authority — pinned by a zero-runtime-import
 * invariant (it imports only TYPES; every fact arrives through injected read-model outputs).
 *
 * It reads no store. DESIGN CONTRACT (not an existing call-site): `actionRecord.query` is
 * async + disk-backed, so wherever L6 is wired the caller MUST perform the query and pass the
 * already-scoped `ActionRecord[]` in. NO production caller exists yet — S1 is exercised by
 * tests only; the wiring is an explicit open gate (NP_STATE "Next: production call-site"),
 * not a claimed reality (§4: a predicted declaration is fiction). See the L6-S1 grounding
 * artifact + the fleet-audit synthesis for the tenant-safety preconditions the wiring must meet.
 *
 * Deterministic-first (DECISIONS D-14): S1 is a deterministic derivation over the real
 * read-models. "Live Brain" does NOT mean "live LLM"; no model feeds this slice.
 *
 * Purpose-bound vs ambient: L1/L4/S34a are ambient (current tenant state); L2/L3/L5 are
 * purpose-bound — present only when a purpose is in scope, else honestly UNAVAILABLE.
 */
import type { WorkspaceDomainSnapshot } from '../enterprise/workspaceFoundation/domainAggregate';
import type { CapabilityGraphSnapshot } from '../capabilityGraph/capabilityGraph';
import type { EnvironmentModel } from '../environmentModel/environmentModel';
import type { PurposeEvaluation } from '../purposeEngine/purposeEngine';
import type { DiscoveryRun } from '../environmentDiscovery/environmentDiscovery';
import type { ActionRecord } from '../connectors/actionRecord';

/** The five-valued uncertainty. First-class; UNKNOWN never silently becomes KNOWN/"okay". */
export type Certainty = 'KNOWN' | 'UNKNOWN' | 'UNAVAILABLE' | 'CONFLICTING' | 'VERIFIED';

/** One section of the operational state. `source` names the originating layer(s) — S2 deepens this to per-field evidence provenance. */
export interface StateSection {
  readonly certainty: Certainty;
  /** Human-readable, derived from evidence — never fabricated. */
  readonly summary: string;
  readonly source: readonly string[];
  /** Structured facts carried verbatim from the read-model (optional). */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** A detected cross-substrate disagreement — surfaced with BOTH claims, never auto-reconciled. */
export interface Conflict {
  readonly about: string;
  readonly claims: readonly { readonly source: string; readonly says: string }[];
}

/** The injected read-model outputs — the ONLY inputs. Any may be null/absent (→ UNAVAILABLE). */
export interface LiveBrainInputs {
  readonly workspace: WorkspaceDomainSnapshot | null; // L1 (ambient)
  readonly capabilities: CapabilityGraphSnapshot | null; // L4 (ambient)
  readonly environment: EnvironmentModel | null; // L2 (purpose-bound)
  readonly purpose: PurposeEvaluation | null; // L5 (purpose-bound)
  readonly discovery: DiscoveryRun | null; // L3 (purpose-bound)
  readonly actions: readonly ActionRecord[]; // S34a (already queried; [] = none)
}

export interface LiveBrainState {
  readonly scopeResolved: boolean;
  readonly tenantId: string | null;
  readonly sections: {
    readonly workspace: StateSection;
    readonly capabilities: StateSection;
    readonly environment: StateSection;
    readonly purpose: StateSection;
    readonly discovery: StateSection;
    readonly evidence: StateSection;
    /** Governed-PATH existence from L4 (a route exists) — NOT principal permission (that is AUTHORITY, a different power). */
    readonly governedPaths: StateSection;
    readonly health: StateSection;
    readonly risk: StateSection;
    readonly incidents: StateSection;
    readonly pendingWork: StateSection;
  };
  /** Explicit, surfaced, never auto-reconciled. */
  readonly conflicts: readonly Conflict[];
  /** Rollup counts across all sections — a truthful census of what is / isn't known. */
  readonly uncertainty: Readonly<Record<Certainty, number>>;
}

/**
 * Canonical verification-terminal classification. The REAL vocabulary that can reach
 * `ActionRecord.verification.terminal` (typed `string`, fed by `s16VerifyRun` = verifyEffect's
 * `VerifyState`, and by the import path):
 *   success    → VERIFIED_SUCCESS
 *   failure    → VERIFY_FAILED (send oracle) | VERIFIED_FAILURE (import)
 *   unresolved → HOLD | UNKNOWN | VERIFY_PENDING | EXECUTED_ACK | any UNRECOGNISED terminal
 * Deny-by-default: an unrecognised terminal is UNRESOLVED, NEVER "settled" (§2#9 — uncertainty
 * is never success). `null` verification = not yet verified (also unresolved for rollup purposes).
 */
const SUCCESS_TERMINALS = new Set(['VERIFIED_SUCCESS']);
const FAILURE_TERMINALS = new Set(['VERIFY_FAILED', 'VERIFIED_FAILURE']);
type VerifyClass = 'unverified' | 'success' | 'failure' | 'unresolved';
function classifyVerification(v: ActionRecord['verification']): VerifyClass {
  if (v === null) return 'unverified';
  if (SUCCESS_TERMINALS.has(v.terminal)) return 'success';
  if (FAILURE_TERMINALS.has(v.terminal)) return 'failure';
  return 'unresolved'; // HOLD / UNKNOWN / VERIFY_PENDING / unrecognised — never settled
}

/** Health precedence: any conflict dominates; then blindness; then uncertainty; VERIFIED only when fully corroborated. */
function rollupCertainty(sections: readonly StateSection[]): Certainty {
  const has = (c: Certainty): boolean => sections.some((s) => s.certainty === c);
  if (has('CONFLICTING')) return 'CONFLICTING';
  if (has('UNAVAILABLE')) return 'UNAVAILABLE';
  if (has('UNKNOWN')) return 'UNKNOWN';
  // No uncertainty anywhere: VERIFIED only if at least one section is VERIFIED and none merely KNOWN-without-proof.
  if (has('VERIFIED') && !has('KNOWN')) return 'VERIFIED';
  return 'KNOWN';
}

export function composeLiveBrainState(inputs: LiveBrainInputs): LiveBrainState {
  const conflicts: Conflict[] = [];
  const conflicted = new Set<string>(); // section keys flagged CONFLICTING

  const wsScope = inputs.workspace?.scopeResolved ?? null;
  const capScope = inputs.capabilities?.scopeResolved ?? null;

  // ── Conflict check 1: L1 and L4 disagree about whether a tenant is in scope. ──────────
  const scopeConflict = wsScope !== null && capScope !== null && wsScope !== capScope;
  if (scopeConflict) {
    conflicts.push({
      about: 'tenant scope resolution',
      claims: [
        { source: 'L1 workspace', says: `scopeResolved=${wsScope}` },
        { source: 'L4 capabilities', says: `scopeResolved=${capScope}` },
      ],
    });
    conflicted.add('workspace');
    conflicted.add('capabilities');
  }

  // A disputed scope is NOT resolved — the boolean a consumer branches on must not read "settled".
  const scopeResolved = !scopeConflict && (wsScope === true || capScope === true);
  const tenantId = inputs.workspace?.tenantId ?? null;

  // Fail-closed: only trust routes when the graph's own scope resolves (defense-in-depth,
  // mirrors each rendered section's scopeResolved re-check).
  const routedCaps = new Set(
    (inputs.capabilities?.scopeResolved ? inputs.capabilities.routes : []).map((r) => r.capability),
  );

  // ── Conflict check 2: L4 routes a capability the ActionRecord shows verified-FAILED. ──
  // Uses the canonical classifier so the REAL failure terminal (VERIFY_FAILED) fires, not a literal.
  for (const rec of inputs.actions) {
    if (routedCaps.has(rec.actionId) && classifyVerification(rec.verification) === 'failure') {
      conflicts.push({
        about: `capability "${rec.actionId}" usability`,
        claims: [
          { source: 'L4 capabilities', says: 'routed (a governed path exists)' },
          { source: 'S34a evidence', says: `last governed use verified ${rec.verification?.terminal ?? '?'}` },
        ],
      });
      conflicted.add('capabilities');
      conflicted.add('evidence');
    }
  }

  // ── Conflict check 3: L2 marks a capability NEED (absent) that L4 marks routed (present). ──
  for (const id of inputs.environment?.need ?? []) {
    if (routedCaps.has(id)) {
      conflicts.push({
        about: `capability "${id}" presence`,
        claims: [
          { source: 'L2 environment', says: 'NEED (evidenced absent)' },
          { source: 'L4 capabilities', says: 'routed (present + governed)' },
        ],
      });
      conflicted.add('environment');
      conflicted.add('capabilities');
    }
  }

  const conflict = (key: string): boolean => conflicted.has(key);

  // ── Ambient: L1 workspace ────────────────────────────────────────────────────────────
  const workspace: StateSection = conflict('workspace')
    ? sec('CONFLICTING', 'tenant scope disputed across substrates', ['L1'])
    : inputs.workspace === null
      ? sec('UNAVAILABLE', 'L1 workspace rollup absent', ['L1'])
      : !inputs.workspace.scopeResolved
        ? sec('UNAVAILABLE', 'no tenant scope resolved — workspace UNKNOWN', ['L1'])
        : sec(
            'KNOWN',
            `${inputs.workspace.slices.length} domains: ` +
              `${inputs.workspace.slices.filter((s) => s.state === 'present').length} present, ` +
              `${inputs.workspace.slices.filter((s) => s.state === 'unavailable').length} unavailable`,
            ['L1'],
            { slices: inputs.workspace.slices },
          );

  // ── Ambient: L4 capabilities ──────────────────────────────────────────────────────────
  const capabilities: StateSection = conflict('capabilities')
    ? sec('CONFLICTING', 'capability state disputed across substrates — see conflicts', ['L4'])
    : inputs.capabilities === null
      ? sec('UNAVAILABLE', 'L4 capability graph absent', ['L4'])
      : !inputs.capabilities.scopeResolved
        ? sec('UNAVAILABLE', 'no tenant scope resolved — capability graph empty', ['L4'])
        : sec(
            'KNOWN',
            `${inputs.capabilities.routes.length} routable, ${inputs.capabilities.gaps.length} gaps`,
            ['L4'],
            { routes: inputs.capabilities.routes, gaps: inputs.capabilities.gaps },
          );

  // ── Purpose-bound: L2 environment ─────────────────────────────────────────────────────
  const environment: StateSection = conflict('environment')
    ? sec('CONFLICTING', 'environment vs capability disagreement — see conflicts', ['L2'])
    : inputs.environment === null
      ? sec('UNAVAILABLE', 'no active purpose — environment model not evaluated', ['L2'])
      : envSection(inputs.environment);

  // ── Purpose-bound: L5 purpose ─────────────────────────────────────────────────────────
  const purpose: StateSection =
    inputs.purpose === null
      ? sec('UNAVAILABLE', 'no active purpose in scope', ['L5'])
      : purposeSection(inputs.purpose);

  // ── Purpose-bound: L3 discovery (per-result state — an all-UNKNOWN run is UNKNOWN, never KNOWN) ──
  const discovery: StateSection =
    inputs.discovery === null ? sec('UNAVAILABLE', 'no discovery run in scope', ['L3']) : discoverySection(inputs.discovery);

  // ── S34a evidence (classified against the REAL terminal vocabulary) ───────────────────
  const successCount = inputs.actions.filter((a) => classifyVerification(a.verification) === 'success').length;
  const failureCount = inputs.actions.filter((a) => classifyVerification(a.verification) === 'failure').length;
  const unresolvedCount = inputs.actions.filter((a) => {
    const c = classifyVerification(a.verification);
    return c === 'unverified' || c === 'unresolved';
  }).length;
  const evidenceDetail = {
    actions: inputs.actions.length,
    verifiedSuccess: successCount,
    verifiedFailure: failureCount,
    unresolved: unresolvedCount,
  };
  const evidence: StateSection = conflict('evidence')
    ? sec('CONFLICTING', 'evidence contradicts a routed capability — see conflicts', ['S34a'], evidenceDetail)
    : inputs.actions.length === 0
      ? sec('UNAVAILABLE', 'no governed actions recorded yet', ['S34a'])
      : unresolvedCount > 0
        ? // any unresolved/unverified action → the section is UNKNOWN, never "okay"
          sec('UNKNOWN', `${inputs.actions.length} recorded, ${unresolvedCount} unresolved / awaiting verification`, ['S34a'], evidenceDetail)
        : failureCount > 0
          ? // all resolved, ≥1 verified FAILURE → KNOWN (surfaced as an incident), never VERIFIED
            sec('KNOWN', `${inputs.actions.length} recorded, ${failureCount} verified failure(s), ${successCount} verified`, ['S34a'], evidenceDetail)
          : successCount > 0
            ? sec('VERIFIED', `${inputs.actions.length} recorded, ${successCount} independently verified`, ['S34a'], evidenceDetail)
            : sec('KNOWN', `${inputs.actions.length} recorded`, ['S34a'], evidenceDetail);

  // ── Derived: governed PATHS (a route exists in L4). NOT principal permission (AUTHORITY). ──
  const governedPaths: StateSection =
    inputs.capabilities === null || !inputs.capabilities.scopeResolved
      ? sec('UNAVAILABLE', 'no tenant scope — governed paths undetermined', ['L4'])
      : sec(
          'KNOWN',
          `${routedCaps.size} capabilities have a governed PATH (an L4 route exists — not a per-principal permit)`,
          ['L4 (derived)'],
        );

  // ── Not-yet-modeled: risk (no real source → UNAVAILABLE, never a fabricated score) ────
  const risk: StateSection = sec('UNAVAILABLE', 'no risk model in the substrate yet — not scored (deny-by-default)', ['—']);

  // ── Derived: incidents (conflicts + verified failures; traces to real evidence) ───────
  const incidentCount = conflicts.length + failureCount;
  const incidents: StateSection =
    incidentCount === 0
      ? sec('KNOWN', 'no incidents (no conflicts, no verified failures)', ['derived'])
      : sec('CONFLICTING', `${conflicts.length} conflict(s), ${failureCount} verified failure(s)`, ['derived'], {
          conflicts: conflicts.length,
          verifiedFailures: failureCount,
        });

  // ── Derived: pending work (unresolved verifications + non-consent-ready purpose) ──────
  const purposeIncomplete = inputs.purpose !== null && inputs.purpose.state !== 'CONSENT_READY' ? 1 : 0;
  const pendingCount = unresolvedCount + purposeIncomplete;
  const pendingWork: StateSection =
    pendingCount === 0
      ? sec('KNOWN', 'no pending work', ['derived'])
      : sec(
          'UNKNOWN',
          `${unresolvedCount} action(s) awaiting verification` + (purposeIncomplete ? ', 1 purpose not yet consent-ready' : ''),
          ['derived'],
          { unresolvedVerification: unresolvedCount, purposeIncomplete },
        );

  // ── Derived: health (rollup; UNKNOWN never renders as "okay") ─────────────────────────
  // Ambient substrates + the derived incident/pending signals ALWAYS count (a verified failure
  // or an unresolved verification must pull health down); purpose-bound sections count ONLY when
  // a purpose is in scope — an absent purpose is "not applicable", never a health problem.
  const healthSections: StateSection[] = [workspace, capabilities, evidence, governedPaths, incidents, pendingWork];
  if (inputs.environment !== null) healthSections.push(environment);
  if (inputs.purpose !== null) healthSections.push(purpose);
  if (inputs.discovery !== null) healthSections.push(discovery);
  const healthCertainty = rollupCertainty(healthSections);
  const health: StateSection = sec(healthCertainty, healthSummary(healthCertainty), ['derived']);

  const sections = {
    workspace,
    capabilities,
    environment,
    purpose,
    discovery,
    evidence,
    governedPaths,
    health,
    risk,
    incidents,
    pendingWork,
  };

  // ── Uncertainty census across all sections ────────────────────────────────────────────
  const uncertainty: Record<Certainty, number> = {
    KNOWN: 0,
    UNKNOWN: 0,
    UNAVAILABLE: 0,
    CONFLICTING: 0,
    VERIFIED: 0,
  };
  for (const s of Object.values(sections)) uncertainty[s.certainty] += 1;

  return { scopeResolved, tenantId, sections, conflicts, uncertainty };
}

function sec(
  certainty: Certainty,
  summary: string,
  source: readonly string[],
  detail?: Readonly<Record<string, unknown>>,
): StateSection {
  return detail === undefined ? { certainty, summary, source } : { certainty, summary, source, detail };
}

/** L2 → section: any UNKNOWN element → UNKNOWN; any UNAVAILABLE (none unknown) → UNAVAILABLE; else KNOWN (HAVE/NEED are known facts). */
function envSection(model: EnvironmentModel): StateSection {
  if (model.unknown.length > 0) {
    return sec('UNKNOWN', `${model.unknown.length} element(s) undetermined for "${model.purpose}"`, ['L2'], {
      have: model.have,
      need: model.need,
      unknown: model.unknown,
      unavailable: model.unavailable,
    });
  }
  if (model.unavailable.length > 0) {
    return sec('UNAVAILABLE', `evidence unavailable for ${model.unavailable.length} element(s)`, ['L2'], {
      have: model.have,
      need: model.need,
      unavailable: model.unavailable,
    });
  }
  return sec('KNOWN', `${model.have.length} HAVE, ${model.need.length} NEED for "${model.purpose}"`, ['L2'], {
    have: model.have,
    need: model.need,
  });
}

/** L3 → section: mirrors envSection — any UNKNOWN result → UNKNOWN; any UNAVAILABLE → UNAVAILABLE; else KNOWN. */
function discoverySection(run: DiscoveryRun): StateSection {
  const unknown = run.results.filter((r) => r.state === 'UNKNOWN').length;
  const unavailable = run.results.filter((r) => r.state === 'UNAVAILABLE').length;
  const n = run.results.length;
  if (unknown > 0) return sec('UNKNOWN', `${unknown} of ${n} discovery result(s) undetermined`, ['L3'], { results: run.results });
  if (unavailable > 0) return sec('UNAVAILABLE', `${unavailable} of ${n} discovery result(s) unavailable`, ['L3'], { results: run.results });
  return sec('KNOWN', `${n} discovery result(s) resolved`, ['L3'], { results: run.results });
}

/** L5 → section: an unresolved/UNKNOWN purpose stays UNKNOWN; a resolved rung is KNOWN. */
function purposeSection(evaluation: PurposeEvaluation): StateSection {
  if (evaluation.state === 'UNKNOWN' || evaluation.state === 'NEEDS_CLARIFICATION') {
    return sec('UNKNOWN', `purpose "${evaluation.purpose ?? ''}" at ${evaluation.state}`, ['L5']);
  }
  return sec('KNOWN', `purpose "${evaluation.purpose ?? ''}" at ${evaluation.state}`, ['L5'], {
    state: evaluation.state,
    hasProposal: evaluation.proposal !== null,
  });
}

function healthSummary(c: Certainty): string {
  switch (c) {
    case 'CONFLICTING':
      return 'attention — a conflict or verified failure is present (surfaced, not reconciled)';
    case 'UNAVAILABLE':
      return 'partially blind — one or more substrates cannot be read';
    case 'UNKNOWN':
      return 'incomplete — some state is undetermined or unverified (NOT assumed okay)';
    case 'VERIFIED':
      return 'corroborated — observed state is independently verified, no incidents or pending work';
    default:
      return 'observed — all sections resolved, no incidents or pending work';
  }
}
