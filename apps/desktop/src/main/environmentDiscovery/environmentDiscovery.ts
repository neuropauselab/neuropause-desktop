/**
 * L3 · Environment Discovery — SLICE 1 (the OBSERVABLE OBJECT).
 *
 * A PURE pipeline: `runDiscovery(request, sources)` → a `DiscoveryRun` walking the
 * binding sequence for every element —
 *   PURPOSE → DISCOVERY REQUEST → MINIMUM REQUIRED DATA → USER/POLICY AUTHORITY →
 *   COLLECTION → CLASSIFICATION → EVIDENCE.
 * It DISCOVERS (collects under authority, classifies, evidences); it NEVER recommends or
 * builds, and it NEVER performs a silent scan.
 *
 * Binding constraints (CLAUDE.md §5 L3, verbatim):
 *  - NEVER A SILENT DEVICE SCAN: `collect` is invoked ONLY for an element with explicit
 *    USER/POLICY authority (`granted`). Deny-by-default: denied or unresolved authority →
 *    NO collection. (Enforced structurally + pinned by a call-spy.)
 *  - MINIMUM REQUIRED DATA: the request carries ONLY the purpose's unmet gaps
 *    (`discoveryRequestFor` derives them from an L2 model's NEED + UNKNOWN — never the HAVE
 *    set, never the wider environment).
 *  - DISCOVER ≠ RECOMMEND ≠ BUILD: the run emits classified evidence — no recommendation,
 *    no built artifact.
 *
 * Zero-runtime-import invariant (pinned): imports NOTHING but TYPES (the L2 element/model
 * types, read-only). No value import — no path into collection back-ends, governance, or
 * execution; every fact enters through injected `sources`.
 */
import type { RequiredElement, EnvironmentModel } from '../environmentModel/environmentModel';
import type { TenantStamp } from '../tenancy/tenantStamp';

/** Stage 1→3: the purpose-bound request carrying ONLY the minimum required data. */
export interface DiscoveryRequest {
  readonly purpose: string;
  readonly minimumRequired: readonly RequiredElement[];
}

/** USER/POLICY authority for collecting one element. Deny-by-default. */
export type DiscoveryAuthority = 'granted' | 'denied' | 'unknown';

/** A collected datum — this layer classifies presence; it does not interpret content. */
export interface CollectedDatum {
  readonly elementId: string;
  readonly present: boolean;
}

/** Injected sources — the ONLY way authority and collection enter. */
export interface DiscoverySources {
  /** USER/POLICY authority for THIS element. */
  readonly authorize: (element: RequiredElement) => DiscoveryAuthority;
  /** Collect the element — invoked ONLY when authority === 'granted'. `null` = collection failed. */
  readonly collect: (element: RequiredElement) => CollectedDatum | null;
}

export type DiscoveryOutcome =
  | 'COLLECTED' //          authorized + collected → classified
  | 'DENIED' //             authority refused — NO collection
  | 'AUTHORITY_UNKNOWN' //  authority unresolved — NO collection (never scan without authority)
  | 'COLLECTION_FAILED'; // authorized but the collector produced no datum

/** The classification feeds back into L2's four states — denied/unresolved stay UNKNOWN. */
export type DiscoveredState = 'HAVE' | 'NEED' | 'UNKNOWN' | 'UNAVAILABLE';

export interface DiscoveryResult {
  readonly element: RequiredElement;
  readonly outcome: DiscoveryOutcome;
  readonly state: DiscoveredState;
  readonly evidence: readonly string[];
}

/** The observable object. */
export interface DiscoveryRun {
  readonly purpose: string;
  readonly results: readonly DiscoveryResult[];
  /** S4.0 tenant stamp — set by the assembler/wiring from the ONE authoritative context. */
  readonly tenant?: TenantStamp;
}

/**
 * Build a purpose-bound request: the MINIMUM required data = the L2 model's unmet gaps
 * (NEED + UNKNOWN). HAVE is already satisfied (never re-collected); UNAVAILABLE cannot be
 * probed (out of discovery's reach). Reads the model's fields only — no runtime coupling.
 */
export function discoveryRequestFor(model: EnvironmentModel): DiscoveryRequest {
  const gaps = new Set<string>([...model.need, ...model.unknown]);
  return {
    purpose: model.purpose,
    minimumRequired: model.elements.filter((e) => gaps.has(e.element.id)).map((e) => e.element),
  };
}

export function runDiscovery(request: DiscoveryRequest, sources: DiscoverySources): DiscoveryRun {
  const results: DiscoveryResult[] = request.minimumRequired.map((element) => {
    const trace: string[] = [
      `PURPOSE ${request.purpose}`,
      `REQUEST minimum-required: ${element.id}`,
    ];

    const authority = sources.authorize(element);
    trace.push(`AUTHORITY ${authority}`);

    // Deny-by-default: NO collection unless authority is explicitly granted. Never a silent scan.
    if (authority === 'denied') {
      return {
        element,
        outcome: 'DENIED',
        state: 'UNKNOWN', // not permitted to determine → honestly undetermined, never fabricated
        evidence: [...trace, 'NO COLLECTION (deny-by-default)'],
      };
    }
    if (authority === 'unknown') {
      return {
        element,
        outcome: 'AUTHORITY_UNKNOWN',
        state: 'UNKNOWN',
        evidence: [...trace, 'NO COLLECTION (authority unresolved — never scan without authority)'],
      };
    }

    // Authorized → the ONLY path that reaches the collector.
    const datum = sources.collect(element);
    trace.push('COLLECTION invoked (authorized)');
    if (datum === null) {
      return {
        element,
        outcome: 'COLLECTION_FAILED',
        state: 'UNAVAILABLE',
        evidence: [...trace, 'collector produced no datum'],
      };
    }

    const state: DiscoveredState = datum.present ? 'HAVE' : 'NEED';
    trace.push(`CLASSIFICATION ${state}`);
    return { element, outcome: 'COLLECTED', state, evidence: [...trace, 'EVIDENCE recorded'] };
  });

  return { purpose: request.purpose, results };
}
