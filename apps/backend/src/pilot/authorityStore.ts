/**
 * The SQL loaders behind ENG-04, and the production wiring.
 *
 * EVERY QUERY HERE READS A TABLE THAT SHIPS EMPTY. That is what makes the production posture
 * "designated but not bound": D05 named three people, `pilot_role_bindings` has no rows, and
 * so every consequential route answers DENY with `ROLE_NOT_BOUND`.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pilotPool';
import { resolvePilotEnvironment } from './environment';
import { verifyAuthorityRow, type SignableAuthorityRow, type VerifyFailure } from './authoritySignature';
import { loadPilotTrust } from './authorityTrust';
import { evaluateBootstrap, type BootstrapRequest, type BootstrapOutcome } from './authorityBootstrap';
import type { AuthorityDecisionArtifact, AuthorityEnvironment, RoleBinding, PilotRole } from './authorityEvaluator';
import { loadAuthoritySnapshot } from './authorityEvaluator';

/*
 * D-034-5 — DETERMINISTIC SELECTION RULE. NP-033 measured that this SELECT had no ORDER BY while
 * `explainAuthority` takes `permitted[0]`, so with two live bindings for one subject BOTH the
 * granted action and the INSTRUMENT CREDITED IN THE AUDIT were decided by PostgreSQL's physical
 * row order — unspecified, and free to change with the plan, a vacuum, or page layout.
 *
 * THE RULE, and why this one: `bound_at ASC, id ASC`. EARLIEST LIVE BINDING WINS.
 *   - `authorityBootstrap.ts:126` states the governing semantics: "one subject, one live role",
 *     because the three roles are separations of duty. In a correct store exactly one row is
 *     live, so ordering is unobservable and this changes nothing.
 *   - When the invariant HAS been broken, the later row is the artifact of the race that
 *     CONFLICTING_BINDING was written to refuse. Preferring the EARLIEST therefore declines to
 *     reward the racer; preferring the newest would hand authority to precisely the write that
 *     should not exist, which D-034-5 forbids in as many words.
 *   - `id ASC` breaks an exact `bound_at` tie (the column defaults to now(), so two inserts in
 *     one transaction can share a timestamp) so the rule is TOTAL, never merely partial.
 * This rule orders; it does not authorise. Expiry, revocation, the role matrix, the decision
 * artifact and its signature are all still evaluated downstream and none of them is bypassed.
 */
const ROLE_BINDINGS_SQL =
  `SELECT subject_id, role, decision_ref, bound_at, expires_at, revoked_at
     FROM pilot_role_bindings
    ORDER BY bound_at ASC, id ASC`;

export async function loadRoleBindings(client?: PoolClient): Promise<readonly RoleBinding[]> {
  const { rows } = client ? await client.query(ROLE_BINDINGS_SQL) : await query(ROLE_BINDINGS_SQL);
  return rows.map((r) => ({
    subjectId: r.subject_id as string,
    role: r.role as PilotRole,
    decisionRef: r.decision_ref as string,
    boundAt: new Date(r.bound_at).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
  }));
}

/**
 * The trust anchor in force on the last load — H13 requirement 6. Recorded so that a
 * redefinition of the expected digest is OBSERVABLE rather than silent. Diagnostics only:
 * never consulted by a decision, because the decision already happened in loadPilotTrust.
 */
let lastAnchor: { anchorDigest: string | null; fileDigest: string | null; failure: string | null } =
  { anchorDigest: null, fileDigest: null, failure: null };
export const lastTrustAnchor = (): Readonly<typeof lastAnchor> => lastAnchor;

/** Why each row was refused on the last load. Diagnostics only — never consulted by a decision. */
let lastRefusals: readonly { instrument: string; reason: VerifyFailure }[] = [];
export const lastAuthorityVerificationRefusals = (): readonly { instrument: string; reason: VerifyFailure }[] =>
  lastRefusals;

/*
 * OPTION_B, THE THIRD NAMED CHANGE: "verify in `loadAuthorityDecisions` BEFORE the snapshot
 * is built."
 *
 * The placement is the control. Verification here means an unsigned or badly-signed row never
 * becomes an `AuthorityDecisionArtifact` at all, so no downstream consumer — evaluator,
 * snapshot, or any future caller — can be handed one and forget to check. Verifying later, in
 * `explainAuthority` say, would leave the artifact constructible and the check skippable by
 * the next code path somebody adds.
 *
 * FAIL CLOSED BY CONSTRUCTION, NOT BY BRANCH. Rows are FILTERED, not flagged: there is no
 * `verified: false` artifact to mishandle. With no trust file the map is empty, every row
 * fails SIGNER_KEY_NOT_TRUSTED, and the loader returns [] — which denies everything. That is
 * the correct posture for a pilot whose key ceremony has not happened.
 */
