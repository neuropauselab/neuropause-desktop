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
  /*
   * SUPERSEDED BY THE COMPLETED D13 DECISION (§2 #26).
   *
   * This test previously read `the declared class table is unchanged — D13 was not
   * reinterpreted` and pinned the six methods NP-008's implementer had chosen. That was the
   * correct pin at the time: NP-017 was forbidden from reinterpreting a submitted decision.
   *
   * NP-018 then measured that D13 had never actually said what PSEUDONYMIZED does, and that the
   * definition driving ten seams was the implementer's own code comment. The decision-maker
   * completed D13, and D13-C INVERTED two of the six. So the table did change - not by
   * reinterpretation, which this test rightly forbade, but by decision, which it cannot forbid.
   *
   * The pin's PURPOSE is unchanged and is why it is kept rather than deleted: no method may move
   * without a decision. The literals below are the decision's, quoted.
   */
  it('the declared class table is exactly D13-C, quoted', () => {
    expect(RETENTION_CLASSES.map((c) => `${c.name}:${c.method}`)).toEqual([
      'pilot_events:PSEUDONYMIZED',          // D13-C inverted this from DELETED
      'consents:PSEUDONYMIZED',
      'pilot_enrollments:PSEUDONYMIZED',
      'pilot_lifecycle_events:PSEUDONYMIZED',
      'human_decisions:PSEUDONYMIZED',
      'pilot_monitor_events:DELETED',        // D13-C inverted this from PSEUDONYMIZED
    ]);
  });

  /*
   * SUPERSEDED. The old form asserted a STRICT SUBSET - two of six - because NP-017 measured the
   * other four as blocked by NOT NULL subject FKs that a P2 "sever by nulling" cannot satisfy.
   * D13-D selected P1 instead, and `pilot_subject_pseudonyms` gives the FK a real row to point
   * at, so all six are executable WITH EVERY ONE OF THOSE CONSTRAINTS STILL ENFORCED. The
   * integration suite measures that directly against information_schema.
   *
   * The replacement is deliberately not `EXECUTABLE_CLASSES.length === 6`, which would be a
   * constant compared with itself. It asserts the two sets AGREE - so declaring a seventh class
   * without giving it an executable mapping fails here. Mutation M7 (drop `consents` from the
   * column map) was measured against this: 6 tests red.
   */
  it('EXECUTABLE_CLASSES and the declared classes agree — nothing is declared then skipped', () => {
    expect([...EXECUTABLE_CLASSES].sort()).toEqual(RETENTION_CLASSES.map((c) => c.name).sort());
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
    expect(src).toContain('applyAndVerify');                    // vacuity guard, FIRST
    // Each branch must re-read the database and compare, not merely assume the write worked.
    expect(src).toMatch(/SELECT count\(\*\)::int AS n FROM/);
    // DELETE: nothing may still name the subject.
    expect(src).toMatch(/return remaining === 0 \? 'VERIFIED' : 'NOT_EXECUTABLE';/);
    // PSEUDONYMIZE: nothing names the subject AND the rows arrived under the pseudonym. The
    // second limb is what distinguishes D13-D's REPLACE from a deletion.
    expect(src).toMatch(/remaining === 0 && carried >= before \? 'VERIFIED' : 'NOT_EXECUTABLE';/);
  });

  /*
   * SUPERSEDED, AND IT WAS STILL PASSING - which is the reason it is rewritten rather than left
   * alone. Its title spoke of "the four unexecutable classes"; there are none. It stayed green
   * only because the class names still appear in the file and the string 'HUMAN DECISION' now
   * occurs inside an unrelated D13-C comment. A test that passes for a reason its title does not
   * describe is worse than no test (NP-020 #9), so the assertion is re-aimed at what actually
   * matters now: every class carries an executable column mapping, and none was quietly dropped.
   */
  it('every declared class has a subject-column mapping in the source, none silently dropped',
    () => {
      const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
      expect(src).toContain('SUBJECT_COLUMNS');                 // vacuity guard, FIRST
      const map = src.slice(src.indexOf('const SUBJECT_COLUMNS'),
                            src.indexOf('export const EXECUTABLE_CLASSES'));
      for (const c of RETENTION_CLASSES) expect(map).toContain(`${c.name}:`);
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
