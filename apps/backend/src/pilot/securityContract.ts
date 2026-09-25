import type { PoolClient, Pool } from 'pg';

/* ==========================================================================================
 * D-034-3 — THE RUNTIME DATABASE SECURITY CONTRACT SELF-CHECK.
 *
 * HUMAN DECISION, verbatim: "I authorize implementation of the minimum runtime startup
 * self-check required to detect an invalid runtime database security contract. The check must
 * fail closed if the deployed runtime identity or critical privilege assumptions do not match
 * the governed contract. The self-check shall not create authority, alter authority, or
 * substitute for the authorization system."
 *
 * WHAT IT IS. A BOOT-TIME MEASUREMENT of the privileges the deployed runtime actually holds,
 * compared against the contract §10 established. It answers one question: is this process
 * connected to the database with the credential the governance design assumes, or with a more
 * powerful one? Nothing else.
 *
 * WHAT IT IS NOT, and the decision text names all three:
 *   - it CREATES no authority: every statement it issues is a read of a catalog or a
 *     has_*_privilege() call. It cannot write, grant, revoke or mint anything.
 *   - it ALTERS no authority: it never repairs what it finds. A wrong contract is REPORTED and
 *     the mount is refused; self-healing would be the machine granting or revoking privileges,
 *     which is exactly the act reserved to a human.
 *   - it does NOT SUBSTITUTE for the authorization system: passing this check authorizes
 *     nothing. `evaluateBootstrap` and the authority evaluator run unchanged afterwards. A
 *     PASS means "the floor is where it should be", never "this operation is permitted".
 *
 * WHY IT IS NEEDED AT ALL, measured at §10: the governance boundary for two of the three
 * governance-critical tables existed only as the ABSENCE OF A CODE PATH, and the runtime
 * credential could write all three directly. Once §10's privilege contract is applied, nothing
 * in the running system would notice if it were silently undone — by a restore, by a
 * provisioning re-run, by a GRANT ALL. §13 measures that a restore does exactly that. This
 * check is what makes the undoing observable at the next boot instead of never.
 * ========================================================================================== */

/**
 * ENUMERATED, NEVER PREFIX-MATCHED. `pilot_%` would silently pull in every future pilot table
 * and silently drop one that gets renamed; the first complete-decision-instrument lesson was
 * that an enumerated list is a coverage checklist and a prefix is a guess.
 */
export const GOVERNANCE_TABLES = [
  'pilot_authority_decisions',
  'pilot_role_bindings',
  'pilot_environment_identity',
] as const;

/** The writes the runtime must NOT hold on a governance table. SELECT is deliberately absent:
 *  authority evaluation on the request path reads these tables and must keep reading them. */
export const FORBIDDEN_RUNTIME_WRITES = ['INSERT', 'UPDATE', 'DELETE'] as const;

export type SecurityContractRefusal =
  | 'CONTRACT_NOT_MEASURABLE'
  | 'RUNTIME_IS_SUPERUSER'
  | 'RUNTIME_HOLDS_GOVERNANCE_WRITE'
  | 'RUNTIME_CANNOT_READ_GOVERNANCE'
  | 'GOVERNANCE_WRITER_NOT_CONFIGURED'
  | 'GOVERNANCE_WRITER_IS_RUNTIME_ROLE'
  | 'GOVERNANCE_WRITER_IS_SUPERUSER';

/** One measured grant. `held` is what the server said, never what configuration implied. */
export interface TablePrivilegeObservation {
  readonly table: string;
  readonly privilege: string;
  readonly held: boolean;
}

/**
 * What was OBSERVED. Every field is nullable so that "could not be measured" is representable
 * and distinct from "measured false" — the three-failures distinction: not reachable is not the
 * same as reachable-but-false, and collapsing them sends the fix to the wrong layer.
 */
export interface SecurityContractObservation {
  readonly runtimeRole: string | null;
  readonly runtimeIsSuperuser: boolean | null;
  readonly writerRole: string | null;
  readonly writerIsSuperuser: boolean | null;
  readonly writerConfigured: boolean;
  readonly runtimeWrites: readonly TablePrivilegeObservation[];
  readonly runtimeReads: readonly TablePrivilegeObservation[];
  readonly measurementError: string | null;
}

export type SecurityContractDecision =
  | { readonly ok: true; readonly runtimeRole: string; readonly writerRole: string }
  | { readonly ok: false; readonly reason: SecurityContractRefusal; readonly detail: string };

