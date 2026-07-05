import { describe, expect, it } from 'vitest';
import { reactToPowerEvent } from './runtimePower';

/**
 * V4.2 — runtime power reactions. On sleep/lock the runtime pauses listening; on
 * resume/unlock it signals recovery so the renderer reconnects voice/automation.
 */
describe('reactToPowerEvent (V4.2)', () => {
  it('pauses listening on suspend and lock, without recovery', () => {
    for (const e of ['suspend', 'lock'] as const) {
      const r = reactToPowerEvent(e);
      expect(r.trayPatch.listening).toBe(false);
      expect(r.recover).toBe(false);
    }
  });

  it('requests recovery on resume and unlock', () => {
    for (const e of ['resume', 'unlock'] as const) {
      const r = reactToPowerEvent(e);
      expect(r.recover).toBe(true);
      // resume/unlock don't force-pause listening.
      expect(r.trayPatch.listening).toBeUndefined();
    }
  });
});
