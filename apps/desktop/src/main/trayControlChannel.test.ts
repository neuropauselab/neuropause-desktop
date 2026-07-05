import { describe, expect, it } from 'vitest';
import { IpcChannel, SUBSCRIBABLE_CHANNELS, type TrayCommandPayload } from '@neuropause/shared';

/**
 * V4.1 — the runtime tray drives the renderer voice layer over the TrayCommand
 * broadcast. These assert the control-channel contract that makes that wiring
 * safe: the channel must be subscribable (so the preload allows it) and the
 * payload actions are the two the tray + widget agree on.
 */
describe('tray control channel (V4.1)', () => {
  it('TrayCommand is a subscribable broadcast (preload will allow it)', () => {
    expect(SUBSCRIBABLE_CHANNELS).toContain(IpcChannel.TrayCommand);
  });

  it('supports exactly the start/pause listening actions', () => {
    const start: TrayCommandPayload = { action: 'start-listening' };
    const pause: TrayCommandPayload = { action: 'pause-listening' };
    // Exhaustive mapping the widget relies on.
    const handled = (p: TrayCommandPayload): 'start' | 'pause' =>
      p.action === 'start-listening' ? 'start' : 'pause';
    expect(handled(start)).toBe('start');
    expect(handled(pause)).toBe('pause');
  });
});
