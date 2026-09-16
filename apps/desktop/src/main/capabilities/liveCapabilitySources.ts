/**
 * Live capability sources — the pure adapter from runtime state shapes to the discovery service's inputs.
 *
 * This file is deliberately free of any store/Electron import so it stays unit-testable: it turns injected live-state
 * readers into a `CapabilitySources`. The actual binding to the real singletons lives in `capabilityDiscoveryInstance`.
 *
 * Two honesty rules are enforced here:
 *   1. The M365 action list is SANITIZED — `WriteAction.run` (the executor handle) is dropped, so no callable ever
 *      reaches the catalog or the AI. Only the self-describing fields survive.
 *   2. Mutation assurance is conservative and fact-based: only the certified M365 path is `governed-certified`
 *      (governedSend/governedAction + Boundary-B + durable admission, 29/29). Every other connector's mutation is
 *      `governance-not-proven` until its governed path is separately certified.
 */
import type { ConnectedAccount, ConnectorWriteActionInfo } from '@neuropause/shared';
import type { WriteAction } from '../connectors/m365/actionSdk';
import type { ConnectorActionSource } from './capabilityCatalog';
import type { CapabilityAssurance, CapabilitySources } from './capabilityDiscoveryService';

/** The connector id of the certified Microsoft 365 surface. */
export const M365_CONNECTOR_ID = 'microsoft-entra';

/** Live-state readers the wiring binds to the real stores. Kept as thunks so state is read fresh on each call. */
export interface LiveCapabilityDeps {
  /** Fail-closed active workspace id (null when unresolved). */
  activeWorkspaceId: () => string | null;
  /** Connected accounts — already active-workspace-scoped by the connector store. */
  connectedAccounts: () => readonly ConnectedAccount[];
  /** The authoritative M365 action catalog (`ALL_M365_ACTIONS`). Sanitized here before use. */
  m365Actions: () => readonly WriteAction[];
}

/** Drop the executor handle (`run`) and keep only the self-describing fields — no callable reaches the catalog. */
export function sanitizeM365Action(action: WriteAction): ConnectorWriteActionInfo {
  return {
    id: action.id,
    label: action.label,
    domain: action.domain,
    scopes: action.scopes,
    mutates: action.mutates,
  };
}

/**
 * THE certified-consequential capability set — one named authority.
 *
 * F-N16-1: this predicate previously existed only as an inline lambda inside
 * the L6 execution gate (plus a verbatim copy in a test), while discovery
 * answered a CONNECTOR-level question — so `calendar.create` read
 * `governed-certified` and `aiSelectable` at discovery while the S5.1 boundary
 * refused it. Deny-by-default held where it counts, but the discovery layer
 * was claiming a standing the boundary denies, which is the one place that
 * class of untruth must never live.
 *
 * Naming it ONCE here is deliberate: a third copy would be the same disease.
 * The gate's inline lambda is pinned AGAINST this set (see the agreement pin
 * in `capabilityRecord.test.ts`) so the two cannot drift apart unnoticed, and
 * collapsing the gate onto this export is the ruled reconciliation slice's
 * work (that file is a GATE-class surface and its diff is presented, not
 * slipped in).
 *
 * A capability enters this set ONLY with a live certified chain behind it
 * (S11–S16 for `mail.send`). Kit-complete is not certified; a governed
 * executor is not certified; a certified CONNECTOR is not certified (§24).
 */
export const CERTIFIED_CONSEQUENTIAL_CAPABILITIES: readonly string[] = ['mail.send'];

/** Is THIS ACTION certified for governed execution? (Not "is its connector".) */
export function isCertifiedConsequentialCapability(capabilityId: string): boolean {
  return CERTIFIED_CONSEQUENTIAL_CAPABILITIES.includes(capabilityId);
}

/**
 * Conservative, fact-based assurance for MUTATIONS.
 *
 * Two questions, one function, and the argument list says which is being
 * asked. WITH a `capabilityId` this answers the ACTION-level question — the
 * only one that can honestly justify showing a capability as governed. WITHOUT
 * one it answers the CONNECTOR-level question, which per ARCHITECTURE-SPEC §24
 * does NOT mean any particular action is certified; callers that pass only a
 * connector are asking about the integration, not about an action, and must
 * not present the answer as an action's standing.
 */
export function mutationAssuranceFor(connectorId: string, capabilityId?: string): CapabilityAssurance {
  if (connectorId !== M365_CONNECTOR_ID) return 'governance-not-proven';
  if (capabilityId !== undefined && !isCertifiedConsequentialCapability(capabilityId)) {
    return 'governance-not-proven';
  }
  return 'governed-certified';
}

/** Build the discovery service's `CapabilitySources` from live-state readers. Pure — no store/Electron access. */
export function buildCapabilitySources(deps: LiveCapabilityDeps): CapabilitySources {
  return {
    activeWorkspaceId: deps.activeWorkspaceId,
    accounts: deps.connectedAccounts,
    actionSources: (): readonly ConnectorActionSource[] => [
      {
        connectorId: M365_CONNECTOR_ID,
        executor: 'm365',
        actions: deps.m365Actions().map(sanitizeM365Action),
      },
    ],
    mutationAssurance: mutationAssuranceFor,
  };
}
