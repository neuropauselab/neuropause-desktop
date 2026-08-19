import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyTerminal, isSuccessTerminal } from './verificationTerminals';

describe('D-16 · canonical verification-terminal authority', () => {
  it('classifies the REAL send + import vocabulary; deny-by-default for unrecognised → unresolved', () => {
    expect(classifyTerminal('VERIFIED_SUCCESS')).toBe('success');
    expect(classifyTerminal('VERIFY_FAILED')).toBe('failure'); // send oracle failure (the F1 fake-green)
    expect(classifyTerminal('VERIFIED_FAILURE')).toBe('failure'); // import failure
    for (const t of ['HOLD', 'UNKNOWN', 'VERIFY_PENDING', 'EXECUTED_ACK', 'VERIFIED_NOOP', 'anything-else']) {
      expect(classifyTerminal(t)).toBe('unresolved'); // never "settled" — §2#9
    }
    expect(isSuccessTerminal('VERIFIED_SUCCESS')).toBe(true);
    expect(isSuccessTerminal('VERIFY_FAILED')).toBe(false);
    expect(isSuccessTerminal(null)).toBe(false);
    expect(isSuccessTerminal(undefined)).toBe(false);
  });

  it('ANTI-RE-ENTRY INVARIANT — no CONSUMER of verification.terminal hardcodes a raw terminal string', () => {
    // Consumers MUST classify via this module; only this authority (+ producers + tests) may name terminals.
    const consumers = ['liveBrain/liveBrainState.ts', 'liveBrain/brainContext.ts', 'connectors/m365WriteStates.ts'];
    const rawTerminal = /VERIFIED_SUCCESS|VERIFY_FAILED|VERIFIED_FAILURE|VERIFY_PENDING|VERIFIED_NOOP/;
    for (const rel of consumers) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(src, `${rel} must route terminals through the D-16 authority, not hardcode them`).not.toMatch(rawTerminal);
    }
  });
});