/**
 * THE DECISION, PURE. No database, no clock, no environment — so every branch below is testable
 * without standing a cluster up, and a test cannot accidentally pass because the ambient
 * database happened to be configured correctly.
 *
 * FAIL CLOSED AT EVERY EXIT. The first statement is the unmeasurable case, because a check whose
 * failure mode is "assume fine" is not a check. There is deliberately no branch that returns ok
 * on incomplete information.
 */
export function evaluateSecurityContract(obs: SecurityContractObservation): SecurityContractDecision {
  if (obs.measurementError !== null || obs.runtimeRole === null || obs.runtimeIsSuperuser === null) {
    return {
      ok: false, reason: 'CONTRACT_NOT_MEASURABLE',
      detail: obs.measurementError ?? 'runtime identity could not be read from the server',
    };
  }
  // An empty observation set must never pass: it would mean the contract was "verified" without
  // a single privilege being looked at. A vacuity guard, in the position where vacuity is fatal.
  if (obs.runtimeWrites.length === 0) {
    return { ok: false, reason: 'CONTRACT_NOT_MEASURABLE', detail: 'no privilege observations were taken' };
  }
  if (obs.runtimeIsSuperuser) {
    return {
      ok: false, reason: 'RUNTIME_IS_SUPERUSER',
      detail: `the runtime connects as ${obs.runtimeRole}, a SUPERUSER; every table ACL is bypassed and the `
        + 'governance boundary cannot exist',
    };
  }
  const held = obs.runtimeWrites.filter((o) => o.held);
  if (held.length > 0) {
    return {
      ok: false, reason: 'RUNTIME_HOLDS_GOVERNANCE_WRITE',
      detail: `${obs.runtimeRole} holds ${held.map((o) => `${o.privilege} on ${o.table}`).join(', ')}`,
    };
  }
  /*
   * THE READS MUST STILL WORK, and this is a real refusal rather than a courtesy. A contract that
   * removed SELECT would break authority evaluation on the request path, and the resulting
   * failure would surface far away as an unexplained refusal. Over-revocation is a broken
   * contract too, not a safe one.
   */
  const missingReads = obs.runtimeReads.filter((o) => !o.held);
  if (missingReads.length > 0) {
    return {
      ok: false, reason: 'RUNTIME_CANNOT_READ_GOVERNANCE',
      detail: `${obs.runtimeRole} cannot SELECT ${missingReads.map((o) => o.table).join(', ')}; `
        + 'authority evaluation would fail',
    };
  }
  if (!obs.writerConfigured || obs.writerRole === null || obs.writerIsSuperuser === null) {
    return {
      ok: false, reason: 'GOVERNANCE_WRITER_NOT_CONFIGURED',
      detail: 'PILOT_GOVERNANCE_DATABASE_URL is absent or its identity could not be measured, so no '
        + 'governed write path exists',
    };
  }
  /*
   * THE WRITER MUST NOT BE THE RUNTIME, compared on the CONNECTED ROLE rather than on the URL.
   * §10 refuses an identical URL string, which is necessary but not sufficient: two different
   * URLs can name the same role. This is the runtime observation that closes that gap, and it is
   * the reason this check had to be a boot-time measurement and not a config assertion.
   */
  if (obs.writerRole === obs.runtimeRole) {
    return {
      ok: false, reason: 'GOVERNANCE_WRITER_IS_RUNTIME_ROLE',
      detail: `the governance writer connects as ${obs.writerRole}, the same role as the runtime, so the `
        + 'separation is nominal only',
    };
  }
  if (obs.writerIsSuperuser) {
    return {
      ok: false, reason: 'GOVERNANCE_WRITER_IS_SUPERUSER',
      detail: `the governance writer connects as ${obs.writerRole}, a SUPERUSER; D-034-2 forbids a `
        + 'superuser architecture and a general administrative credential',
    };
  }
  return { ok: true, runtimeRole: obs.runtimeRole, writerRole: obs.writerRole };
}

type Queryable = Pick<PoolClient, 'query'> | Pick<Pool, 'query'>;

/**
 * THE MEASUREMENT. Read-only by construction: `current_user`, `pg_roles.rolsuper` and
 * has_table_privilege are the only things asked.
 *
 * Separated from the decision so the decision can be tested exhaustively offline and so this
 * function can be pointed at a disposable clone without the decision changing.
 */
