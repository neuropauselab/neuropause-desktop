/**
 * Mobile M1-09 — pure tests for the companion launch/auth state machine. Locks
 * the whole lifecycle: cold start with/without a session, biometric unlock,
 * re-lock, pairing, sign-out, failure + retry, and that off-phase events are
 * inert. Runs via the mobile vitest.
 */
import { describe, expect, it } from 'vitest';
import {
  companionReducer,
  initialCompanionState,
  type CompanionMachineState,
} from './companionMachine';

const at = (phase: CompanionMachineState['phase'], error: string | null = null) => ({
  phase,
  error,
});

describe('companionReducer', () => {
  it('starts booting', () => {
    expect(initialCompanionState).toEqual(at('booting'));
  });

  it('boots to locked when a session was restored', () => {
    expect(companionReducer(at('booting'), { type: 'booted', hasSession: true })).toEqual(
      at('locked'),
    );
  });

  it('boots to unpaired when there is no session', () => {
    expect(companionReducer(at('booting'), { type: 'booted', hasSession: false })).toEqual(
      at('unpaired'),
    );
  });

  it('unlocks locked → ready, and re-locks ready → locked', () => {
    const ready = companionReducer(at('locked'), { type: 'unlocked' });
    expect(ready).toEqual(at('ready'));
    expect(companionReducer(ready, { type: 'relock' })).toEqual(at('locked'));
  });

  it('pairs straight into ready', () => {
    expect(companionReducer(at('unpaired'), { type: 'paired' })).toEqual(at('ready'));
  });

  it('signs out back to unpaired and clears any error', () => {
    expect(companionReducer(at('error', 'boom'), { type: 'signedOut' })).toEqual(at('unpaired'));
  });

  it('captures a failure message and retries back to booting', () => {
    const failed = companionReducer(at('booting'), { type: 'failed', message: 'no keychain' });
    expect(failed).toEqual(at('error', 'no keychain'));
    expect(companionReducer(failed, { type: 'retry' })).toEqual(at('booting'));
  });

  it('ignores off-phase events (unlock while unpaired, booted while ready)', () => {
    expect(companionReducer(at('unpaired'), { type: 'unlocked' })).toEqual(at('unpaired'));
    expect(companionReducer(at('ready'), { type: 'booted', hasSession: false })).toEqual(
      at('ready'),
    );
    expect(companionReducer(at('locked'), { type: 'relock' })).toEqual(at('locked'));
  });
});
