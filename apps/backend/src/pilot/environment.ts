/**
 * ENV-01 / ENV-02 — the pilot's environment identity, and the proof that its database is not
 * the production one.
 *
 * NP-PILOT-FIRST-007 measured the starting position: zero `PILOT` occurrences in `config/env.ts`,
 * no feature flag, one `DATABASE_URL`, and `/pilot` mounted unconditionally beside every
 * production route. So D10's "PILOT-ISOLATED / NON-PRODUCTION" had no subject the code could
 * identify, and D17's "production-path contamination is a mandatory stop" could never fire.
 * The programme's own law names that shape: a rule whose subject cannot be identified at the
 * point of enforcement is prose.
 *
 * THE DESIGN POINT — WHY A CONFIG VARIABLE IS NOT ENOUGH.
 *
 * `PILOT_ENVIRONMENT_CLASS=PILOT` is a claim by whoever set the variable. If that were the
 * whole check, then pointing a pilot-configured process at the production database would pass,
 * because the production database is never consulted about what it is. So the check requires
 * TWO independent assertions that must agree:
 *
 *   1. the CONFIGURATION says which environment and which target it believes it is using;
 *   2. the DATABASE ITSELF carries a `pilot_environment_identity` row saying the same.
 *
 * The production database carries no such row - the table is created by a pilot migration and
 * ships empty - so it cannot answer, and the assertion fails closed. That is the difference
 * between a declared boundary and a demonstrated one.
 *
 * WHAT THIS DOES NOT ESTABLISH, stated so the evidence cannot be read as more than it is:
 * this proves the RUNTIME ASSERTION is correct. It does not prove organizational
 * infrastructure isolation - separate hosts, separate credentials, separate networks. That is
 * an infrastructure fact and needs infrastructure evidence.
 */
import { createHash } from 'node:crypto';
import { query } from '../db/pool';

export type EnvironmentClass = 'PILOT' | 'PRODUCTION' | 'DEVELOPMENT' | 'TEST';

export type EnvironmentRefusal =
  | 'ENVIRONMENT_CLASS_NOT_DECLARED'
  | 'ENVIRONMENT_CLASS_NOT_PILOT'
  | 'ENVIRONMENT_ID_NOT_DECLARED'
  | 'TARGET_ID_NOT_DECLARED'
  | 'TARGET_IDENTITY_ABSENT'
  | 'TARGET_IDENTITY_MISMATCH'
  | 'TARGET_CLASS_NOT_PILOT';

/**
 * The safe evidence record. §40: it carries identities and digests and NEVER a connection
 * string, password, token or key. Everything here is printable in an evidence package.
 */
export interface PilotEnvironmentRecord {
  readonly environmentClass: 'PILOT';
  readonly environmentId: string;
  readonly targetClass: 'PILOT';
  readonly targetId: string;
  readonly applicationVersion: string;
  readonly configurationDigest: string;
  readonly establishedAt: string;
}

export type EnvironmentResolution =
  | { readonly ok: true; readonly record: PilotEnvironmentRecord }
  | { readonly ok: false; readonly reason: EnvironmentRefusal };

/**
 * A digest over the environment-shaping configuration KEYS AND VALUES THAT ARE NOT SECRET.
 *
 * `DATABASE_URL` is deliberately reduced to whether it is present, never hashed: a digest of a
 * secret is still derived from the secret, and publishing it in an evidence package would
 * invite exactly the comparison it must not enable.
 */
export function configurationDigest(env: NodeJS.ProcessEnv): string {
  const shape = {
    PILOT_ENVIRONMENT_CLASS: env.PILOT_ENVIRONMENT_CLASS ?? null,
    PILOT_ENVIRONMENT_ID: env.PILOT_ENVIRONMENT_ID ?? null,
    PILOT_TARGET_ID: env.PILOT_TARGET_ID ?? null,
    NODE_ENV: env.NODE_ENV ?? null,
    DATABASE_URL_PRESENT: env.DATABASE_URL !== undefined,
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

/**
 * Resolve the pilot environment, consulting BOTH the configuration and the database.
 *
 * FAIL-CLOSED IS THE DEFAULT AT EVERY STEP. §38: a missing value never means "pilot". There is
 * deliberately no `?? 'PILOT'` anywhere in this function, and the tests assert that an
 * undeclared class refuses rather than defaulting.
 */
export async function resolvePilotEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  applicationVersion = env.npm_package_version ?? 'UNKNOWN',
): Promise<EnvironmentResolution> {
  const declaredClass = env.PILOT_ENVIRONMENT_CLASS?.trim();
  if (!declaredClass) return { ok: false, reason: 'ENVIRONMENT_CLASS_NOT_DECLARED' };
  if (declaredClass !== 'PILOT') return { ok: false, reason: 'ENVIRONMENT_CLASS_NOT_PILOT' };

  const environmentId = env.PILOT_ENVIRONMENT_ID?.trim();
  if (!environmentId) return { ok: false, reason: 'ENVIRONMENT_ID_NOT_DECLARED' };

  const targetId = env.PILOT_TARGET_ID?.trim();
  if (!targetId) return { ok: false, reason: 'TARGET_ID_NOT_DECLARED' };

  // THE SECOND, INDEPENDENT ASSERTION. The database answers for itself.
  const { rows } = await query(
    'SELECT environment_class, environment_id, target_id FROM pilot_environment_identity WHERE id = true',
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'TARGET_IDENTITY_ABSENT' };
  if (row.environment_class !== 'PILOT') return { ok: false, reason: 'TARGET_CLASS_NOT_PILOT' };
  if (row.environment_id !== environmentId || row.target_id !== targetId)
    return { ok: false, reason: 'TARGET_IDENTITY_MISMATCH' };

  return {
    ok: true,
    record: {
      environmentClass: 'PILOT',
      environmentId,
      targetClass: 'PILOT',
      targetId,
      applicationVersion,
      configurationDigest: configurationDigest(env),
      establishedAt: new Date().toISOString(),
    },
  };
}

/**
 * The boot assertion (§37). Returns the record, or throws with the refusal reason.
 *
 * Callers that mount pilot routes must treat a throw as STARTUP = DENY for the pilot surface.
 * It deliberately reports only the reason CODE: a refusal message that quoted the declared and
 * expected target ids would disclose infrastructure identity to whoever can read the logs.
 */
export class PilotEnvironmentError extends Error {
  constructor(public readonly reason: EnvironmentRefusal) {
    super(`pilot environment not established: ${reason}`);
    this.name = 'PilotEnvironmentError';
  }
}

export async function assertPilotEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PilotEnvironmentRecord> {
  const resolved = await resolvePilotEnvironment(env);
  if (!resolved.ok) throw new PilotEnvironmentError(resolved.reason);
  return resolved.record;
}