export async function measureSecurityContract(
  runtime: Queryable,
  writer: Queryable | null,
): Promise<SecurityContractObservation> {
  const writes: TablePrivilegeObservation[] = [];
  const reads: TablePrivilegeObservation[] = [];
  try {
    const { rows } = await runtime.query(
      `SELECT current_user AS role,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
    const runtimeRole = String((rows[0] as Record<string, unknown>).role);
    const runtimeIsSuperuser = (rows[0] as Record<string, unknown>).is_superuser === true;

    for (const table of GOVERNANCE_TABLES) {
      for (const privilege of FORBIDDEN_RUNTIME_WRITES) {
        const r = await runtime.query(
          `SELECT has_table_privilege($1::text, $2::text, $3::text) AS held`,
          [runtimeRole, `public.${table}`, privilege]);
        writes.push({ table, privilege, held: (r.rows[0] as Record<string, unknown>).held === true });
      }
      const rr = await runtime.query(
        `SELECT has_table_privilege($1::text, $2::text, 'SELECT') AS held`,
        [runtimeRole, `public.${table}`]);
      reads.push({ table, privilege: 'SELECT', held: (rr.rows[0] as Record<string, unknown>).held === true });
    }

    let writerRole: string | null = null;
    let writerIsSuperuser: boolean | null = null;
    if (writer) {
      const w = await writer.query(
        `SELECT current_user AS role,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
      writerRole = String((w.rows[0] as Record<string, unknown>).role);
      writerIsSuperuser = (w.rows[0] as Record<string, unknown>).is_superuser === true;
    }

    return {
      runtimeRole, runtimeIsSuperuser, writerRole, writerIsSuperuser,
      writerConfigured: writer !== null, runtimeWrites: writes, runtimeReads: reads,
      measurementError: null,
    };
  } catch (err) {
    /*
     * A FAILED MEASUREMENT IS A REFUSAL, NOT A PASS. The error is carried rather than thrown so
     * the caller records WHY the contract is unknown; `evaluateSecurityContract` turns it into
     * CONTRACT_NOT_MEASURABLE. An unreachable database is not permission.
     */
    return {
      runtimeRole: null, runtimeIsSuperuser: null, writerRole: null, writerIsSuperuser: null,
      writerConfigured: writer !== null, runtimeWrites: writes, runtimeReads: reads,
      measurementError: (err as Error).message,
    };
  }
}

/* ==========================================================================================
 * THE STARTUP GATE.
 *
 * WHERE THIS BELONGS, corrected after measuring: the first wiring of this check put it inside
 * `decidePilotMount`, and that broke the two POSITIVE mount tests — correctly, because
 * `decidePilotMount` is a decision function exercised without a configured writer, and D-034-3
 * asks for a "runtime STARTUP self-check", not a per-gate one. Coupling the mount decision to a
 * live privilege measurement also made mounting depend on database reachability in a way that
 * function never promised. So the check runs ONCE, at boot, here.
 *
 * FAIL CLOSED BY THROWING. At startup there is no caller to hand a refusal to, and continuing
 * with an invalid security contract is the one outcome D-034-3 forbids: "The check must fail
 * closed if the deployed runtime identity or critical privilege assumptions do not match the
 * governed contract." A process that cannot satisfy the contract does not serve.
 * ========================================================================================== */

export class RuntimeSecurityContractInvalid extends Error {
  constructor(public readonly reason: SecurityContractRefusal, detail: string) {
    super(`Runtime database security contract is invalid (${reason}): ${detail}`);
    this.name = 'RuntimeSecurityContractInvalid';
  }
}

/**
 * Measure the contract and THROW if it does not hold. Returns the observed roles on success so
 * the boot log can state which credentials were actually in force — a fact, not a configuration.
 *
 * It creates, alters and grants nothing; every statement is a catalog read.
 */
export async function assertRuntimeSecurityContract(
  runtime: Queryable,
  writer: Queryable | null,
): Promise<{ runtimeRole: string; writerRole: string }> {
  const decision = evaluateSecurityContract(await measureSecurityContract(runtime, writer));
  if (!decision.ok) throw new RuntimeSecurityContractInvalid(decision.reason, decision.detail);
  return { runtimeRole: decision.runtimeRole, writerRole: decision.writerRole };
}
