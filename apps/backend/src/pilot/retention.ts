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
import { query, withTransaction } from '../db/pilotPool';

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
 *    someone might ask. They are PSEUDONYMIZED under D13-D (P1): the direct subject identifier
 *    is REPLACED WITH A STABLE PSEUDONYM and the authorized longitudinal association is
 *    preserved. The subject link is NOT severed - that was P2, an earlier implementation
 *    reading, and the human decision selected the opposite. The result is pseudonymized and
 *    must never be described as anonymization.
 * 2. NOTHING HERE TOUCHES A TABLE OUTSIDE THE PILOT. `users`, auth, billing and store rows are
 *    absent by construction, not by a filter someone could widen.
 */
/*
 * D13-C — THE HUMAN DECISION, NOT AN IMPLEMENTATION HYPOTHESIS.
 *
 * Every method below was supplied by the D13 completion decision. The previous values were
 * authored by the implementer in NP-008 and NP-018 measured that they had never been put to a
 * decision-maker. TWO OF THE SIX ARE NOW INVERTED relative to that hypothesis:
 *   pilot_events          DELETED       -> PSEUDONYMIZED
 *   pilot_monitor_events  PSEUDONYMIZED -> DELETED
 * The `rationale` strings are the decision's stated purpose, not engineering justification.
 */
export const RETENTION_CLASSES: readonly RetentionDataClass[] = [
  { name: 'pilot_events', method: 'PSEUDONYMIZED',
    rationale: 'D13-C: participant activity is retained under a stable pseudonym, not destroyed' },
  { name: 'consents', method: 'PSEUDONYMIZED',
    rationale: 'D13-C: consent evidence survives; the direct subject identifier is replaced' },
  { name: 'pilot_enrollments', method: 'PSEUDONYMIZED',
    rationale: 'D13-C: lifecycle shape is evidence; the participant identifier is replaced' },
  { name: 'pilot_lifecycle_events', method: 'PSEUDONYMIZED',
    rationale: 'D13-C: the ledger proving a withdrawal was honoured outlives the participant record' },
  { name: 'human_decisions', method: 'PSEUDONYMIZED',
    rationale: 'D13-C: who decided what, and on what basis, is governance evidence' },
  { name: 'pilot_monitor_events', method: 'DELETED',
    rationale: 'D13-C: monitoring-event data is removed once its operational purpose has expired' },
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

  /*
   * A PSEUDONYM IS NOT A PARTICIPANT. Without the exclusion below, retention is not a fixpoint:
   * D13-C pseudonymizes `pilot_enrollments`, so after one run that table's `user_id` holds the
   * PSEUDONYM, the next run enumerates it as a brand-new subject with no ledger history, and
   * pseudonymizes the pseudonym. Measured before this guard existed: a second `executeRetention`
   * re-offered all six classes as ELIGIBLE under a fresh random subject id.
   *
   * The consequences were not cosmetic. It produces an UNBOUNDED CHAIN P(P(P(X))), minting a new
   * `users` row each run, and it destroys the one property D13-D actually requires - that the
   * pseudonym be STABLE, so the authorized longitudinal association survives.
   *
   * This is the read-then-write shape again, one level up: the plan reads the subject list from a
   * table the execution is about to rewrite.
   */
  const subjects = await query(
    `SELECT DISTINCT e.user_id FROM pilot_enrollments e
     WHERE NOT EXISTS (SELECT 1 FROM pilot_subject_pseudonyms p
                       WHERE p.pseudonym_user_id = e.user_id)`,
  );
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
 * ALL SIX CLASSES ARE NOW EXECUTABLE, and the reason is a schema addition, not a relaxation.
 * NP-017 measured four classes BLOCKED because their subject columns are NOT NULL FKs to
 * `users`, so a P2 "sever the link by nulling" could not be carried out in place. D13-D selected
 * P1 instead - REPLACE the identifier with a stable pseudonym - and a replacement needs a real
 * `users` row to point at, which `0024_pilot_subject_pseudonyms.sql` supplies. NOT ONE
 * CONSTRAINT WAS DROPPED OR WEAKENED to reach this: every NOT NULL and every FK named in
 * NP-017 is still enforced, and the UPDATE satisfies them rather than evading them.
 */
type ApplyOutcome = 'VERIFIED' | 'NOT_EXECUTABLE';

/**
 * The DIRECT SUBJECT IDENTIFIER columns, per class, measured from `information_schema` against a
 * migrated database rather than recalled. These are the columns D13-D speaks about: the places a
 * participant's own `users.id` appears.
 *
 * `pilot_lifecycle_events.actor_user_id` and `human_decisions.actor_id` are included because when
 * the participant is the actor - a self-withdrawal, a self-recorded decision - that column holds
 * the participant's direct identifier just as plainly as a subject column does. Rows whose actor
 * is somebody else do not match the predicate and are left alone.
 *
 * This map is also the definition of EXECUTABLE: a class with no entry here cannot be carried
 * out, and `retentionContract.test.ts` fails if RETENTION_CLASSES and this map ever disagree.
 *
 * A misspelled column here cannot produce a silent false completion: Postgres raises
 * `column "..." does not exist`, the transaction rolls back, and nothing is claimed. That is
 * deliberate - it is the NP-016 vacuous-verification path closed structurally rather than by
 * a check that would itself need proving.
 */
const SUBJECT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  pilot_events: ['user_id'],
  consents: ['user_id'],
  pilot_enrollments: ['user_id'],
  pilot_lifecycle_events: ['actor_user_id', 'subject_user_id'],
  human_decisions: ['actor_id'],
  pilot_monitor_events: ['actor_id', 'subject_user_id'],
};

