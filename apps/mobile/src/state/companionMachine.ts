/**
 * Companion launch/auth state machine (Mobile M1-09) — the phone's lifecycle as
 * a PURE reducer, split out of the React provider so its transitions unit-test
 * in plain Node (no RN, no keychain, no camera). The provider owns the side
 * effects (secure-store, biometrics, pairing) and only feeds events in here.
 *
 * Phases:
 *   booting  — loading the device identity key and any saved session
 *   unpaired — no saved session; the pairing (QR-scan) flow is shown
 *   locked   — a session exists but Face ID / Touch ID has not been passed yet
 *   ready    — unlocked and paired; enterprise data may be rendered
 *   error    — boot failed; a retry is offered
 */
export type CompanionPhase = 'booting' | 'unpaired' | 'locked' | 'ready' | 'error';

export interface CompanionMachineState {
  phase: CompanionPhase;
  error: string | null;
}

export type CompanionEvent =
  | { type: 'booted'; hasSession: boolean }
  | { type: 'paired' }
  | { type: 'unlocked' }
  | { type: 'relock' }
  | { type: 'signedOut' }
  | { type: 'failed'; message: string }
  | { type: 'retry' };

export const initialCompanionState: CompanionMachineState = { phase: 'booting', error: null };

/**
 * Advance the machine. Events that don't apply to the current phase are no-ops
 * (the same state is returned) so a stray biometric callback or event race can
 * never wedge the app into an impossible state.
 */
export function companionReducer(
  state: CompanionMachineState,
  event: CompanionEvent,
): CompanionMachineState {
  switch (event.type) {
    case 'booted':
      // From booting only; a saved session means we must still pass biometrics.
      return state.phase === 'booting'
        ? { phase: event.hasSession ? 'locked' : 'unpaired', error: null }
        : state;
    case 'paired':
      // Pairing only ever runs from an interactive, foregrounded scan → straight in.
      return { phase: 'ready', error: null };
    case 'unlocked':
      return state.phase === 'locked' ? { phase: 'ready', error: null } : state;
    case 'relock':
      return state.phase === 'ready' ? { phase: 'locked', error: null } : state;
    case 'signedOut':
      return { phase: 'unpaired', error: null };
    case 'failed':
      return { phase: 'error', error: event.message };
    case 'retry':
      return { ...initialCompanionState };
    default:
      return state;
  }
}
