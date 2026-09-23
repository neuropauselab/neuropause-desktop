/**
 * NP-PILOT-FIRST-017 — replaces src/pilot/retentionDeadBranch.test.ts.
 *
 * TEST CLASS: source measurement + REAL constants. No stub, no database.
 *
 * That file was NP-016's known-gap pin: it asserted the retention ledger claimed work the code
 * never performed, and was written to FAIL the day the defect was fixed. It failed. This file
 * is what replaces it - the same facts, asserted from the other side.
 *
 * THE INVARIANT THIS PROTECTS: a class may be CLAIMED only if its declared method is one the
 * implementation can actually carry out and verify. Everything else is left unclaimed, so the
 * ledger never asserts work nobody performed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETENTION_CLASSES, EXECUTABLE_CLASSES } from './retention';

describe('NP-017 — retention claims only what it can execute and verify', () => {
  it('the declared class table is unchanged — D13 was not reinterpreted', () => {
    // §23: this seam implements the engineering interpretation of already-submitted retention
    // requirements. It does not change which classes exist or what method each is assigned.
    expect(RETENTION_CLASSES.map((c) => `${c.name}:${c.method}`)).toEqual([
      'pilot_events:DELETED',
      'consents:PSEUDONYMIZED',
      'pilot_enrollments:PSEUDONYMIZED',
      'pilot_lifecycle_events:PSEUDONYMIZED',
      'human_decisions:PSEUDONYMIZED',
      'pilot_monitor_events:PSEUDONYMIZED',
    ]);
  });

  it('EXECUTABLE_CLASSES is a strict subset, and names exactly what the schema permits', () => {
    expect(EXECUTABLE_CLASSES).toEqual(['pilot_events', 'pilot_monitor_events']);
    const declared = new Set(RETENTION_CLASSES.map((c) => c.name));
    for (const e of EXECUTABLE_CLASSES) expect(declared.has(e)).toBe(true);
    expect(EXECUTABLE_CLASSES.length).toBeLessThan(RETENTION_CLASSES.length);
  });

  it('SOURCE INVARIANT: the completion record is written AFTER the verified mutation', () => {
    const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
    expect(src).toContain('executeRetention');                    // vacuity guard, FIRST
    const verify = src.indexOf('const outcome = await applyAndVerify(client, item);');
    const claim = src.indexOf('INSERT INTO pilot_retention_log');
    expect(verify).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(claim);      // mutation+verification precede the claim
    // and the claim is unreachable unless verification succeeded
    expect(src).toMatch(/if \(outcome !== 'VERIFIED'\) return false;/);
  });

  it('every executable path VERIFIES its own effect before returning VERIFIED', () => {
    const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
    // Each branch must re-read the database and compare, not merely assume the write worked.
    const checks = src.match(/SELECT count\(\*\)::int AS n FROM/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(EXECUTABLE_CLASSES.length);
    expect(src).toMatch(/check\.rows\[0\]\.n === 0 \? 'VERIFIED' : 'NOT_EXECUTABLE'/);
  });

  it('the four unexecutable classes are documented with the schema reason, not silently dropped',
    () => {
      const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
      for (const cls of ['consents', 'pilot_enrollments', 'human_decisions', 'pilot_lifecycle_events'])
        expect(src).toContain(cls);
      expect(src).toContain('HUMAN DECISION');
    });
});
