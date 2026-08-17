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

/** Conservative, fact-based assurance: only the certified M365 path is governed-certified for mutations. */
export function mutationAssuranceFor(connectorId: string): CapabilityAssurance {
  return connectorId === M365_CONNECTOR_ID ? 'governed-certified' : 'governance-not-proven';
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
