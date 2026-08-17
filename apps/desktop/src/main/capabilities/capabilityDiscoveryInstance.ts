/**
 * The live capability-discovery singleton — binds the pure service + adapter to the real runtime stores.
 *
 * This is the only capability module that touches the Electron-coupled singletons, so the service and the adapter
 * stay unit-testable. Reads are lazy (inside thunks): constructing this singleton does no store access, and each
 * `catalog()` call reads fresh authoritative state.
 *   - active workspace  ← `workspaceStore.activeWorkspaceIdOrNull()` (fail-closed)
 *   - connected accounts ← `connectorService.list()` (already active-workspace-scoped), flattened
 *   - M365 actions       ← `ALL_M365_ACTIONS` (sanitized in the adapter)
 *
 * It reads existing authoritative state and composes it. It stores no account truth, holds no credential, and
 * performs no effect.
 */
import { connectorService } from '../connectors/connectorService';
import { ALL_M365_ACTIONS } from '../connectors/m365';
import { workspaceStore } from '../enterprise/workspace/workspaceInstance';
import { CapabilityDiscoveryService } from './capabilityDiscoveryService';
import { buildCapabilitySources } from './liveCapabilitySources';

export const capabilityDiscoveryService = new CapabilityDiscoveryService(
  buildCapabilitySources({
    activeWorkspaceId: () => workspaceStore.activeWorkspaceIdOrNull(),
    connectedAccounts: () => connectorService.list().flatMap((dto) => dto.accounts),
    m365Actions: () => ALL_M365_ACTIONS,
  }),
);
