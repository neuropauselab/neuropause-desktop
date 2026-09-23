/**
 * ENG-06 — pilot monitoring.
 *
 * §31 IS THE WHOLE DESIGN CONSTRAINT: monitoring must not be `log("something bad happened")`
 * while the operation proceeds. The chain is DETECT -> CLASSIFY -> BLOCK -> RECORD -> ESCALATE.
 *
 * SO THE HONEST DESCRIPTION OF WHAT THIS MODULE ADDS IS "RECORD AND ESCALATE", NOT "BLOCK".
 * The blocking already exists and is not moved here: the authority predicate denies before any
 * repository read, the compare-and-set refuses a terminal revival, the stop predicate refuses
 * a post-stop write, the cap transaction refuses an over-admission, and the environment
 * assertion refuses startup. Re-implementing any of those as a monitor check would create a
 * SECOND enforcement path, which this programme treats as a defect in itself - and a monitor
 * that could allow would be a monitor that grants authority (§32).
 *
 * What was genuinely missing is that those refusals left no durable trace. An audit could not
 * see that the system had refused anything. The ledger is the artifact, not the log: the
 * programme's standing law is that the log is diagnostic and the evidence store is the record.
 *
 * WHAT THIS DOES NOT ESTABLISH: that every real-world incident is detectable. This detects the
 * conditions D16/D17 enumerate, at the points where the code already refuses them.
 */
import { query } from '../db/pool';

export type AlertClass =
  | 'UNAUTHORIZED_ACCESS'
  | 'UNAUTHORIZED_DECISION'
  | 'UNAUTHORIZED_AUTHORITY'
  | 'CAP_BREACH'
  | 'TERMS_INTEGRITY_FAILURE'
  | 'CONSENT_INTEGRITY_FAILURE'
  | 'TERMINAL_STATE_REVIVAL'
  | 'POST_STOP_ADVANCEMENT'
  | 'PRODUCTION_PATH_ATTEMPT'
  | 'PRODUCTION_CREDENTIAL_ATTEMPT'
  | 'DATA_INTEGRITY_FAILURE'
  | 'EVIDENCE_INTEGRITY_FAILURE'
  | 'SECURITY_INCIDENT';

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type Outcome = 'BLOCKED' | 'DENIED' | 'RECORDED';

/**
 * THE SEVERITY OF EACH CLASS IS A TABLE, NOT A PARAMETER.
 *
 * A caller that chose its own severity could downgrade a production-path attempt to INFO, and
 * the mutation tests for this module do exactly that to prove the table is load-bearing.
 * Every class that D17 names a mandatory-stop condition is CRITICAL here; nothing in this file
 * can lower one.
 */
export const ALERT_SEVERITY: Readonly<Record<AlertClass, Severity>> = {
  UNAUTHORIZED_ACCESS: 'CRITICAL',
  UNAUTHORIZED_DECISION: 'CRITICAL',
  UNAUTHORIZED_AUTHORITY: 'CRITICAL',
  CAP_BREACH: 'CRITICAL',
  TERMS_INTEGRITY_FAILURE: 'CRITICAL',
  CONSENT_INTEGRITY_FAILURE: 'CRITICAL',
  TERMINAL_STATE_REVIVAL: 'CRITICAL',
  POST_STOP_ADVANCEMENT: 'CRITICAL',
  PRODUCTION_PATH_ATTEMPT: 'CRITICAL',
  PRODUCTION_CREDENTIAL_ATTEMPT: 'CRITICAL',
  DATA_INTEGRITY_FAILURE: 'CRITICAL',
  EVIDENCE_INTEGRITY_FAILURE: 'CRITICAL',
  SECURITY_INCIDENT: 'CRITICAL',
};

/** Every CRITICAL escalates. Escalation is derived, never passed in, for the same reason. */
export function escalates(severity: Severity): boolean {
  return severity === 'CRITICAL';
}

export interface MonitorEvent {
  readonly alertClass: AlertClass;
  readonly outcome: Outcome;
  readonly reasonCode: string;
  readonly actorId?: string | null;
  readonly subjectUserId?: string | null;
  readonly action?: string | null;
  readonly detail?: Record<string, unknown>;
}

export interface RecordedMonitorEvent extends MonitorEvent {
  readonly id: string;
  readonly severity: Severity;
  readonly escalated: boolean;
  readonly createdAt: string;
}

