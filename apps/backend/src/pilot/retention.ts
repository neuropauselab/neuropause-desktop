/**
 * ENG-05 — pilot data retention, per NP-PILOT-FIRST-HUMAN-001 D13.
 *
 * D13 sets 90 days AFTER PILOT CLOSURE, with pseudonymization or deletion by data class, and
 * states plainly that a reversible mapping must not be described as anonymization.
 *
 * THIS SHIPS PREPARED, NOT RUNNING (§21). The pilot has never executed and `pilot_closure` is
 * empty, so `planRetention` returns an empty plan and `executeRetention` writes nothing. There
 * is no scheduler, no cron, and no call site in the request path - wiring one would start a
 * clock over data that does not exist.
 *
 * THE CLOCK IS CLOSURE, NOT CREATION (§23). Measuring from row creation would delete a
 * participant's day-1 consent on day 91 of a pilot still running. Every class below is
 * measured from `pilot_closure.closed_at`, and a pilot that has not closed has no eligible
 * data at all.
 *
 * WHAT THIS DOES NOT ESTABLISH: that any legal retention requirement is satisfied. D22 keeps
 * LEGAL_STATUS separate from ENGINEERING_STATUS on purpose, and no period here was derived
 * from a statute - 90 days is a human decision recorded in D13, not a legal finding.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool';

export type RetentionMethod = 'PSEUDONYMIZED' | 'DELETED' | 'PRESERVED_UNDER_HOLD';
export type HoldClass = 'LEGAL' | 'INCIDENT' | 'AUDIT';

/** D13's retention period. A named constant so a mutation that changes it is visible. */
export const RETENTION_DAYS_AFTER_CLOSURE = 90;

export interface RetentionDataClass {
  readonly name: string;
  readonly method: RetentionMethod;
  readonly rationale: string;
}

/**
 * §22's classification. Two properties are deliberate and load-bearing:
 *
 * 1. THE EVIDENCE CLASSES ARE NEVER DELETED. Lifecycle events, human decisions, stop/resume
 *    history and the monitor ledger are the record that the pilot was governed. Deleting them
 *    at day 90 would destroy the proof that withdrawal was honoured, at exactly the moment
 *    someone might ask. They are pseudonymized - the subject link is severed, the governance
 *    fact survives.
 * 2. NOTHING HERE TOUCHES A TABLE OUTSIDE THE PILOT. `users`, auth, billing and store rows are
 *    absent by construction, not by a filter someone could widen.
 */
export const RETENTION_CLASSES: readonly RetentionDataClass[] = [
  { name: 'pilot_events', method: 'DELETED',
    rationale: 'participant activity, including free-text feedback; no governance value after closure' },
  { name: 'consents', method: 'PSEUDONYMIZED',
    rationale: 'the fact that consent was given and to which terms digest is the evidence; the subject link is not' },
  { name: 'pilot_enrollments', method: 'PSEUDONYMIZED',
    rationale: 'lifecycle shape is evidence the pilot was governed; the participant identity is not' },
  { name: 'pilot_lifecycle_events', method: 'PSEUDONYMIZED',
    rationale: 'the ledger that proves a withdrawal was honoured must outlive the participant record' },
  { name: 'human_decisions', method: 'PSEUDONYMIZED',
    rationale: 'who decided what, and on what basis, is governance evidence' },
  { name: 'pilot_monitor_events', method: 'PSEUDONYMIZED',
    rationale: 'the refusal ledger is evidence; an audit needs it after the pilot ends' },
];

export interface RetentionPlanItem {
  readonly dataClass: string;
  readonly method: RetentionMethod;
  readonly subjectUserId: string | null;
  readonly eligible: boolean;
  readonly reason: 'ELIGIBLE' | 'PILOT_NOT_CLOSED' | 'WITHIN_RETENTION' | 'ON_HOLD' | 'ALREADY_PROCESSED';
}

export interface RetentionPlan {
  readonly closedAt: string | null;
  readonly eligibleFrom: string | null;
  readonly items: readonly RetentionPlanItem[];
}

interface HoldRow { hold_class: HoldClass; subject_user_id: string | null }

/**
 * Compute what WOULD be processed. Read-only; safe to call at any time, including now.
 *
 * Separating plan from execution is what makes this auditable before it ever runs: an operator
 * can see the exact set, with the reason each row is in or out, without anything being
 * destroyed to find out.
 */
