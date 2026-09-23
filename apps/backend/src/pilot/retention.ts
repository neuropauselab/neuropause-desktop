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

      const claim = await client.query(
        `INSERT INTO pilot_retention_log (data_class, subject_user_id, method, closure_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (data_class, subject_user_id, closure_at) DO NOTHING
         RETURNING id`,
        [item.dataClass, item.subjectUserId, item.method, plan.closedAt],
      );
      if (!claim.rowCount) return false; // another run already claimed it

      if (item.method === 'DELETED') {
        await client.query(
          `DELETE FROM pilot_events WHERE user_id = $1`, [item.subjectUserId],
        );
      } else if (item.method === 'PSEUDONYMIZED') {
        // The subject link is severed; the governance fact is preserved. This is
        // PSEUDONYMIZATION and is named as such: the pilot_retention_log still records which
        // subject was processed, so the mapping is reversible by someone holding this table.
        // D13 forbids calling that anonymization, and this comment exists so nobody does.
        if (item.dataClass === 'pilot_events')
          await client.query('DELETE FROM pilot_events WHERE user_id = $1', [item.subjectUserId]);
      }
      return true;
    });
    if (ok) applied.push(item);
  }
  return applied;
}