export interface PilotMonitor {
  record(event: MonitorEvent): Promise<RecordedMonitorEvent | null>;
}

/**
 * `detail` is operator-supplied structured context. It must never carry participant free text,
 * a credential, or a connection string, so it is filtered to a small allow-list of scalar
 * shapes rather than trusted. NP-005 found participant free text reaching a log through a
 * Postgres error's `detail` field; this is the same lesson applied to a field named `detail`
 * on purpose.
 */
function safeDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = v.length > 200 ? `${v.slice(0, 200)}…[truncated]` : v;
    // objects, arrays, functions and symbols are dropped: an unbounded shape here is how
    // arbitrary content reaches durable storage.
  }
  return out;
}

/**
 * THE PILOT MODULE DOES NOT LOG, AND THIS MODULE DOES NOT BREAK THAT.
 *
 * `freeText.privacy.test.ts` asserts against the SOURCE of every file in this directory that
 * none imports a logging module. That invariant exists because NP-005 measured participant free text
 * reaching a log line through a Postgres error's `detail` field - and an insert failure here
 * would carry exactly such an error, with the operator-supplied `detail` column inlined into
 * it. Emitting that error to the application log in the catch below would have re-opened the W1
 * defect class inside the very module built to observe it.
 *
 * (The source detector is a regex over file text and cannot tell code from prose, so this
 * comment deliberately avoids spelling the call it is describing.)
 *
 * So escalation is the LEDGER ROW, not a log line: `escalated = true` on a CRITICAL event is
 * the durable artifact, which matches the programme's standing rule that the log is diagnostic
 * and the evidence store is the record. A notifier can read the ledger; it does not need this
 * module to shout.
 *
 * Write failures are counted here rather than logged, so a surface OUTSIDE this directory can
 * report them without this directory acquiring a logging path. A non-zero count means the
 * ledger is incomplete and is itself an EVIDENCE_INTEGRITY_FAILURE condition.
 */
let writeFailures = 0;
export function monitorWriteFailureCount(): number {
  return writeFailures;
}
/** Test-only reset, so one suite's failures cannot leak into another's assertion. */
export function resetMonitorWriteFailureCount(): void {
  writeFailures = 0;
}

export const sqlPilotMonitor: PilotMonitor = {
  async record(event) {
    const severity = ALERT_SEVERITY[event.alertClass];
    const escalated = escalates(severity);
    try {
      const { rows } = await query(
        `INSERT INTO pilot_monitor_events
           (alert_class, severity, outcome, actor_id, subject_user_id, action, reason_code, detail, escalated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          event.alertClass, severity, event.outcome, event.actorId ?? null,
          event.subjectUserId ?? null, event.action ?? null, event.reasonCode,
          safeDetail(event.detail), escalated,
        ],
      );
      const r = rows[0];
      return {
        ...event, id: r.id, severity, escalated, createdAt: new Date(r.created_at).toISOString(),
      };
    } catch {
      /*
       * A MONITOR THAT THROWS WOULD BLOCK THE REFUSAL IT IS RECORDING.
       *
       * Every call site is already on a deny path. If this insert failed and propagated, a
       * monitoring outage would turn a clean DENY into a 500 - and the programme's law is that
       * an evidence emitter must never alter the action it records.
       *
       * The cost is real and is stated rather than hidden: a caller CANNOT conclude from this
       * resolving that a row was written. Anything asserting an event was recorded must read
       * the ledger back, which is what the tests do.
       *
       * The error is COUNTED, not logged - see the note above on why logging it here would
       * reintroduce the exact leak this module is meant to observe.
       */
      writeFailures += 1;
      return null;
    }
  },
};

/** An in-memory monitor for the default suite. Same severity table, same escalation rule. */
export function createMemoryPilotMonitor(): PilotMonitor & { events: RecordedMonitorEvent[] } {
  const events: RecordedMonitorEvent[] = [];
  return {
    events,
    async record(event) {
      const severity = ALERT_SEVERITY[event.alertClass];
      const rec: RecordedMonitorEvent = {
        ...event,
        detail: safeDetail(event.detail),
        id: `mem-${events.length + 1}`,
        severity,
        escalated: escalates(severity),
        createdAt: new Date().toISOString(),
      };
      events.push(rec);
      return rec;
    },
  };
}
