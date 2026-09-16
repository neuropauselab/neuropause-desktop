/**
 * L3 · Environment Discovery — LIVE WIRING.
 *
 * Binds the discovery pipeline to the REAL substrate:
 *  - AUTHORITY comes from cheap CONSENT facts that require NO collection: a resolved
 *    workspace scope and at least one connected account (the user already consented to
 *    that connector). Deny-by-default: no workspace → `unknown`; no connected account →
 *    `denied`. Authority is decided WITHOUT reading the catalog, so the catalog probe —
 *    the actual collection — cannot run before authority (the never-a-silent-scan seam).
 *  - COLLECTION is the REAL capability catalog probe (`CapabilityDiscoveryService.catalog()`,
 *    tenant-scoped, fail-closed). Invoked ONLY inside `collect`, i.e. only after the core
 *    pipeline has confirmed `granted` authority. A capability present + available → HAVE;
 *    present but needing reconnect → NEED; not found → the collector yields nothing → UNAVAILABLE.
 *
 * READ-only adapter. Imports only TYPES: the `catalog` producer is injected (bound in
 * production to the real service), so there is no value import — no path into a collection
 * back-end, governance, or execution. Deny-by-default + never-a-silent-scan proven in the test.
 */
import type { CapabilityCatalogView } from '../capabilities/capabilityDiscoveryService';
import type { DiscoverySources } from './environmentDiscovery';

export interface DiscoveryEvidenceDeps {
  /** The active workspace is resolved (fail-closed: false → no authority context). */
  readonly workspaceResolved: () => boolean;
  /** How many accounts are connected (consent already given). A cheap fact — no collection. */
  readonly connectedAccountCount: () => number;
  /** The REAL tenant-scoped capability catalog — the collection, read ONLY under authority. */
  readonly catalog: () => CapabilityCatalogView;
}

export function liveDiscoverySources(deps: DiscoveryEvidenceDeps): DiscoverySources {
  return {
    // Authority from CONSENT facts only — never touches the catalog (no scan-before-authority).
    authorize: () => {
      if (!deps.workspaceResolved()) return 'unknown'; // no tenant context → deny-by-default
      if (deps.connectedAccountCount() <= 0) return 'denied'; // nothing consented to collect from
      return 'granted';
    },
    // Collection: the REAL catalog probe. The core pipeline calls this ONLY when authority === 'granted'.
    collect: (element) => {
      const view = deps.catalog(); // a tenant-scoped read — the collection, authorized by construction
      const match = view.capabilities.find((c) => c.capabilityId === element.id) ?? null;
      if (match === null) return null; // collector found nothing → COLLECTION_FAILED → UNAVAILABLE
      return { elementId: element.id, present: match.availability === 'available' };
    },
  };
}
