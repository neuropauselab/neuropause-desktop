/**
 * Pure runtime power-event logic (V4.2), split out so it imports no Electron
 * runtime and can be unit-tested in a plain Node environment. The RuntimeService
 * consumes this to decide tray patches + recovery on sleep/resume/lock/unlock.
 */
import type { RuntimeTrayState } from './runtimeTrayMenu';

/** A power/lifecycle transition the runtime reacts to. */
export type RuntimePowerEvent = 'suspend' | 'resume' | 'lock' | 'unlock';

/**
 * Decide how the runtime reacts to a power event (PURE). Returns the tray patch to
 * apply and whether the renderer should be told to recover (reconnect voice /
 * automation after the machine wakes or unlocks).
 */
export function reactToPowerEvent(event: RuntimePowerEvent): {
  trayPatch: Partial<RuntimeTrayState>;
  recover: boolean;
} {
  switch (event) {
    case 'suspend':
    case 'lock':
      // Pause listening while the machine is away; automation state is preserved.
      return { trayPatch: { listening: false }, recover: false };
    case 'resume':
    case 'unlock':
      // Machine is back — ask the renderer to reconnect its runtime pieces.
      return { trayPatch: {}, recover: true };
  }
}
