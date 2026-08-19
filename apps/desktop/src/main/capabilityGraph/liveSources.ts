/**
 * L4 Capability Graph — LIVE WIRING to the real substrate.
 *
 * Binds `composeCapabilityGraph`'s sources to what actually exists today: the REAL
 * assurance predicate (`mutationAssuranceFor`), the certified connector
 * (`M365_CONNECTOR_ID`), and the BRAIN-1 draft lane serving `mail.send`. READ-only:
 * it reads the discovery catalog + predicates; it imports NO executor and calls no
 * execution path (the proposal-only invariant, pinned).
 *
 * HONEST substrate note (recorded in the evidence): `mutationAssuranceFor` is a
 * PER-CONNECTOR predicate — every microsoft-entra mutation reads `governed-certified`.
 * It does NOT yet distinguish `mail.send`'s full certification chain (governed CST +
 * FG-4 guard + S16 oracle + S34a evidence) from the other M365 mutations; that
 * per-capability 14-field record is S23. So today the ONLY capability that fully
 * ROUTES (a certified assurance AND a resolved lane + workflow) is `mail.send`; other
 * certified-connector mutations resolve no lane/workflow → MISSING; a mutation on a
 * NON-certified connector → NOT_GOVERNED.
 */
import { mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
import type { CapabilityGraphSources, DiscoveredCapabilityLite } from './capabilityGraph';

/** The minimum a discovery-catalog mutation needs to enter the graph. */
export interface CatalogMutation {
  readonly capabilityId: string;
  readonly connectorId: string;
}

export interface LiveGraphDeps {
  /** The consequential (mutation) capabilities from the discovery catalog. */
  readonly mutations: () => readonly CatalogMutation[];
  /** The tenant is resolved (fail-closed: activeWorkspaceId !== null). */
  readonly scope: () => boolean;
}

/** The one capability with a fully-resolved certified workflow today. */
const MAIL_SEND = 'mail.send';

export function capabilityGraphSources(deps: LiveGraphDeps): CapabilityGraphSources {
  return {
    scope: deps.scope,
    capabilities: (): readonly DiscoveredCapabilityLite[] =>
      deps.mutations().map((m) => ({
        capability: m.capabilityId,
        connector: m.connectorId,
        mutates: true,
        assurance: mutationAssuranceFor(m.connectorId), // the REAL per-connector predicate
      })),
    // BRAIN-1 draft lane serves mail.send (serving `referenceDrafter` today, D-13).
    laneFor: (cap) => (cap === MAIL_SEND ? { lane: 'draft', serving: 'referenceDrafter' } : null),
    // The one certified governed workflow that resolves today.
    workflowFor: (cap) => (cap === MAIL_SEND ? 'capability:m365.propose → governedSend' : null),
    purposeFor: (cap) => (cap === MAIL_SEND ? 'send-email' : cap),
  };
}
