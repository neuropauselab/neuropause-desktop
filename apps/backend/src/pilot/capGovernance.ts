/**
 * ENG-10 — the governed write path for the participant cap.
 *
 * NP-008 recorded the gap precisely: `max_participants` had ELEVEN references and every one
 * was a READ. Setting it required raw SQL, so the act that OPENS ENROLLMENT was the one event
 * the pilot's own audit trail could not see.
 *
 * §13 THE PATH, and every step is a refusal point:
 *
 *   AUTHENTICATED HUMAN -> AUTHORITY RESOLUTION -> ACTION=pilot.cap.set -> TARGET=FIRST_PILOT
 *   -> ENVIRONMENT=PILOT -> DECISION RECORD -> AUDIT EVENT -> CAP EFFECTIVE
 *
 * §15 NOT_SET IS NOT UNLIMITED, AND IS NOT 1. `max_participants` stays NULL until a decision
 * lands here, and NULL refuses every enrollment (`enrollment_boundary_undecided`). Nothing in
 * this file supplies a default, and a test asserts that no default exists - because a cap that
 * appears on its own is a boundary nobody approved.
 *
 * NO IDENTITY IS INVENTED. The caller is an authenticated subject id resolved by the request
 * pipeline. `pilot_role_bindings` is empty, so in production every call to this refuses with
 * ROLE_NOT_BOUND, exactly like every other consequential route.
 */
import { withTransaction } from '../db/pilotPool';
import { PilotError } from './types';
import { resolveAuthority, ownAuthority } from './authority';
import type { PilotServiceDeps } from './service';
import type { PilotMonitor } from './monitor';

export const SET_CAP_ACTION = 'pilot.cap.set';
export const FIRST_PILOT_TARGET = 'FIRST_PILOT';

export interface CapDecision {
  readonly id: string;
  readonly maxParticipants: number;
  readonly decidedBy: string;
  readonly instrument: string;
  readonly environmentId: string;
  readonly decidedAt: string;
}

export interface SetCapDeps extends PilotServiceDeps {
  readonly environment?: () => Promise<{ environmentClass: string; environmentId: string } | null>;
  readonly monitor?: PilotMonitor;
}

/**
 * Establish the participant cap under an authenticated, authorized human decision.
 *
 * §14 The refusals, in order, each with its own error code:
 *   unauthenticated / unbound / wrong role / wrong action  -> the authority predicate
 *   wrong target                                           -> cap_target_invalid
 *   environment not PILOT, or not established              -> cap_environment_invalid
 *   malformed value                                        -> cap_value_invalid
 *
 * §19 of NP-008's directive, applied: the authority check and the write are IN THE SAME
 * TRANSACTION, and the decision row is inserted beside the control update. A check followed by
 * an await followed by a write is the shape NP-007 was about, and it is not repeated here.
 */
export async function setPilotCap(
  deps: SetCapDeps,
  actorId: string,
  maxParticipants: number,
  reason: string,
): Promise<CapDecision> {
  // 1. VALUE. Checked before authority so a malformed request cannot probe the binding table,
  //    and checked strictly: §15 requires 0, negatives and non-integers to be refused, and the
  //    schema's CHECK (> 0) is the second line of the same defence.
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1)
    throw new PilotError('cap_value_invalid',
      'A participant cap must be a positive whole number. It is not defaulted, and 0 is not a cap.');

  // 2. ENVIRONMENT. Before the authority predicate, so a production-shaped caller learns
  //    nothing about who is bound.
  const env = deps.environment ? await deps.environment() : null;
  if (!env || env.environmentClass !== 'PILOT') {
    await deps.monitor?.record({
      alertClass: 'PRODUCTION_PATH_ATTEMPT', outcome: 'DENIED',
      reasonCode: 'CAP_ENVIRONMENT_INVALID', actorId, action: SET_CAP_ACTION,
    });
    throw new PilotError('cap_environment_invalid',
      'The pilot environment is not established, so no cap decision can be recorded.');
  }

  // 3. AUTHORITY. Production supplies no evaluator and binds nobody, so this is where every
  //    real call stops today.
  const decision = resolveAuthority(ownAuthority(deps), {
    actorId, subjectId: actorId, action: SET_CAP_ACTION, targetId: undefined,
  });
  if (decision !== 'ALLOW') {
    await deps.monitor?.record({
      alertClass: 'UNAUTHORIZED_AUTHORITY', outcome: 'DENIED',
      reasonCode: 'CAP_NOT_AUTHORIZED', actorId, action: SET_CAP_ACTION,
    });
    throw new PilotError('not_authorized',
      'No decision authority is designated for setting the participant cap.');
  }

  const instrument = deps.capInstrument ?? 'NOT_ESTABLISHED';

  return withTransaction(async (client) => {
    // Supersede any prior active decision, then record this one, then make it effective -
    // all three in one transaction, so a reader can never see a cap with no decision behind
    // it, nor two active decisions.
    await client.query('UPDATE pilot_cap_decisions SET superseded_by = NULL WHERE false'); // no-op anchor
    const inserted = await client.query(
      `INSERT INTO pilot_cap_decisions (decided_by, role, instrument, environment_id, max_participants, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [actorId, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', instrument, env.environmentId, maxParticipants, reason],
    );
    const row = inserted.rows[0];
    await client.query(
      'UPDATE pilot_cap_decisions SET superseded_by = $1 WHERE superseded_by IS NULL AND id <> $1',
      [row.id],
    );
    await client.query(
      'UPDATE pilot_control SET max_participants = $1, updated_at = now() WHERE id = true',
      [maxParticipants],
    );
    return {
      id: row.id,
      maxParticipants: row.max_participants,
      decidedBy: row.decided_by,
      instrument: row.instrument,
      environmentId: row.environment_id,
      decidedAt: new Date(row.decided_at).toISOString(),
    };
  });
}

/** The active cap decision, or null when the cap has never been set. */
export async function activeCapDecision(
  client: { query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
): Promise<CapDecision | null> {
  const { rows } = await client.query(
    'SELECT * FROM pilot_cap_decisions WHERE superseded_by IS NULL ORDER BY decided_at DESC LIMIT 1',
  );
  const r = rows[0];
  return r
    ? {
        id: r.id as string,
        maxParticipants: r.max_participants as number,
        decidedBy: r.decided_by as string,
        instrument: r.instrument as string,
        environmentId: r.environment_id as string,
        decidedAt: new Date(r.decided_at as string).toISOString(),
      }
    : null;
}
