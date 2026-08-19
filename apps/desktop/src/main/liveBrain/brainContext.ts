/**
 * L6 · Live Brain — SLICE 2 · CONTEXT ASSEMBLY (provenance per field).
 *
 * `assembleBrainContext(inputs)` → a `BrainContext`: the five substrates + the ActionRecord
 * joined into ONE coherent context of atomic PROVENANCED FACTS. Where S1 (`LiveBrainState`)
 * gives synthesized SECTIONS with a section-level `source`, S2 drills to the FACT level —
 * every fact records which LAYER and which EVIDENCE OBJECT it came from, so no value in the
 * Brain's context is unattributable.
 *
 * Relationship to S1 (coherent, not contradictory): S2 facts are ATOMIC (one per evidence
 * object, per-source); S1 sections are SYNTHESIZED (cross-source, incl. CONFLICTING). A fact
 * "capability mail.send is routable" is KNOWN at the atomic level even when S1 marks the
 * capabilities section CONFLICTING because a DIFFERENT substrate disagrees — different
 * granularities of the same inputs, both deterministic.
 *
 * Deterministic-first (D-14) + §2#13: pure, synchronous, ASSEMBLE-only. Zero execution/grant
 * authority — imports only TYPES; every fact arrives from injected read-model outputs. It
 * reads no store (S34a arrives as already-queried `ActionRecord[]`, the D-14 finding).
 */
import type { Certainty, LiveBrainInputs } from './liveBrainState';
import { classifyTerminal } from '../verification/verificationTerminals';

/** Where a fact came from: the layer + the specific evidence object (never empty). */
export interface Provenance {
  readonly layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'S34a';
  readonly evidence: string;
}

/** One atomic, provenanced fact. */
export interface ProvenancedFact {
  readonly field: string;
  readonly value: string;
  readonly certainty: Certainty;
  readonly provenance: Provenance;
}

export interface BrainContext {
  readonly scopeResolved: boolean;
  readonly tenantId: string | null;
  readonly facts: readonly ProvenancedFact[];
}

const fact = (field: string, value: string, certainty: Certainty, layer: Provenance['layer'], evidence: string): ProvenancedFact => ({
  field,
  value,
  certainty,
  provenance: { layer, evidence },
});

/** L2 four states → certainty: HAVE/NEED are KNOWN facts; UNKNOWN stays UNKNOWN; UNAVAILABLE stays UNAVAILABLE. */
function envCertainty(state: 'HAVE' | 'NEED' | 'UNKNOWN' | 'UNAVAILABLE'): Certainty {
  return state === 'UNKNOWN' ? 'UNKNOWN' : state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'KNOWN';
}

/**
 * Verification-terminal → S2 certainty, via the CANONICAL D-16 authority (`verificationTerminals`):
 * success → VERIFIED; failure → KNOWN (a known failure); unresolved/null → UNKNOWN. This module
 * hardcodes NO terminal strings (anti-re-entry invariant). Deny-by-default: unrecognised → UNKNOWN.
 */
function verificationCertainty(terminal: string | null): Certainty {
  if (terminal === null) return 'UNKNOWN';
  const cls = classifyTerminal(terminal);
  return cls === 'success' ? 'VERIFIED' : cls === 'failure' ? 'KNOWN' : 'UNKNOWN';
}