export async function planRetention(now: Date = new Date()): Promise<RetentionPlan> {
  const closure = await query('SELECT closed_at FROM pilot_closure WHERE id = true');
  if (!closure.rows[0]) {
    return {
      closedAt: null,
      eligibleFrom: null,
      items: RETENTION_CLASSES.map((c) => ({
        dataClass: c.name, method: c.method, subjectUserId: null,
        eligible: false, reason: 'PILOT_NOT_CLOSED' as const,
      })),
    };
  }

  const closedAt = new Date(closure.rows[0].closed_at);
  const eligibleFrom = new Date(closedAt.getTime() + RETENTION_DAYS_AFTER_CLOSURE * 86400_000);
  const withinRetention = now < eligibleFrom;

  const holds = await query<HoldRow>(
    'SELECT hold_class, subject_user_id FROM pilot_retention_holds WHERE released_at IS NULL',
  );
  const pilotWideHold = holds.rows.some((h) => h.subject_user_id === null);
  const heldSubjects = new Set(holds.rows.map((h) => h.subject_user_id).filter(Boolean) as string[]);

  const processed = await query(
    'SELECT data_class, subject_user_id FROM pilot_retention_log WHERE closure_at = $1',
    [closedAt.toISOString()],
  );
  const done = new Set(processed.rows.map((r) => `${r.data_class}::${r.subject_user_id ?? 'ALL'}`));

  const subjects = await query('SELECT DISTINCT user_id FROM pilot_enrollments');
  const subjectIds: (string | null)[] = subjects.rows.length
    ? subjects.rows.map((r) => r.user_id as string)
    : [null];

  const items: RetentionPlanItem[] = [];
  for (const c of RETENTION_CLASSES) {
    for (const subjectUserId of subjectIds) {
      const key = `${c.name}::${subjectUserId ?? 'ALL'}`;
      let reason: RetentionPlanItem['reason'] = 'ELIGIBLE';
      if (done.has(key)) reason = 'ALREADY_PROCESSED';
      else if (pilotWideHold || (subjectUserId && heldSubjects.has(subjectUserId))) reason = 'ON_HOLD';
      else if (withinRetention) reason = 'WITHIN_RETENTION';
      items.push({
        dataClass: c.name, method: c.method, subjectUserId,
        eligible: reason === 'ELIGIBLE', reason,
      });
    }
  }
  return { closedAt: closedAt.toISOString(), eligibleFrom: eligibleFrom.toISOString(), items };
}

/**
 * Execute the plan. IDEMPOTENT BY LEDGER, NOT BY FLAG.
 *
 * Every processed item is recorded in `pilot_retention_log` inside the SAME transaction as the
 * mutation, keyed `(data_class, subject_user_id, closure_at)`. A second run finds the record
 * and skips it. A flag on the source row could not do this for a DELETED class - the row is
 * gone, so nothing remains to carry the flag, and a naive re-run would look like fresh work.
 *
 * A HOLD IS CHECKED INSIDE THE TRANSACTION, not only in the plan. A hold placed between
 * planning and execution must still be honoured, and a plan is a read taken earlier - which is
 * exactly the read-then-write shape NP-007 was about.
 */
export interface RetentionInterleave {
  /**
   * Fired INSIDE the execution loop, before each item's transaction.
   *
   * This exists because the plan-level guards and the transaction-level guards are different
   * controls, and a test driven only through the plan cannot reach the second. Measured: with
   * no such seam, mutants that deleted the in-transaction hold check and the idempotence claim
   * BOTH survived a 30/30 green suite - the tests were asserting the plan, and the enforcement
   * is the transaction. That is the NP-007 lesson in a new place: a read taken earlier is not
   * the guard.
   */
  readonly beforeItem?: (item: RetentionPlanItem) => Promise<void>;
}


/**
 * What this implementation can actually EXECUTE against the current schema, and the verification
 * that proves each one happened.
 *
 * NP-017 §7/§8: the declared method is a POLICY statement; this function is what the DATABASE
 * permits. Where the two disagree the item is NOT claimed - a completion record for work the
 * schema forbids is precisely the defect under repair.
 *
 * WHY FOUR CLASSES ARE NOT EXECUTABLE, measured from the schema rather than assumed:
 *   consents.user_id           NOT NULL REFERENCES users(id)          - cannot be severed in place
 *   pilot_enrollments.user_id  NOT NULL UNIQUE REFERENCES users(id)   - same
 *   human_decisions.actor_id   NOT NULL REFERENCES users(id)          - same
 *   pilot_lifecycle_events     subject_user_id IS nullable, but CONSTRAINT pilot_lifecycle_scope
 *                              REQUIRES it NOT NULL for WITHDRAWAL/TERMINATION rows
 *
 * Severing those needs a design choice - a tombstone subject, relaxing NOT NULL, or deleting
 * rows and losing the governance fact D13 says to preserve. That is a HUMAN DECISION (§23), so
 * this seam refuses to guess. The classes are left UNEXECUTABLE and, crucially, UNCLAIMED, so
 * the ledger stops asserting work nobody performed.
 */
