/**
 * L2 · Environment Model — LIVE WIRING.
 *
 * Builds the model's `probe` from REAL upstream read-models, so an element's four-state
 * classification derives from evidence that actually exists:
 *  - the L4 `CapabilityGraphSnapshot` answers "does the environment have a GOVERNED path
 *    for this capability?" — a route → HAVE; a NOT_GOVERNED gap → NEED (exists but not
 *    governed); a MISSING gap or an unknown capability → UNKNOWN;
 *  - the L1 `workspaceDomain` rollup answers "does the environment have DATA in this
 *    domain?" — present with records → HAVE; present-but-empty → NEED; an UNAVAILABLE
 *    slice (or an absent rollup, e.g. local mode) → UNAVAILABLE.
 *
 * READ-only adapter. Imports only TYPES: every fact arrives through the injected real
 * snapshots — no value import, no path into collection, governance, or execution. The
 * liveness is proven in the test by composing the REAL L4 graph + REAL L1 rollup and
 * asserting the model reflects them.
 */
import type { CapabilityGraphSnapshot } from '../capabilityGraph/capabilityGraph';
import type { ExecutiveSnapshot } from '@neuropause/shared';
import type { EnvironmentSources, RequiredElement } from './environmentModel';

/** The FG-8 L1 rollup field shape (may be null/absent — e.g. local mode). */
type WorkspaceDomainField = ExecutiveSnapshot['workspaceDomain'];

export interface EnvironmentEvidence {
  /** The L4 capability graph for the active tenant (routes + gaps). */
  readonly capabilityGraph: CapabilityGraphSnapshot;
  /** The L1 domain rollup, or null/undefined when the aggregate is unavailable. */
  readonly dataDomains: WorkspaceDomainField;
}

export function liveEnvironmentSources(evidence: EnvironmentEvidence): EnvironmentSources {
  const routed = new Set(evidence.capabilityGraph.routes.map((r) => r.capability));
  const gapKind = new Map(evidence.capabilityGraph.gaps.map((g) => [g.capability, g.kind]));
  const domainByModule = new Map((evidence.dataDomains?.slices ?? []).map((s) => [s.moduleId, s]));

  return {
    probe: (element: RequiredElement): 'present' | 'absent' | 'unknown' | null => {
      if (element.kind === 'capability') {
        // No resolved tenant → the graph cannot answer → UNAVAILABLE (never "all capabilities").
        if (!evidence.capabilityGraph.scopeResolved) return null;
        if (routed.has(element.id)) return 'present'; // a governed route exists → HAVE
        const kind = gapKind.get(element.id);
        if (kind === 'not-governed') return 'absent'; // exists but not governed → NEED a governed path
        if (kind === 'missing') return 'unknown'; // unresolved lane/workflow → UNKNOWN
        return 'unknown'; // the graph does not know this capability — UNKNOWN, never fabricated HAVE
      }
      if (element.kind === 'data') {
        const rollup = evidence.dataDomains;
        if (rollup == null || !rollup.scopeResolved) return null; // rollup absent/unresolved → UNAVAILABLE
        const slice = domainByModule.get(element.id);
        if (slice === undefined) return 'unknown'; // not a modelled domain — UNKNOWN
        if (slice.state === 'unavailable') return null; // honest UNAVAILABLE, never a fabricated 0
        return slice.count > 0 ? 'present' : 'absent'; // has records → HAVE; reachable-but-empty → NEED
      }
      // connector (or any future kind): no live evidence source yet — UNKNOWN, not invented.
      return 'unknown';
    },
  };
}
