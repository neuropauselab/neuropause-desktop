/**
 * ENG-08 — the authenticated governance read-back.
 *
 * NP-006 claimed "no route exposes read-back or export"; NP-007 corrected half of that
 * (participant export IS reachable via `GET /auth/export`). What remained true is that the
 * GOVERNANCE view — the state a verifier needs to answer "was this pilot governed?" — was
 * reachable only from tests.
 *
 * §8 READ-ONLY, STRUCTURALLY. This module performs SELECTs and nothing else. It cannot
 * enroll, decide, withdraw, stop, resume, terminate, change terms, change the cap or
 * authorize execution, and a test asserts the source contains no write verb.
 *
 * §9 AUTHORIZATION IS THE SAME PREDICATE AS EVERY OTHER CONSEQUENTIAL ROUTE. There is no
 * `if (email === …)` and no name comparison. It binds authenticated_subject + role + action +
 * target + environment through `resolveAuthority`, using the EXISTING `pilot.control.read`
 * action rather than inventing a new one — all three designated roles already carry it, and
 * the independent verifier carries ONLY it, which is exactly the caller this route is for.
 *
 * §10 DATA MINIMIZATION. What this returns is the governance SHAPE: states, counts, digests,
 * identities and refusal codes. It returns NO participant free text, NO operator-authored
 * reason strings, NO email, NO raw error detail, NO credential and NO connection string.
 * Those exclusions are asserted, not described.
 */
import { query } from '../db/pilotPool';
import { PilotError } from './types';
import { resolveAuthority, ownAuthority } from './authority';
import type { PilotServiceDeps } from './service';
import type { PilotMonitor } from './monitor';

export const READ_BACK_ACTION = 'pilot.control.read';

export interface GovernanceReadBack {
  readonly environment: {
    readonly established: boolean;
    readonly environmentClass: string;
    readonly environmentId: string;
  };
  readonly pilot: {
    readonly stopped: boolean;
    readonly maxParticipants: number | null;
    readonly capDecisionRecorded: boolean;
    readonly closed: boolean;
    readonly closedAt: string | null;
  };
  readonly terms: {
    readonly publishedCount: number;
    readonly versions: readonly string[];
    readonly digests: readonly string[];
  };
  readonly authority: {
    readonly roleBindings: number;
    readonly authenticatedDecisions: number;
    readonly unauthenticatedDecisions: number;
  };
  readonly participation: {
    readonly total: number;
    readonly active: number;
    readonly withdrawn: number;
    readonly terminated: number;
    readonly completed: number;
  };
  readonly lifecycle: { readonly kind: string; readonly count: number }[];
  readonly monitoring: {
    readonly events: number;
    readonly escalated: number;
    readonly byClass: { readonly alertClass: string; readonly count: number }[];
    readonly alertsDelivered: number;
    readonly alertsFailed: number;
  };
  readonly retention: {
    readonly processed: number;
    readonly activeHolds: number;
  };
}

export interface ReadBackDeps extends PilotServiceDeps {
  readonly environment?: () => Promise<{ environmentClass: string; environmentId: string } | null>;
  readonly monitor?: PilotMonitor;
}

const n = (rows: { n?: unknown }[]): number => Number(rows[0]?.n ?? 0);