type ApplyOutcome = 'VERIFIED' | 'NOT_EXECUTABLE';

/** The classes whose declared method this implementation can carry out and verify today. */
export const EXECUTABLE_CLASSES: readonly string[] = ['pilot_events', 'pilot_monitor_events'];

async function applyAndVerify(
  client: PoolClient,
  item: RetentionPlanItem,
): Promise<ApplyOutcome> {
  // NP-017, SECOND CORRECTION - found by the fan-out re-measuring this seam's OWN repair.
  //
  // Both executable classes are SUBJECT-SCOPED: they match on `user_id = $1` /
  // `subject_user_id = $1`. With a NULL subject those predicates match NOTHING - and so does
  // the verification that follows them. `DELETE ... WHERE user_id = NULL` removes no rows while
  // rows survive, and `SELECT count(*) ... WHERE user_id = NULL` then returns 0, so the check
  // reports success VACUOUSLY and a completion record is written for work that did not happen.
  //
  // That is the exact defect this seam repaired, reintroduced one case down inside the repair
  // itself: a check that looks right and measures the wrong thing. planRetention emits a NULL
  // subject whenever there are no enrolments at all (`subjectIds = [null]`), so the path is
  // reachable, not theoretical.
  //
  // A subject-scoped operation with no subject is not "done", it is INAPPLICABLE. It is refused,
  // and therefore never claimed.
  if (item.subjectUserId === null) return 'NOT_EXECUTABLE';

  if (item.dataClass === 'pilot_events' && item.method === 'DELETED') {
    await client.query('DELETE FROM pilot_events WHERE user_id = $1', [item.subjectUserId]);
    const check = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pilot_events WHERE user_id = $1', [item.subjectUserId]);
    return check.rows[0].n === 0 ? 'VERIFIED' : 'NOT_EXECUTABLE';
  }

  if (item.dataClass === 'pilot_monitor_events' && item.method === 'PSEUDONYMIZED') {
    // Both subject columns here are nullable, so the link can genuinely be severed in place
    // while the refusal record - which is the governance evidence - survives intact.
    await client.query(
      `UPDATE pilot_monitor_events SET actor_id = NULL, subject_user_id = NULL
       WHERE actor_id = $1 OR subject_user_id = $1`, [item.subjectUserId]);
    const check = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pilot_monitor_events
       WHERE actor_id = $1 OR subject_user_id = $1`, [item.subjectUserId]);
    return check.rows[0].n === 0 ? 'VERIFIED' : 'NOT_EXECUTABLE';
  }

  return 'NOT_EXECUTABLE';
}

export async function executeRetention(
  now: Date = new Date(),
  interleave: RetentionInterleave = {},
): Promise<readonly RetentionPlanItem[]> {
  const plan = await planRetention(now);
  const applied: RetentionPlanItem[] = [];
  for (const item of plan.items) {
    if (!item.eligible) continue;
    if (interleave.beforeItem) await interleave.beforeItem(item);
    const ok = await withTransaction(async (client) => {
      const held = await client.query(
        `SELECT 1 FROM pilot_retention_holds
         WHERE released_at IS NULL AND (subject_user_id IS NULL OR subject_user_id = $1)`,
        [item.subjectUserId],
      );
      if (held.rowCount) return false;

      // NP-017 §11: MUTATION, then VERIFICATION, then the COMPLETION RECORD - in that order,
      // inside one transaction. NP-016 found the claim row was INSERTed FIRST, so five of six
      // classes recorded completed work with zero rows modified, and ON CONFLICT DO NOTHING made
      // the false completion durable: a later correct implementation would find the work already
      // claimed and skip it. The ordering below is the whole fix.
      //
      // There is no status column on pilot_retention_log, so the PRESENCE of a row IS the
      // completion claim. That is why nothing is written unless the mutation verified: a failed
      // or unexecutable item simply leaves no row, planRetention re-offers it on the next run,
      // and retry works without inventing a status this schema cannot express.
      const outcome = await applyAndVerify(client, item);
      if (outcome !== 'VERIFIED') return false;

      const claim = await client.query(
        `INSERT INTO pilot_retention_log (data_class, subject_user_id, method, closure_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (data_class, subject_user_id, closure_at) DO NOTHING
         RETURNING id`,
        [item.dataClass, item.subjectUserId, item.method, plan.closedAt],
      );
      // A conflict means a concurrent run verified the same work first. The work is done either
      // way; this run simply did not author the record.
      if (!claim.rowCount) return false;
      return true;
    });
    if (ok) applied.push(item);
  }
  return applied;
}
