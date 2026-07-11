import { describe, expect, it } from 'vitest';
import { IpcChannel, ALL_SUBSCRIBABLE_CHANNELS, RUNTIME_BROADCAST_CHANNELS } from '@neuropause/shared';

/**
 * Regression guard for the P2.1/P2.2 connector-health surfaces: the renderer subscribes to the live sync
 * snapshot feed via `ipc.connectors.onSyncState` → `subscribe(ConnectorSyncState)`. The preload only
 * permits channels on ALL_SUBSCRIBABLE_CHANNELS, so this channel MUST be a broadcast channel — otherwise
 * the Connectors page throws "Channel connectors:sync-state is not subscribable" at runtime (which the
 * typecheck/lint/unit gates cannot catch).
 */
describe('connector sync-state channel is subscribable', () => {
  it('ConnectorSyncState is a runtime broadcast channel', () => {
    expect(RUNTIME_BROADCAST_CHANNELS).toContain(IpcChannel.ConnectorSyncState);
  });

  it('ConnectorSyncState is on the preload subscribe allowlist', () => {
    expect(ALL_SUBSCRIBABLE_CHANNELS).toContain(IpcChannel.ConnectorSyncState);
  });

  it('ConnectorEventBroadcast is subscribable too', () => {
    expect(ALL_SUBSCRIBABLE_CHANNELS).toContain(IpcChannel.ConnectorEventBroadcast);
  });
});