const AUTHORITY_DECISIONS_SQL =
  `SELECT instrument, authenticated, actions, environment_class, effective_from, expires_at,
          revoked_at, signature, signer_key_id
     FROM pilot_authority_decisions`;

export async function loadAuthorityDecisions(
  client?: PoolClient,
): Promise<readonly AuthorityDecisionArtifact[]> {
  const { rows } = client
    ? await client.query(AUTHORITY_DECISIONS_SQL)
    : await query(AUTHORITY_DECISIONS_SQL);
  const trustLoad = loadPilotTrust();
  const trust = trustLoad.keys;
  lastAnchor = { anchorDigest: trustLoad.anchorDigest, fileDigest: trustLoad.fileDigest,
    failure: trustLoad.fileFailure };
  const refusals: { instrument: string; reason: VerifyFailure }[] = [];

  const admitted = rows.filter((r) => {
    /*
     * The row is re-serialised from the DATABASE values, not from the artifact built below.
     * Signing what you are about to construct rather than what you read would verify the
     * parse, not the record — and the parse is under the control of whoever wrote the row.
     */
    const signable: SignableAuthorityRow = {
      instrument: r.instrument as string,
      authenticated: r.authenticated as boolean,
      actions: (r.actions ?? []) as string[],
      environment_class: r.environment_class as string,
      effective_from: new Date(r.effective_from).toISOString(),
      expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      revoked_at: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    };
    const v = verifyAuthorityRow(signable, r.signature ?? null, r.signer_key_id ?? null, trust);
    if (!v.ok) refusals.push({ instrument: String(r.instrument), reason: v.reason });
    return v.ok;
  });
  lastRefusals = refusals;

  return admitted.map((r) => ({
    instrument: r.instrument as string,
    authenticated: r.authenticated as boolean,
    actions: (r.actions ?? []) as string[],
    /*
     * ENG-13. This read the column and then threw it away, hard-coding 'PILOT'.
     *
     * The consequence was that `explainAuthority`'s DECISION_OUT_OF_SCOPE check —
     * `if (artifact.environmentClass !== 'PILOT')` — compared 'PILOT' to 'PILOT' on every
     * production call. The guard could not fail, so it was not a guard.
     *
     * It was masked, not harmless: the table carries CHECK (environment_class = 'PILOT'), so
     * no offending row can exist today. But that makes the code-level check UNFALSIFIABLE
     * rather than safe — and the programme has measured before that an unconsumed field is not
     * a safe field, it is an unfalsifiable one. The mask is also removable: the runtime
     * credential is the migration credential and holds DDL rights, so whoever can write these
     * rows can also drop that CHECK, at which point a silently non-discriminating guard is the
     * only thing between a non-pilot decision artifact and an ALLOW.
     *
     * Now the column decides. Two independent checks that must agree, which is the same shape
     * as the ENV-02 two-sided environment assertion.
     */
    environmentClass: r.environment_class,
    effectiveFrom: new Date(r.effective_from).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
  }));
}

/**
 * The environment, as the authority evaluator sees it.
 *
 * A failed resolution yields null, which DENIES. It deliberately does not distinguish the
 * refusal reasons here: the evaluator's job is to decide, and the reason belongs in the
 * environment evidence record, not in an authorization branch.
 */
export async function loadAuthorityEnvironment(): Promise<AuthorityEnvironment | null> {
  const resolved = await resolvePilotEnvironment();
  return resolved.ok
    ? { environmentClass: resolved.record.environmentClass, environmentId: resolved.record.environmentId }
    : null;
}

export const sqlAuthorityLoaders = {
  bindings: loadRoleBindings,
  decisions: loadAuthorityDecisions,
  environment: loadAuthorityEnvironment,
};

export function loadProductionAuthoritySnapshot(now: Date = new Date()) {
  return loadAuthoritySnapshot(sqlAuthorityLoaders, now);
}


/* ==========================================================================================
 * ENG-11 — THE WRITE PATH ITSELF.
 *
 * `evaluateBootstrap` is the decision; this is the only thing in the codebase that acts on it.
 * Before this function, `INSERT INTO pilot_role_bindings` had ZERO non-test occurrences, so no
 * role could ever be bound and every consequential pilot route answered ROLE_NOT_BOUND.
 * ========================================================================================== */

/**
 * Advisory-lock namespace for the first-identity role-binding path (amended D-034-4).
 *
 * The two-argument `pg_advisory_xact_lock(classid, objid)` form is used deliberately: the classid
 * is a fixed namespace for THIS path, so a hashtext collision with any other advisory-lock user
 * in the same database cannot serialise or, worse, fail to serialise this one. The value itself
 * is arbitrary but must never change, because changing it would silently stop two concurrent
 * callers — an old build and a new one — from taking the same lock.
 */
