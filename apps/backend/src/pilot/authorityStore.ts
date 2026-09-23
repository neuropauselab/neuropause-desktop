/**
 * The SQL loaders behind ENG-04, and the production wiring.
 *
 * EVERY QUERY HERE READS A TABLE THAT SHIPS EMPTY. That is what makes the production posture
 * "designated but not bound": D05 named three people, `pilot_role_bindings` has no rows, and
 * so every consequential route answers DENY with `ROLE_NOT_BOUND`.
 */
import { query, withTransaction } from '../db/pilotPool';
import { resolvePilotEnvironment } from './environment';
import { verifyAuthorityRow, type SignableAuthorityRow, type VerifyFailure } from './authoritySignature';
import { loadPilotTrust } from './authorityTrust';
import { evaluateBootstrap, type BootstrapRequest, type BootstrapOutcome } from './authorityBootstrap';
import type { AuthorityDecisionArtifact, AuthorityEnvironment, RoleBinding, PilotRole } from './authorityEvaluator';
import { loadAuthoritySnapshot } from './authorityEvaluator';

export async function loadRoleBindings(): Promise<readonly RoleBinding[]> {
  const { rows } = await query(
    `SELECT subject_id, role, decision_ref, bound_at, expires_at, revoked_at FROM pilot_role_bindings`,
  );
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
export async function loadAuthorityDecisions(): Promise<readonly AuthorityDecisionArtifact[]> {
  const { rows } = await query(
    `SELECT instrument, authenticated, actions, environment_class, effective_from, expires_at,
            revoked_at, signature, signer_key_id
     FROM pilot_authority_decisions`,
  );
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
  const admitted = await loadAuthorityDecisions();   // already H13-anchored + signature-verified
  const existing = await loadRoleBindings();
  const outcome = evaluateBootstrap(req, admitted, existing, now);

  const note = (result: string): void => {
    attempts.push({ at: now.toISOString(), actorId: req.actorId, subjectId: req.subjectId, role: req.role, result });
  };

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
  return withTransaction(async (client) => {
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
