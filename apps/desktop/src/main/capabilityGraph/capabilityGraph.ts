/**
 * OS-track Layer 4 · Capability Graph — Slice 1 · the OBSERVABLE OBJECT.
 *
 * A queryable, tenant-scoped read-model that joins the EXISTING registries into
 * PURPOSE → CAPABILITY → MODEL/LANE → CONNECTOR → WORKFLOW routes — over CERTIFIED
 * SUBSTRATE ONLY. It is a READ/PROPOSE-only façade: it proposes routes; it cannot
 * execute and cannot grant authority (routing inherits the description-only
 * semantics of `capabilityProposeCore`/`selectCapability`).
 *
 * Certified-only + gap-honest (binding, L4): the certification predicate is the
 * REAL one that exists today — a capability is routable only when its governance
 * assurance is `governed-certified` (the M365 `mail.send` vertical). Everything
 * else is EXCLUDED and reported as a GAP, never invented, never routed around:
 *   - an uncertified mutation (assurance `governance-not-proven`) → NOT_GOVERNED gap;
 *   - a certified capability with no resolvable lane/workflow → MISSING gap.
 * This needs neither the S23 Certification Kit (it reads the existing 1-bit
 * assurance, which S23 would later enrich to a 14-field record) nor the S28 Policy
 * DSL (it reads the existing RBAC/CST facts).
 */

/** A capability as the discovery service already describes it (input, read-only). */
export interface DiscoveredCapabilityLite {
  readonly capability: string;
  readonly connector: string;
  readonly mutates: boolean;
  /** The REAL governance assurance — only `governed-certified` is routable. */
  readonly assurance: 'governed-certified' | 'governance-not-proven';
}

export interface CapabilityRoute {
  readonly purpose: string;
  readonly capability: string;
  /** The BRAIN-1 lane serving it (+ what it serves — e.g. `referenceDrafter`). */
  readonly lane: string;
  readonly connector: string;
  /** The governed workflow the route proposes (never executes). */
  readonly workflow: string;
}

export type GapKind = 'not-governed' | 'missing';

export interface CapabilityGap {
  readonly capability: string;
  readonly connector: string;
  readonly kind: GapKind;
  readonly reason: string;
}

export interface CapabilityGraphSnapshot {
  /** False when no tenant resolves — an empty graph, never "all capabilities". */
  readonly scopeResolved: boolean;
  /** Certified-only routes. */
  readonly routes: readonly CapabilityRoute[];
  /** Everything excluded from routing, reported honestly. */
  readonly gaps: readonly CapabilityGap[];
}

export interface CapabilityGraphSources {
  /** The tenant is resolved (fail-closed: false → empty graph). */
  readonly scope: () => boolean;
  /** The discovered capabilities + their REAL assurance (from the discovery service). */
  readonly capabilities: () => readonly DiscoveredCapabilityLite[];
  /** The BRAIN-1 lane serving a capability, or null when none resolves. */
  readonly laneFor: (capability: string) => { readonly lane: string; readonly serving: string } | null;
  /** The governed workflow for a capability, or null when none resolves. */
  readonly workflowFor: (capability: string) => string | null;
  /** The purpose a capability serves (a label). */
  readonly purposeFor: (capability: string) => string;
}

/**
 * Compose the capability graph. Pure, READ-only. A capability is routed ONLY when
 * it is a `governed-certified` mutation (or a certified capability) that resolves
 * to a real lane + workflow; uncertified mutations and unresolved routes become
 * honest GAPS. It invents nothing — every route + gap names a capability the
 * sources actually reported.
 */
export function composeCapabilityGraph(sources: CapabilityGraphSources): CapabilityGraphSnapshot {
  if (!sources.scope()) {
    return { scopeResolved: false, routes: [], gaps: [] };
  }
  const routes: CapabilityRoute[] = [];
  const gaps: CapabilityGap[] = [];
  for (const c of sources.capabilities()) {
    // Certified-only routing: an uncertified MUTATION is excluded and reported.
    if (c.mutates && c.assurance !== 'governed-certified') {
      gaps.push({
        capability: c.capability,
        connector: c.connector,
        kind: 'not-governed',
        reason: 'governance not proven — excluded from routing (NOT GOVERNED)',
      });
      continue;
    }
    const lane = sources.laneFor(c.capability);
    const workflow = sources.workflowFor(c.capability);
    if (lane === null || workflow === null) {
      gaps.push({
        capability: c.capability,
        connector: c.connector,
        kind: 'missing',
        reason: 'no lane/workflow resolves — routing incomplete (MISSING)',
      });
      continue;
    }
    routes.push({
      purpose: sources.purposeFor(c.capability),
      capability: c.capability,
      lane: lane.serving ? `${lane.lane} (serving ${lane.serving})` : lane.lane,
      connector: c.connector,
      workflow,
    });
  }
  return { scopeResolved: true, routes, gaps };
}
