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
import { query, pilotPool, identityOf, identityKey } from '../db/pilotPool';
import { pool as productPool } from '../db/pool';

export type EnvironmentClass = 'PILOT' | 'PRODUCTION' | 'DEVELOPMENT' | 'TEST';

export type EnvironmentRefusal =
  | 'ENVIRONMENT_CLASS_NOT_DECLARED'
  | 'ENVIRONMENT_CLASS_NOT_PILOT'
  | 'ENVIRONMENT_ID_NOT_DECLARED'
  | 'TARGET_ID_NOT_DECLARED'
  | 'TARGET_IDENTITY_ABSENT'
  | 'TARGET_IDENTITY_MISMATCH'
  | 'TARGET_CLASS_NOT_PILOT'
  // ENV-04, added NP-PILOT-FIRST-014.
  | 'PILOT_STORE_NOT_DECLARED'
  | 'PILOT_STORE_NOT_SEPARATED'
  // ENV04 work item 2: the ACTUAL connected database, not the declared string.
  | 'PILOT_STORE_SAME_DATABASE'
  | 'PILOT_STORE_UNREACHABLE';

/**
 * The safe evidence record. §40: it carries identities and digests and NEVER a connection
 * string, password, token or key. Everything here is printable in an evidence package.
 */
export interface PilotEnvironmentRecord {
  /**
   * The class the CONFIGURATION declared, and the class the DATABASE ROW asserts about itself,
   * each carried as MEASURED rather than as the literal 'PILOT'. NP-013 fixed this shape once
   * (ENG-13, a guard comparing a constant to itself) and NP-014 fixed it again at the type
   * level on AuthorityDecisionArtifact. This is the same shape at a third site: hard-coding
   * 'PILOT' here makes the evaluator's downstream `PRODUCTION_TARGET_DENIED` guard unreachable,
   * because the only real producer of this record could then never emit anything else.
   */
  readonly environmentClass: string;
  readonly environmentId: string;
  readonly targetClass: string;
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
    // ENV-04. PRESENCE and SEPARATION only - never either connection string, for the same
    // reason DATABASE_URL is reduced to a boolean: a digest of a secret is derived from it.
    PILOT_DATABASE_URL_PRESENT: env.PILOT_DATABASE_URL !== undefined,
    PILOT_STORE_SEPARATED:
      env.PILOT_DATABASE_URL !== undefined && env.PILOT_DATABASE_URL !== env.DATABASE_URL,
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

  /*
   * ENV-04 — D10 REQUIRES A **PILOT-DEDICATED** DATA STORE, AND THE CODE NOW REFUSES WITHOUT ONE.
   *
   * MEASURED at NP-PILOT-FIRST-014: the product database holds 52 tables, of which 16 are the
   * pilot's and 36 are the product's - `users`, `auth_sessions`, `auth_tokens`, `audit_log`,
   * `subscriptions`, `organizations`, `devices` and the rest. There is ONE `new Pool`, ONE
   * `DATABASE_URL`, no `PILOT_DATABASE_URL`, and no separate schema. So "PILOT-DEDICATED" was
   * not merely unproven, it was architecturally absent.
   *
   * THIS CODE CANNOT PROVISION A DATABASE. What it can do - and now does - is refuse to
   * recognise a pilot environment until a distinct store has been declared, so that
   * "the pilot store is the product store" becomes a REFUSED, NAMED condition rather than an
   * invisible default.
   *
   * §20 IS WHY THE COMPARISON EXISTS: `DATABASE_URL` must never silently mean either pilot or
   * production. Declaring `PILOT_DATABASE_URL` equal to `DATABASE_URL` is the exact shape of
   * that ambiguity, so it is refused as PILOT_STORE_NOT_SEPARATED rather than accepted as
   * technically-two-variables.
   *
   * The comparison is on the declared VALUES; it is not a proof that two distinct strings
   * reach two distinct servers. That stronger property is a deployment fact, and the evidence
   * package says so rather than implying this check establishes it.
   */
  const pilotStore = env.PILOT_DATABASE_URL?.trim();
  if (!pilotStore) return { ok: false, reason: 'PILOT_STORE_NOT_DECLARED' };
  if (pilotStore === env.DATABASE_URL?.trim())
    return { ok: false, reason: 'PILOT_STORE_NOT_SEPARATED' };

  /*
   * THE ACTUAL CONNECTED DATABASE, NOT THE DECLARED STRING.
   *
   * The comparison above refuses two IDENTICAL strings. It cannot refuse two DIFFERENT strings
   * that resolve to the same database — `localhost` vs `127.0.0.1`, a DNS alias, a pgbouncer
   * route, a URL differing only in credentials. Until this seam, "isolation" was exactly that
   * weak comparison, and NP-034 measured the consequence: the gate passed while every pilot
   * write went through the product pool.
   *
   * So both pools are asked what they are actually connected to, and the answer comes from the
   * SERVER (`current_database()`, `inet_server_addr()`, `inet_server_port()`), not from the
   * configuration that was already in doubt.
   *
   * UNREACHABLE IS A REFUSAL, NOT A PASS. A pilot store that cannot be contacted has not been
   * shown to be separate, and treating an error as separation would turn an outage into a
   * green isolation check.
   */
  try {
    const [pilotId, productId] = await Promise.all([
      identityOf(pilotPool()),
      identityOf(productPool),
    ]);
    if (identityKey(pilotId) === identityKey(productId))
      return { ok: false, reason: 'PILOT_STORE_SAME_DATABASE' };
  } catch {
    return { ok: false, reason: 'PILOT_STORE_UNREACHABLE' };
  }

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
      environmentClass: declaredClass,      // MEASURED from configuration, not assumed
      environmentId,
      targetClass: row.environment_class,   // the DATABASE's own assertion, carried through
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
