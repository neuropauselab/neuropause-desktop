/**
 * NP-PILOT-FIRST-016 — KNOWN-GAP PIN: retention records work it does not perform.
 *
 * TEST CLASS: source measurement + REAL constants. No stub, no database.
 *
 * THIS TEST ASSERTS THAT A DEFECT IS PRESENT. It is written to FAIL the day the defect is
 * fixed, which is the signal to delete it. Found by the NP-016 fan-out re-measuring NP-008's
 * retention implementation.
 *
 * THE DEFECT, in three measured parts:
 *
 *  1. `pilot_events` is the ONLY retention class whose method is 'DELETED'. The other five -
 *     consents, pilot_enrollments, pilot_lifecycle_events, human_decisions,
 *     pilot_monitor_events - are 'PSEUDONYMIZED'.
 *
 *  2. In executeRetention the PSEUDONYMIZED branch acts only `if (item.dataClass ===
 *     'pilot_events')`. Inside that branch item.method is PSEUDONYMIZED by construction, and no
 *     class is both. THE CONDITION IS UNSATISFIABLE AND ITS BODY IS UNREACHABLE.
 *
 *  3. The pilot_retention_log claim row - asserting that `method` was applied to `data_class`
 *     for `subject_user_id` - is INSERTed BEFORE any mutation, and the item is then counted as
 *     applied. So five of six classes produce a completed-work record with ZERO rows modified.
 *
 * WHY THIS IS WORSE THAN A MISSING FEATURE. D13 is a submitted human decision (retention, 90
 * days). The system does not merely fail to honour it - it manufactures evidence that it did.
 * And the no-op is SELF-SEALING: the claim row plus ON CONFLICT DO NOTHING plus the UNIQUE
 * constraint at 0018_pilot_governance_controls.sql means a later, correct implementation finds
 * the work already claimed and skips it ("another run already claimed it").
 *
 * NOT FIXED HERE. §28 permits design, tests and harnesses only; a production repair needs its
 * own authorized implementation seam. See 20-final-verdict.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETENTION_CLASSES } from './retention';

describe('KNOWN GAP — the retention ledger claims work the code never performs', () => {
  it('exactly one class is DELETED, and it is pilot_events', () => {
    const deleted = RETENTION_CLASSES.filter((c) => c.method === 'DELETED').map((c) => c.name);
    expect(deleted).toEqual(['pilot_events']);
  });

  it('five classes are PSEUDONYMIZED, and none of them is pilot_events', () => {
    const pseudo = RETENTION_CLASSES.filter((c) => c.method === 'PSEUDONYMIZED').map((c) => c.name);
    expect(pseudo).toEqual([
      'consents', 'pilot_enrollments', 'pilot_lifecycle_events', 'human_decisions',
      'pilot_monitor_events',
    ]);
    expect(pseudo).not.toContain('pilot_events');
  });

  it('THE DEAD BRANCH: the PSEUDONYMIZED path only acts on a class that is never PSEUDONYMIZED',
    () => {
      const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
      expect(src).toContain('executeRetention');                       // vacuity guard, FIRST
      // The guard inside the PSEUDONYMIZED branch:
      expect(src).toMatch(/else if \(item\.method === 'PSEUDONYMIZED'\)/);
      expect(src).toMatch(/if \(item\.dataClass === 'pilot_events'\)/);
      // ...and pilot_events is DELETED, so that inner condition can never hold there.
      const evts = RETENTION_CLASSES.find((c) => c.name === 'pilot_events');
      expect(evts?.method).toBe('DELETED');
      // No other statement mutates a pseudonymized class. If one is added, this fails.
      for (const cls of ['consents', 'pilot_enrollments', 'pilot_lifecycle_events',
        'human_decisions', 'pilot_monitor_events']) {
        expect(src).not.toMatch(new RegExp(`UPDATE ${cls}\\b`));
        expect(src).not.toMatch(new RegExp(`DELETE FROM ${cls}\\b`));
      }
    });

  it('and the completed-work record is written BEFORE any mutation, so it claims regardless', () => {
    const src = readFileSync(join(__dirname, 'retention.ts'), 'utf8');
    const claimAt = src.indexOf('INSERT INTO pilot_retention_log');
    const branchAt = src.indexOf("if (item.method === 'DELETED')");
    expect(claimAt).toBeGreaterThan(-1);
    expect(branchAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(branchAt);   // the claim precedes the work
  });
});
