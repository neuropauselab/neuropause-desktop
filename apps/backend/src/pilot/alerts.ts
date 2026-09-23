/**
 * ENG-07 — alert delivery.
 *
 * NP-008 closed ENG-06 as RECORD and ESCALATE and said so plainly: `escalated = true` was a
 * durable flag a notifier could read, and no notifier existed. This is that notifier.
 *
 * §6 THE CHAIN, AND WHY DELIVERY IS LAST:
 *
 *     STOP CONDITION -> DETECTOR -> LEDGER EVENT -> ALERT DISPATCH -> PILOT-SAFE SINK
 *
 * Dispatch reads a PERSISTED monitor event by id. It cannot be invoked with an ad-hoc payload,
 * so there is no path by which an alert exists that the ledger does not. That ordering is the
 * whole safety property: a delivery outage can lose the notification and can never lose the
 * detection.
 *
 * §6 WHAT THIS DELIBERATELY DOES NOT DO: no email, no SMS, no production webhook, no provider
 * SDK, and NO PRODUCTION CREDENTIAL IS READ OR REQUIRED. The default sink is the database the
 * pilot already owns. A second sink writes a file under an explicitly configured pilot
 * directory. Anything that could reach a production notification surface is absent by
 * construction rather than disabled by a flag.
 *
 * §32/§7 G — AN ALERT CANNOT ACT. This module exports one function. It has no resume, no
 * enrollment, no termination, no decision, and no authority call. A sink receives a redacted
 * record and returns a delivery outcome; nothing it returns is consulted by any gate.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { query } from '../db/pilotPool';
import type { Severity } from './monitor';

export type AlertSinkName = 'ledger' | 'file';
export type DeliveryStatus = 'DELIVERED' | 'FAILED';

/**
 * The alert payload. §7 C requires exactly these fields, and §7 D forbids everything else.
 *
 * NOTE WHAT IS ABSENT: no `detail`, no reason text beyond a CODE, no actor email, no operator
 * name, no stop reason, no participant data, no error object. The monitor's own `detail`
 * column is already scalar-filtered, and it is STILL not forwarded here - an alert travels
 * further than a ledger row, so it carries less.
 */
export interface AlertPayload {
  readonly monitorEventId: string;
  readonly alertClass: string;
  readonly severity: Severity;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly escalated: boolean;
  readonly environmentClass: string;
  readonly environmentId: string;
  readonly occurredAt: string;
}

export interface AlertSink {
  readonly name: AlertSinkName;
  deliver(payload: AlertPayload): Promise<void>;
}

export type DispatchResult =
  | { readonly status: 'DELIVERED'; readonly sink: AlertSinkName }
  | { readonly status: 'FAILED'; readonly sink: AlertSinkName; readonly failureReason: string }
  | { readonly status: 'ALREADY_DISPATCHED' }
  | { readonly status: 'NOT_ESCALATED' }
  | { readonly status: 'EVENT_NOT_FOUND' };

/**
 * The default sink: the pilot's own database.
 *
 * It "delivers" by succeeding, and the delivery ROW is the artifact. That sounds circular
 * until you name the alternative: every other sink needs a credential, an endpoint, or a
 * network path, and each of those is a way for a pilot to reach production. A sink that needs
 * nothing cannot reach anything.
 */
export const ledgerAlertSink: AlertSink = {
  name: 'ledger',
  async deliver() {
    /* the delivery row written by dispatchAlert IS the delivery */
  },
};

/**
 * A file sink under an explicitly configured pilot directory.
 *
 * `PILOT_ALERT_DIR` must be set; there is no default path, because a default would put alert
 * files somewhere nobody chose. One file per monitor event id, so a replay overwrites rather
 * than accumulating.
 */
export function createFileAlertSink(dir: string): AlertSink {
  return {
    name: 'file',
    async deliver(payload) {
      const path = join(dir, `${payload.monitorEventId}.json`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
    },
  };
}

export function resolveAlertSink(env: NodeJS.ProcessEnv = process.env): AlertSink {
  const name = env.PILOT_ALERT_SINK?.trim();
  if (name === 'file') {
    const dir = env.PILOT_ALERT_DIR?.trim();
    // Fail to the LEDGER, never to silence. An unconfigured file sink that quietly dropped
    // alerts would be worse than no file sink at all.
    if (!dir) return ledgerAlertSink;
    return createFileAlertSink(dir);
  }
  return ledgerAlertSink;
}

interface DispatchDeps {
  readonly sink?: AlertSink;
  readonly environment: () => Promise<{ environmentClass: string; environmentId: string } | null>;
}

/**
 * Dispatch one alert for one PERSISTED monitor event.
 *
 * §7 A — only escalated events dispatch. A routine record produces `NOT_ESCALATED`.
 * §7 E — a sink failure records status FAILED and LEAVES THE MONITOR EVENT UNTOUCHED.
 * §7 F — a failure is returned as FAILED, never as success; the caller cannot read it as
 *        permission to continue, and nothing in the refusal path consults it either way.
 * §7 H — the delivery row is UNIQUE per monitor event, so a replay is inert.
 */
export async function dispatchAlert(
  monitorEventId: string,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const { rows } = await query(
    `SELECT id, alert_class, severity, outcome, reason_code, escalated, created_at
     FROM pilot_monitor_events WHERE id = $1`,
    [monitorEventId],
  );
  const event = rows[0];
  if (!event) return { status: 'EVENT_NOT_FOUND' };
  if (!event.escalated) return { status: 'NOT_ESCALATED' };

  const existing = await query('SELECT 1 FROM pilot_alert_deliveries WHERE monitor_event_id = $1', [monitorEventId]);
  if (existing.rowCount) return { status: 'ALREADY_DISPATCHED' };

  const env = await deps.environment();
  const sink = deps.sink ?? resolveAlertSink();

  const payload: AlertPayload = {
    monitorEventId: event.id,
    alertClass: event.alert_class,
    severity: event.severity,
    outcome: event.outcome,
    reasonCode: event.reason_code,
    escalated: event.escalated,
    // An alert from an unestablished environment still says so rather than omitting it: an
    // alert that cannot name where it came from is not actionable.
    environmentClass: env?.environmentClass ?? 'NOT_ESTABLISHED',
    environmentId: env?.environmentId ?? 'NOT_ESTABLISHED',
    occurredAt: new Date(event.created_at).toISOString(),
  };

  let status: DeliveryStatus = 'DELIVERED';
  let failureReason: string | null = null;
  try {
    await sink.deliver(payload);
  } catch {
    status = 'FAILED';
    // A CODE, not the provider's error. A sink failure can carry a message containing a URL, a
    // host, a credential fragment or a Postgres failing row - the same class NP-005 measured
    // reaching a log. The delivery row must be safe to read.
    failureReason = 'SINK_DELIVERY_FAILED';
  }

  try {
    await query(
      `INSERT INTO pilot_alert_deliveries (monitor_event_id, sink, status, failure_reason, payload)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (monitor_event_id) DO NOTHING`,
      [monitorEventId, sink.name, status, failureReason, payload],
    );
  } catch {
    // Recording the delivery failed. The monitor event is still there, which is the property
    // that matters (§7 E); this function reports FAILED rather than pretending otherwise.
    return { status: 'FAILED', sink: sink.name, failureReason: 'DELIVERY_RECORD_FAILED' };
  }

  return status === 'DELIVERED'
    ? { status: 'DELIVERED', sink: sink.name }
    : { status: 'FAILED', sink: sink.name, failureReason: failureReason! };
}