/** The classes whose declared method this implementation can carry out and verify today. */
export const EXECUTABLE_CLASSES: readonly string[] = Object.keys(SUBJECT_COLUMNS);

/** `(col = $1 OR col2 = $1)` - the predicate that finds every row naming one subject. */
const subjectPredicate = (cols: readonly string[]): string =>
  cols.map((c) => `${c} = $1`).join(' OR ');

async function countMatching(
  client: PoolClient, table: string, cols: readonly string[], id: string,
): Promise<number> {
  const r = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${subjectPredicate(cols)}`, [id]);
  return r.rows[0].n;
}

/**
 * D13-D, the pseudonym itself. ONE stable pseudonym per participant, minted once and reused by
 * every class thereafter - which is what "preserving the authorized longitudinal association"
 * means in practice: after retention runs, a pilot_event and a consent that belonged to the same
 * participant still point at the same row, so the record remains internally coherent.
 *
 * THE PSEUDONYM IS RANDOM, NOT DERIVED. NP-018 measured that the pre-existing
 * `deleted_${users.id}@...` form leaves the original id recoverable from the address alone, so
 * nothing about the subject - not the id, not the email, not a hash of either - is an input here.
 * `gen_random_uuid()` is the only source. No secret is involved, so there is no mapping secret to
 * protect or to leak; the mapping's confidentiality rests entirely on access to
 * `pilot_subject_pseudonyms`.
 *
 * AND THAT TABLE IS WHY THIS IS PSEUDONYMIZATION AND NOT ANONYMIZATION. A re-identification path
 * exists by design - D13-D requires the authorized association to survive. D13 forbids describing
 * the result as anonymization, and the mapping table is the measured reason that prohibition is
 * correct rather than merely cautious.
 */
async function pseudonymFor(client: PoolClient, subjectUserId: string): Promise<string> {
  const found = await client.query<{ pseudonym_user_id: string }>(
    'SELECT pseudonym_user_id FROM pilot_subject_pseudonyms WHERE subject_user_id = $1',
    [subjectUserId],
  );
  if (found.rows[0]) return found.rows[0].pseudonym_user_id;

  // `.invalid` is reserved by RFC 2606 and cannot resolve; the local part is a fresh random
  // uuid, unrelated to both the subject and the pseudonym id.
  const minted = await client.query<{ id: string }>(
    `INSERT INTO users (email)
     VALUES ('pseudonym-' || gen_random_uuid()::text || '@pseudonymous.invalid')
     RETURNING id`,
  );
  const pseudonymUserId = minted.rows[0].id;

  const claimed = await client.query<{ pseudonym_user_id: string }>(
    `INSERT INTO pilot_subject_pseudonyms (subject_user_id, pseudonym_user_id)
     VALUES ($1, $2) ON CONFLICT (subject_user_id) DO NOTHING
     RETURNING pseudonym_user_id`,
    [subjectUserId, pseudonymUserId],
  );
  if (claimed.rows[0]) return claimed.rows[0].pseudonym_user_id;

  // A concurrent run minted first. Drop the row we just created - it is referenced by nothing -
  // and adopt the winner, so the pseudonym stays ONE per subject however many runs race.
  await client.query('DELETE FROM users WHERE id = $1', [pseudonymUserId]);
  const winner = await client.query<{ pseudonym_user_id: string }>(
    'SELECT pseudonym_user_id FROM pilot_subject_pseudonyms WHERE subject_user_id = $1',
    [subjectUserId],
  );
  if (!winner.rows[0]) throw new Error('pseudonym allocation lost a race with no winner');
  return winner.rows[0].pseudonym_user_id;
}

async function applyAndVerify(
  client: PoolClient,
  item: RetentionPlanItem,
): Promise<ApplyOutcome> {
  // NP-017, SECOND CORRECTION - found by the fan-out re-measuring this seam's OWN repair.
  //
  // Every class here is SUBJECT-SCOPED: it matches on a column equal to $1. With a NULL subject
  // those predicates match NOTHING - and so does the verification that follows them. A mutation
  // `WHERE user_id = NULL` changes no rows while rows survive, and `count(*) WHERE user_id = NULL`
  // then returns 0, so the check reports success VACUOUSLY and a completion record is written for
  // work that did not happen.
  //
  // That is the exact defect this seam repaired, reintroduced one case down inside the repair
  // itself: a check that looks right and measures the wrong thing. planRetention emits a NULL
  // subject whenever there are no enrolments at all (`subjectIds = [null]`), so the path is
  // reachable, not theoretical.
  //
  // A subject-scoped operation with no subject is not "done", it is INAPPLICABLE. It is refused,
  // and therefore never claimed.
  if (item.subjectUserId === null) return 'NOT_EXECUTABLE';

  const cols = SUBJECT_COLUMNS[item.dataClass];
  if (!cols) return 'NOT_EXECUTABLE';
  const subjectId = item.subjectUserId;

  // Counted BEFORE the mutation, because the post-state alone cannot tell "the rows moved" from
  // "there were never any rows". Both are acceptable end states, but only the first is work, and
  // the difference is exactly what NP-016 found the old implementation unable to see.
  const before = await countMatching(client, item.dataClass, cols, subjectId);

  if (item.method === 'DELETED') {
    await client.query(
      `DELETE FROM ${item.dataClass} WHERE ${subjectPredicate(cols)}`, [subjectId]);
    const remaining = await countMatching(client, item.dataClass, cols, subjectId);
    return remaining === 0 ? 'VERIFIED' : 'NOT_EXECUTABLE';
  }

  if (item.method === 'PSEUDONYMIZED') {
    // Nothing of this class names the subject, so the end state D13-D requires already holds and
    // no pseudonym is minted. This is a MEASURED zero, not an assumed one: `before` was read from
    // the same predicate the mutation would have used.
    if (before === 0) return 'VERIFIED';

    const pseudonymUserId = await pseudonymFor(client, subjectId);
    for (const col of cols) {
      await client.query(
        `UPDATE ${item.dataClass} SET ${col} = $2 WHERE ${col} = $1`,
        [subjectId, pseudonymUserId],
      );
    }

    // TWO conditions, and the second is the one that makes the claim falsifiable. "No row names
    // the subject" is satisfied just as well by deleting every row, so on its own it cannot tell
    // P1 from destruction. Requiring the rows to REAPPEAR under the pseudonym is what proves the
    // governance record survived the operation - which is the entire point of D13-C choosing
    // PSEUDONYMIZE over DELETE for these five classes.
    const remaining = await countMatching(client, item.dataClass, cols, subjectId);
    const carried = await countMatching(client, item.dataClass, cols, pseudonymUserId);
    return remaining === 0 && carried >= before ? 'VERIFIED' : 'NOT_EXECUTABLE';
  }

  return 'NOT_EXECUTABLE';
}

/**
 * NP-019 R2. `withTransaction` COMMITS on a normal return and ROLLS BACK only on a throw
 * (db/pool.ts:27-40). Retention's transaction body reported "not applied" by RETURNING FALSE —
 * and one of those returns is reached AFTER a mutation may already have run, so the mutation
 * committed while the operation reported failure. Measured against a disposable instance: a
 * callback that mutates and returns false leaves the row MUTATED when read from a SEPARATE
 * connection.
 *
 * `withTransaction` is NOT changed. Other callers may legitimately return a falsy value and
 * expect a commit, and NP-019 §13 forbids changing it globally for retention's benefit.
 * Retention gets its own contract instead: it signals "not applied" by THROWING this sentinel,
 * which rolls the transaction back, and the loop converts it back to a false at the boundary so
 * the remaining items still run.
 *
 *   SUCCESS -> COMMIT   ·   NOT APPLIED -> ROLLBACK   ·   REAL ERROR -> ROLLBACK and propagate
 */
class RetentionNotApplied extends Error {
  constructor(readonly outcome: string) {
    super(`retention item not applied: ${outcome}`);
    this.name = 'RetentionNotApplied';
  }
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
      if (held.rowCount) throw new RetentionNotApplied('ON_HOLD');

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
      if (outcome !== 'VERIFIED') throw new RetentionNotApplied(outcome);

      const claim = await client.query(
        `INSERT INTO pilot_retention_log (data_class, subject_user_id, method, closure_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (data_class, subject_user_id, closure_at) DO NOTHING
         RETURNING id`,
        [item.dataClass, item.subjectUserId, item.method, plan.closedAt],
      );
      // A conflict means a concurrent run verified the same work first. The work is done either
      // way; this run simply did not author the record.
      if (!claim.rowCount) throw new RetentionNotApplied('ALREADY_CLAIMED');
      return true;
    }).catch((e: unknown) => {
      // Only the sentinel becomes a false. A real database error still propagates: a
      // failure must not be silently reported as "this item was skipped".
      if (e instanceof RetentionNotApplied) return false;
      throw e;
    });
    if (ok) applied.push(item);
  }
  return applied;
}
