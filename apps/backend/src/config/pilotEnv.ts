import { z } from 'zod';

/* ==========================================================================================
 * ENV04-A — THE PILOT'S CONFIGURATION, WITH EXACTLY ONE READER.
 *
 * THE DEFECT THIS MODULE EXISTS TO REMOVE, measured at NP-PILOT-FIRST-005-R2:
 * `resolvePilotEnvironment(env)` took the DECLARED pilot store from its `env` ARGUMENT while
 * `pilotPool()` took the CONNECTED pilot store from `process.env` — two sources for one fact.
 * So the function could refuse, or accept, based on a database it was never asked about, and
 * `declared !== configured` was a reachable state that nothing could observe.
 *
 * The product side never had this problem: `db/pool.ts` builds its pool from `loadEnv()`, a
 * validated object. The pilot side had no equivalent — measured: ZERO PILOT_* entries in
 * `config/env.ts`, and `pilotPool.ts` read `process.env.PILOT_DATABASE_URL` raw at call time.
 * This module is the missing half.
 *
 * WHY IT IS SEPARATE FROM `config/env.ts` RATHER THAN MERGED INTO IT.
 * `loadEnv()` validates at import and THROWS on a malformed configuration — correct, because
 * the product cannot run without DATABASE_URL. The pilot configuration is OPTIONAL: a
 * product-only boot declares none of it and must still start. Merging would force every
 * product boot to satisfy pilot configuration, or would force the pilot fields to be so
 * loosely typed that validating them proved nothing. Keeping them separate lets the pilot
 * config be strictly validated WHEN PRESENT and honestly absent when not.
 *
 * NO FALLBACK, HERE OR ANYWHERE BELOW IT. There is deliberately no
 * `PILOT_DATABASE_URL ?? DATABASE_URL`. An absent pilot URL stays absent and every pilot query
 * then throws, rather than quietly running against the product database — the exact defect
 * ENV04 exists to remove, and the one that would be invisible if it returned.
 * ========================================================================================== */

/** Empty and whitespace-only are ABSENT, not "". A blank variable is not a declaration. */
const present = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, 'must not be blank')
  .optional()
  .catch(undefined);

const PilotEnvSchema = z.object({
  PILOT_DATABASE_URL: present,
  PILOT_ENVIRONMENT_CLASS: present,
  PILOT_ENVIRONMENT_ID: present,
  PILOT_TARGET_ID: present,
  PILOT_MODULE_ENABLED: present,
  PILOT_ALERT_SINK: present,
  PILOT_ALERT_DIR: present,
  PILOT_AUTHORITY_TRUST_FILE: present,
  PILOT_AUTHORITY_TRUST_DIGEST: present,
});

/**
 * THE DECLARATION. Every PILOT_* name the runtime actually reads from the environment, and
 * nothing else.
 *
 * §18 measured the distinction this list depends on: `src/**` contains 39 distinct PILOT_*
 * tokens, but most are enum members, reason codes and constant names — `PILOT_ACTIVE` (a
 * lifecycle state), `PILOT_STORE_NOT_DECLARED` (a refusal code), `PILOT_ACTIONS` (a role's
 * action list). Declaring those as configuration would be declaring strings, not variables.
 * Only names read THROUGH THE ENVIRONMENT belong here.
 */
export const PILOT_RUNTIME_ENV_VARS = [
  'PILOT_ALERT_DIR',
  'PILOT_ALERT_SINK',
  'PILOT_AUTHORITY_TRUST_DIGEST',
  'PILOT_AUTHORITY_TRUST_FILE',
  'PILOT_DATABASE_URL',
  'PILOT_ENVIRONMENT_CLASS',
  'PILOT_ENVIRONMENT_ID',
  'PILOT_MODULE_ENABLED',
  'PILOT_TARGET_ID',
] as const;

export interface PilotEnvConfig {
  /** PILOT_DATABASE_URL, trimmed. `undefined` means NOT DECLARED — never "use the product". */
  readonly databaseUrl: string | undefined;
  /**
   * DATABASE_URL, carried ONLY so the separation check has both halves of the comparison from
   * the SAME object. It is never used to open a pilot connection.
   */
  readonly productDatabaseUrl: string | undefined;
  readonly environmentClass: string | undefined;
  readonly environmentId: string | undefined;
  readonly targetId: string | undefined;
  readonly moduleEnabled: string | undefined;
  readonly alertSink: string | undefined;
  readonly alertDir: string | undefined;
  readonly authorityTrustFile: string | undefined;
  readonly authorityTrustDigest: string | undefined;
  readonly nodeEnv: string | undefined;
}

/**
 * THE ONLY PLACE THE PILOT ENVIRONMENT IS READ.
 *
 * Takes the environment as an argument so a test can supply one WITHOUT mutating the process,
 * and so a caller that has already loaded a configuration can pass it onward instead of
 * re-reading a mutable global halfway down the call stack. That re-read is precisely ENV04-A.
 */
export function loadPilotEnv(env: NodeJS.ProcessEnv = process.env): PilotEnvConfig {
  const p = PilotEnvSchema.parse(env);
  const productDatabaseUrl = env.DATABASE_URL?.trim() || undefined;
  return {
    databaseUrl: p.PILOT_DATABASE_URL,
    productDatabaseUrl,
    environmentClass: p.PILOT_ENVIRONMENT_CLASS,
    environmentId: p.PILOT_ENVIRONMENT_ID,
    targetId: p.PILOT_TARGET_ID,
    moduleEnabled: p.PILOT_MODULE_ENABLED,
    alertSink: p.PILOT_ALERT_SINK,
    alertDir: p.PILOT_ALERT_DIR,
    authorityTrustFile: p.PILOT_AUTHORITY_TRUST_FILE,
    authorityTrustDigest: p.PILOT_AUTHORITY_TRUST_DIGEST,
    nodeEnv: env.NODE_ENV?.trim() || undefined,
  };
}
