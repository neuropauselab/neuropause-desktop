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
    // NP-019 updated this line: the not-applied signal became a THROW, so that
    // withTransaction ROLLS BACK instead of committing a mutation it then reports as
    // failed. The ordering this test exists to pin is unchanged.
    expect(src).toMatch(/if \(outcome !== 'VERIFIED'\) throw new RetentionNotApplied\(outcome\);/);
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

  it('NP-019 SOURCE INVARIANT: every "not applied" signal inside the transaction is a THROW', () => {
    // withTransaction COMMITS on a normal return and ROLLS BACK only on a throw
    // (db/pool.ts:27-40). A `return false` inside the transaction body therefore COMMITS
    // whatever the body already did — which is exactly how a mutation came to be committed
    // while the operation reported failure (NP-019 R2).
    //
    // This is pinned at SOURCE level deliberately. The behavioural path "a mutation ran and
    // then its own verification failed" is NOT reachable by any test today: applyAndVerify
    // returns NOT_EXECUTABLE only from the null-subject guard and the unknown-class
    // fallthrough, and BOTH return before any mutation runs. So no behavioural test can catch
    // a regression here, and only reading the source can.
    const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
    expect(src).toContain('executeRetention');                  // vacuity guard, FIRST

    const from = src.indexOf('const ok = await withTransaction');
    // The slice must end at the boundary. The `.catch` that follows legitimately contains a
    // `return false` — that is the conversion of the sentinel back into a skipped item, and it
    // runs OUTSIDE the transaction. Including it here made this assertion fail against correct
    // code, which is a test defect, not a source defect.
    const to = src.indexOf('}).catch(');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const body = src.slice(from, to);

    // No bare `return false` may survive inside the transaction body.
    expect(body).not.toMatch(/\breturn false;/);
    // All three not-applied signals must be throws.
    expect(body).toMatch(/throw new RetentionNotApplied\('ON_HOLD'\)/);
    expect(body).toMatch(/throw new RetentionNotApplied\(outcome\)/);
    expect(body).toMatch(/throw new RetentionNotApplied\('ALREADY_CLAIMED'\)/);
    // ...and the BOUNDARY — which is outside the slice above, by construction — converts ONLY
    // the sentinel, so a real database error still propagates rather than being reported as a
    // quietly skipped item.
    const boundary = src.slice(src.indexOf('}).catch('), src.indexOf('if (ok) applied.push(item);'));
    expect(boundary).toMatch(/if \(e instanceof RetentionNotApplied\) return false;/);
    expect(boundary).toMatch(/throw e;/);
  });
});