export function assembleBrainContext(inputs: LiveBrainInputs): BrainContext {
  const facts: ProvenancedFact[] = [];

  // ── L1 workspace (ambient) ────────────────────────────────────────────────────────────
  if (inputs.workspace === null) {
    facts.push(fact('workspace', 'no workspace snapshot', 'UNAVAILABLE', 'L1', '(no WorkspaceDomainSnapshot)'));
  } else if (!inputs.workspace.scopeResolved) {
    facts.push(fact('workspace.scope', 'unresolved', 'UNAVAILABLE', 'L1', 'WorkspaceDomainSnapshot(scopeResolved=false)'));
  } else {
    for (const slice of inputs.workspace.slices) {
      facts.push(
        slice.state === 'present'
          ? fact(`workspace.${slice.domain}`, `${slice.count} records`, 'KNOWN', 'L1', `DomainSlice(${slice.moduleId})`)
          : fact(`workspace.${slice.domain}`, 'unavailable', 'UNAVAILABLE', 'L1', `DomainSlice(${slice.moduleId})`),
      );
    }
  }

  // ── L4 capabilities (ambient) ─────────────────────────────────────────────────────────
  if (inputs.capabilities === null) {
    facts.push(fact('capabilities', 'no capability graph', 'UNAVAILABLE', 'L4', '(no CapabilityGraphSnapshot)'));
  } else if (!inputs.capabilities.scopeResolved) {
    facts.push(fact('capabilities.scope', 'unresolved', 'UNAVAILABLE', 'L4', 'CapabilityGraphSnapshot(scopeResolved=false)'));
  } else {
    for (const route of inputs.capabilities.routes) {
      facts.push(fact(`capability.${route.capability}`, `routable via ${route.workflow}`, 'KNOWN', 'L4', `CapabilityRoute(${route.capability})`));
    }
    for (const gap of inputs.capabilities.gaps) {
      facts.push(
        gap.kind === 'not-governed'
          ? fact(`capability.${gap.capability}`, 'not governed', 'KNOWN', 'L4', `CapabilityGap(${gap.capability}:not-governed)`)
          : fact(`capability.${gap.capability}`, 'unresolved (missing lane/workflow)', 'UNKNOWN', 'L4', `CapabilityGap(${gap.capability}:missing)`),
      );
    }
  }

  // ── L2 environment (purpose-bound) ────────────────────────────────────────────────────
  if (inputs.environment === null) {
    facts.push(fact('environment', 'no active purpose', 'UNAVAILABLE', 'L2', '(no EnvironmentModel)'));
  } else {
    for (const e of inputs.environment.elements) {
      facts.push(
        fact(`environment.${e.element.id}`, e.state, envCertainty(e.state), 'L2', `EnvironmentElement(${e.element.id}) — ${e.basis}`),
      );
    }
  }

  // ── L5 purpose (purpose-bound) ────────────────────────────────────────────────────────
  if (inputs.purpose === null) {
    facts.push(fact('purpose', 'no active purpose', 'UNAVAILABLE', 'L5', '(no PurposeEvaluation)'));
  } else {
    const undetermined = inputs.purpose.state === 'UNKNOWN' || inputs.purpose.state === 'NEEDS_CLARIFICATION';
    const rung = inputs.purpose.trace.length > 0 ? inputs.purpose.trace[inputs.purpose.trace.length - 1].rung : inputs.purpose.state;
    facts.push(
      fact(
        `purpose.${inputs.purpose.purpose ?? '(none)'}`,
        inputs.purpose.state,
        undetermined ? 'UNKNOWN' : 'KNOWN',
        'L5',
        `PurposeEvaluation(${inputs.purpose.purpose ?? '(none)'}) → trace:${rung}`,
      ),
    );
  }

  // ── L3 discovery (purpose-bound) ──────────────────────────────────────────────────────
  if (inputs.discovery === null) {
    facts.push(fact('discovery', 'no discovery run', 'UNAVAILABLE', 'L3', '(no DiscoveryRun)'));
  } else {
    for (const r of inputs.discovery.results) {
      const c: Certainty = r.state === 'UNKNOWN' ? 'UNKNOWN' : r.state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'KNOWN';
      facts.push(fact(`discovery.${r.element.id}`, `${r.outcome}/${r.state}`, c, 'L3', `DiscoveryResult(${r.element.id})`));
    }
  }

  // ── S34a evidence (ambient; already-queried ActionRecord[], D-14) ─────────────────────
  if (inputs.actions.length === 0) {
    facts.push(fact('evidence', 'no governed actions recorded', 'UNAVAILABLE', 'S34a', '(no ActionRecords)'));
  } else {
    for (const rec of inputs.actions) {
      const term = rec.verification?.terminal ?? null;
      const value = term === null ? `${rec.outcome} / unverified` : `${rec.outcome} / verified ${term}`;
      facts.push(fact(`action.${rec.id}`, value, verificationCertainty(term), 'S34a', `ActionRecord(${rec.id})`));
    }
  }

  const scopeResolved = (inputs.workspace?.scopeResolved ?? false) || (inputs.capabilities?.scopeResolved ?? false);
  return { scopeResolved, tenantId: inputs.workspace?.tenantId ?? null, facts };
}