export async function governanceReadBack(
  deps: ReadBackDeps,
  actorId: string,
): Promise<GovernanceReadBack> {
  // ENVIRONMENT FIRST, exactly as the authority evaluator orders it: an unestablished or
  // non-pilot environment must not be probed for who is bound.
  const env = deps.environment ? await deps.environment() : null;

  const decision = resolveAuthority(ownAuthority(deps), {
    actorId, subjectId: actorId, action: READ_BACK_ACTION,
  });
  if (decision !== 'ALLOW') {
    await deps.monitor?.record({
      alertClass: 'UNAUTHORIZED_ACCESS', outcome: 'DENIED',
      reasonCode: 'READ_BACK_NOT_AUTHORIZED', actorId, action: READ_BACK_ACTION,
    });
    throw new PilotError('not_authorized',
      'No designated authority permits reading the pilot governance state.');
  }

  const control = await query('SELECT stopped, max_participants FROM pilot_control WHERE id = true');
  const closure = await query('SELECT closed_at FROM pilot_closure WHERE id = true');
  const capDecision = await query('SELECT 1 FROM pilot_cap_decisions WHERE superseded_by IS NULL');
  // `digest` and `version` only. `content_reference` is deliberately omitted: it is a path or
  // URL into wherever terms live, which is infrastructure shape a verifier does not need.
  const terms = await query("SELECT version, digest FROM pilot_terms WHERE status = 'PUBLISHED' ORDER BY version");
  const bindings = await query('SELECT count(*)::int AS n FROM pilot_role_bindings WHERE revoked_at IS NULL');
  const decisionsAuth = await query('SELECT count(*)::int AS n FROM pilot_authority_decisions WHERE authenticated');
  const decisionsUnauth = await query('SELECT count(*)::int AS n FROM pilot_authority_decisions WHERE NOT authenticated');
  const states = await query('SELECT state, count(*)::int AS n FROM pilot_enrollments GROUP BY state');
  const lifecycle = await query('SELECT kind, count(*)::int AS n FROM pilot_lifecycle_events GROUP BY kind ORDER BY kind');
  const monEvents = await query('SELECT count(*)::int AS n FROM pilot_monitor_events');
  const monEsc = await query('SELECT count(*)::int AS n FROM pilot_monitor_events WHERE escalated');
  const monByClass = await query(
    'SELECT alert_class, count(*)::int AS n FROM pilot_monitor_events GROUP BY alert_class ORDER BY alert_class');
  const delivered = await query("SELECT count(*)::int AS n FROM pilot_alert_deliveries WHERE status = 'DELIVERED'");
  const failed = await query("SELECT count(*)::int AS n FROM pilot_alert_deliveries WHERE status = 'FAILED'");
  const retention = await query('SELECT count(*)::int AS n FROM pilot_retention_log');
  const holds = await query('SELECT count(*)::int AS n FROM pilot_retention_holds WHERE released_at IS NULL');

  const byState = new Map(states.rows.map((r) => [r.state as string, Number(r.n)]));
  const exited = ['WITHDRAWN', 'TERMINATED', 'COMPLETED'];
  const total = [...byState.values()].reduce((a, b) => a + b, 0);

  return {
    environment: {
      established: env !== null,
      environmentClass: env?.environmentClass ?? 'NOT_ESTABLISHED',
      environmentId: env?.environmentId ?? 'NOT_ESTABLISHED',
    },
    pilot: {
      // A MISSING control row reads as STOPPED, matching getControl's fail-closed default. A
      // read-back that reported `stopped: false` for an absent singleton would tell a verifier
      // the pilot was running when the code refuses everything.
      stopped: control.rows[0] ? (control.rows[0].stopped as boolean) : true,
      maxParticipants: (control.rows[0]?.max_participants as number | null) ?? null,
      capDecisionRecorded: (capDecision.rowCount ?? 0) > 0,
      closed: (closure.rowCount ?? 0) > 0,
      closedAt: closure.rows[0] ? new Date(closure.rows[0].closed_at).toISOString() : null,
    },
    terms: {
      publishedCount: terms.rows.length,
      versions: terms.rows.map((r) => r.version as string),
      digests: terms.rows.map((r) => r.digest as string),
    },
    authority: {
      roleBindings: n(bindings.rows),
      authenticatedDecisions: n(decisionsAuth.rows),
      unauthenticatedDecisions: n(decisionsUnauth.rows),
    },
    participation: {
      total,
      active: total - exited.reduce((a, s) => a + (byState.get(s) ?? 0), 0),
      withdrawn: byState.get('WITHDRAWN') ?? 0,
      terminated: byState.get('TERMINATED') ?? 0,
      completed: byState.get('COMPLETED') ?? 0,
    },
    lifecycle: lifecycle.rows.map((r) => ({ kind: r.kind as string, count: Number(r.n) })),
    monitoring: {
      events: n(monEvents.rows),
      escalated: n(monEsc.rows),
      byClass: monByClass.rows.map((r) => ({ alertClass: r.alert_class as string, count: Number(r.n) })),
      alertsDelivered: n(delivered.rows),
      alertsFailed: n(failed.rows),
    },
    retention: { processed: n(retention.rows), activeHolds: n(holds.rows) },
  };
}
