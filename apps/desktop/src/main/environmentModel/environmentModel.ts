/**
 * L2 · Environment Model / Graph — SLICE 1 (the OBSERVABLE OBJECT).
 *
 * A PURE, PURPOSE-BOUND model: `composeEnvironmentModel(purpose, required, sources)` →
 * an `EnvironmentModel` that classifies each element a PURPOSE requires into exactly FOUR
 * states — HAVE / NEED / UNKNOWN / UNAVAILABLE — from injected evidence. It MODELS what
 * the environment provides for one purpose; it does not collect (that is L3), recommend,
 * or build.
 *
 * Binding constraints (CLAUDE.md §5 L2, verbatim):
 *  - PURPOSE-BOUND EVIDENCE ONLY: the model considers ONLY the elements this purpose
 *    declares as required — never a full-environment enumeration / silent scan.
 *  - THE FOUR STATES EVERYWHERE: every element resolves to HAVE/NEED/UNKNOWN/UNAVAILABLE.
 *  - UNKNOWN NEVER SILENTLY BECOMES HAVE: only an affirmative `present` probe → HAVE; an
 *    inconclusive probe → UNKNOWN and stays there (deny-by-default for evidence).
 *  - DISCOVER ≠ RECOMMEND ≠ BUILD: this layer classifies evidence; it emits no
 *    recommendation and no built artifact.
 *
 * Zero-runtime-import invariant (pinned): imports NOTHING but its own types. Evidence
 * arrives ONLY through injected `sources` — no path into collection, discovery, or execution.
 */

import type { TenantStamp } from '../tenancy/tenantStamp';

/** The four environment states — the only classifications an element may hold. */
export type ElementState =
  | 'HAVE' //        the environment affirmatively provides it (evidenced present)
  | 'NEED' //        the purpose requires it and it is evidenced ABSENT (a real gap)
  | 'UNKNOWN' //     not determined — no conclusive evidence; NEVER promoted to HAVE
  | 'UNAVAILABLE'; // cannot be determined — the evidence source itself is absent

/** An element a purpose requires (a capability / data / connector). */
export interface RequiredElement {
  readonly id: string;
  readonly kind: 'capability' | 'data' | 'connector';
  readonly label: string;
}

/** One classified element with the evidence basis that justified its state. */
export interface EnvironmentElement {
  readonly element: RequiredElement;
  readonly state: ElementState;
  readonly basis: string;
}

/** Injected evidence — the ONLY way presence enters. `null` = the source cannot probe it. */
export interface EnvironmentSources {
  readonly probe: (element: RequiredElement) => 'present' | 'absent' | 'unknown' | null;
}

/** The observable object — a purpose-bound environment model with four-state rollups. */
export interface EnvironmentModel {
  readonly purpose: string;
  readonly elements: readonly EnvironmentElement[];
  readonly have: readonly string[];
  readonly need: readonly string[];
  readonly unknown: readonly string[];
  readonly unavailable: readonly string[];
  /** S4.0 tenant stamp — set by the assembler/wiring from the ONE authoritative context. */
  readonly tenant?: TenantStamp;
}

export function composeEnvironmentModel(
  purpose: string,
  required: readonly RequiredElement[],
  sources: EnvironmentSources,
): EnvironmentModel {
  const elements: EnvironmentElement[] = required.map((element) => {
    const probe = sources.probe(element);
    switch (probe) {
      case 'present':
        return { element, state: 'HAVE', basis: 'evidence: source reports present' };
      case 'absent':
        return { element, state: 'NEED', basis: 'evidence: source reports absent (required by purpose)' };
      case 'unknown':
        // Inconclusive evidence stays UNKNOWN — it is NEVER silently promoted to HAVE.
        return { element, state: 'UNKNOWN', basis: 'evidence inconclusive — halting at UNKNOWN' };
      case null:
      default:
        // The source itself cannot answer — distinct from a known-absent NEED.
        return { element, state: 'UNAVAILABLE', basis: 'evidence source unavailable' };
    }
  });

  const idsInState = (state: ElementState): string[] =>
    elements.filter((e) => e.state === state).map((e) => e.element.id);

  return {
    purpose,
    elements,
    have: idsInState('HAVE'),
    need: idsInState('NEED'),
    unknown: idsInState('UNKNOWN'),
    unavailable: idsInState('UNAVAILABLE'),
  };
}