const ROLE_BINDING_LOCK_CLASS = 340344;

/** Every bootstrap attempt this process has seen, decision included. Diagnostics. */
const attempts: { at: string; actorId: string; subjectId: string; role: string; result: string }[] = [];
export const bootstrapAttempts = (): readonly (typeof attempts)[number][] => attempts;

export type BootstrapResult = BootstrapOutcome & { readonly bindingId?: string };

/**
 * Materialises a previously-decided human authority relationship. It does NOT create one:
 * every path here requires an admitted, signed instrument that NAMES the subject and role,
 * and `evaluateBootstrap` refuses anything else. There is deliberately no "first user is
 * authority", no "admin is authority", and no "database owner is authority" branch.
 */
export async function bootstrapRoleBinding(
  req: BootstrapRequest,
  now: Date = new Date(),
): Promise<BootstrapResult> {
  const note = (result: string): void => {
    attempts.push({ at: now.toISOString(), actorId: req.actorId, subjectId: req.subjectId, role: req.role, result });
  };

  /*
   * AMENDED D-034-4 — TRANSACTION-SCOPED ADVISORY LOCK.
   *
   * THE DEFECT THIS CLOSES, measured 8 of 8 on both machines: the reads, the decision and the
   * write used to sit OUTSIDE any shared transaction, so two concurrent calls for one subject
   * with DIFFERENT roles each read zero live bindings, each passed CONFLICTING_BINDING, and BOTH
   * inserted. `UNIQUE (subject_id, role)` constrains the PAIR, so two roles for one subject are
   * two legal rows, and `explainAuthority` then grants the UNION — handing an operator the
   * `pilot.resume`, `pilot.decision.record` and `pilot.cap.set` authorities that D07/D04/D05
   * reserve to the decision authority.
   *
   * WHY THE LOCK MUST WRAP THE READS AND NOT ONLY THE WRITE: a lock taken after
   * `loadRoleBindings` would serialise two writers that had each already read a stale empty set,
   * and both would still insert. The amendment says "acquired before the authoritative binding
   * read, validation, and mutation sequence" — so the transaction opens FIRST, the lock is taken
   * FIRST, and the reads are then issued ON THE LOCKED CLIENT.
   *
   * WHY AN ADVISORY LOCK AND NOT A ROW LOCK OR AN INDEX:
   *   - `SELECT ... FOR UPDATE` on a protected table is refused 42501 once the NP-030 privilege
   *     contract is applied (measured), so a row lock COLLIDES with the contract. An advisory
   *     lock is not a table privilege — it needs only EXECUTE on the function, which is PUBLIC —
   *     so it is compatible with a SELECT-only runtime (measured).
   *   - the previously proposed partial unique index is WITHDRAWN by the directive and must not
   *     appear: it is too strict for an expired-but-unrevoked binding, too loose for a
   *     future-dated revocation, and an index predicate cannot call now() (IMMUTABLE only).
   *
   * THE KEY is deterministic and per-subject: a fixed namespace classid plus hashtext(subject).
   * Per-subject rather than global so unrelated subjects are never serialised. It is a
   * SYNCHRONISATION PRIMITIVE ONLY — it grants nothing, and every authority check below still
   * runs. Transaction-scoped, so it is released by COMMIT or ROLLBACK and can never leak.
   */
  return withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))`,
      [ROLE_BINDING_LOCK_CLASS, req.subjectId],
    );

    // Reads issued INSIDE the lock, on the locked client, so the decision cannot be stale.
    const admitted = await loadAuthorityDecisions(client);  // H13-anchored + signature-verified
    const existing = await loadRoleBindings(client);
    const outcome = evaluateBootstrap(req, admitted, existing, now);

    if (!outcome.ok) {
      note(outcome.reason);
      return outcome;
    }

    /*
     * THE BINDING AND ITS AUDIT ROW ARE ONE TRANSACTION. A binding without a ledger entry is an
     * authority whose creation cannot be reconstructed, which is the same "work with no evidence"
     * shape the retention defect had. `withTransaction` ROLLBACKs only on a throw, so the ledger
     * insert must be allowed to throw rather than being swallowed.
     */
    const { rows } = await client.query(
      `INSERT INTO pilot_role_bindings (subject_id, role, decision_ref)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.subjectId, req.role, req.instrument],
    );
    const bindingId = rows[0].id as string;
    await client.query(
      `INSERT INTO pilot_lifecycle_events
         (enrollment_id, subject_user_id, actor_user_id, kind, previous_state, new_state, reason)
       VALUES (NULL, $1, $2, 'ROLE_BINDING', 'UNBOUND', $3, $4)`,
      [req.subjectId, req.actorId, req.role, `instrument=${req.instrument}`],
    );
    note('BOUND');
    return { ok: true as const, bindingId };
  });
}
