/**
 * The SQL loaders behind ENG-04, and the production wiring.
 *
 * EVERY QUERY HERE READS A TABLE THAT SHIPS EMPTY. That is what makes the production posture
 * "designated but not bound": D05 named three people, `pilot_role_bindings` has no rows, and
 * so every consequential route answers DENY with `ROLE_NOT_BOUND`.
 */
import { query } from '../db/pool';
import { resolvePilotEnvironment } from './environment';
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

export async function loadAuthorityDecisions(): Promise<readonly AuthorityDecisionArtifact[]> {
  const { rows } = await query(
    `SELECT instrument, authenticated, actions, environment_class, effective_from, expires_at, revoked_at
     FROM pilot_authority_decisions`,
  );
  return rows.map((r) => ({
    instrument: r.instrument as string,
    authenticated: r.authenticated as boolean,
    actions: (r.actions ?? []) as string[],
    environmentClass: 'PILOT' as const,
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
