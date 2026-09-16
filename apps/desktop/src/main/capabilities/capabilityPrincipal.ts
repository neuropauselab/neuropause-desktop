/**
 * The human principal — the authoritative answer to "who is asking?", derived ONLY from the authenticated identity.
 *
 * Constitutional role: the human is the PRINCIPAL; the AI is a representative; a worker is a mechanism; a connector is
 * an effect mechanism. A proposal that will one day carry consequence must name its human principal authoritatively —
 * not the AI, not the renderer, not a synthetic worker, not the weak `requestedBy` string (which defaults to 'user'
 * and is renderer-supplied, so it is NOT authoritative human identity).
 *
 * This resolver mirrors the fail-closed pattern of `approverAuthority.resolveAuthoritativeApprover`: the authoritative
 * subject id and the active tenant scope are supplied by the trusted runtime (the wiring binds them to
 * `authService.getStatus().session.user.id` and `tenantContext.scope()`); a caller/AI/renderer can NEVER supply them.
 * If the human identity or the tenant cannot be resolved, this fails closed — an unresolved principal is itself a
 * governance condition, never a guessed or defaulted identity.
 *
 * A `Principal` is provenance, not authority: naming the human does NOT approve, govern, admit, or execute anything.
 */

/** The authoritative human principal, coupled to the jurisdiction it was resolved in. */
export interface Principal {
  /** The authenticated human's stable id (`authService` session `user.id`). Never the literal 'user'/'system'. */
  readonly subjectId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
}

export type PrincipalResolution =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly reason: 'NOT_AUTHENTICATED' | 'NO_TENANT' };

/**
 * Resolve the authoritative human principal from trusted runtime values. Both inputs come from the authenticated
 * runtime — NEVER from the AI, renderer, or request. Fail-closed: no authenticated subject ⇒ NOT_AUTHENTICATED; no
 * resolved tenant scope ⇒ NO_TENANT.
 */
export function resolvePrincipal(input: {
  /** The authenticated human id, or null when signed out. Supplied by the trusted runtime (authService). */
  readonly subjectId: string | null;
  /** The active tenant scope, or null when unresolved. Supplied by the trusted runtime (tenantContext.scope()). */
  readonly scope: { readonly tenantId: string; readonly workspaceId: string } | null;
}): PrincipalResolution {
  if (typeof input.subjectId !== 'string' || input.subjectId.length === 0) {
    return { ok: false, reason: 'NOT_AUTHENTICATED' };
  }
  if (input.scope === null) {
    return { ok: false, reason: 'NO_TENANT' };
  }
  return {
    ok: true,
    principal: { subjectId: input.subjectId, tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId },
  };
}
