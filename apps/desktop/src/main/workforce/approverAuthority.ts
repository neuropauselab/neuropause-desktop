/**
 * P13C Phase I-A.1 — Boundary-A approver authority (fail-closed).
 *
 * Standalone (no side-effectful imports) so the fail-closed contract is unit-testable
 * without loading the full workforce subsystem's Electron-dependent module graph.
 *
 * The approval/rejection seams bind the AUTHORITATIVE approver principal from the
 * trusted `actor` accessor (the `authService` session `user.id`), never the renderer
 * and never the literal `'user'`. A `null` principal is itself a governance condition:
 * no authoritative approval can be recorded, and there is NO fallback identity
 * (never `'user'`/`'system'`/`'unknown'`/tenant/workspace/email/displayName).
 */
export function resolveAuthoritativeApprover(
  actor: () => string | null,
  action: 'approval' | 'rejection',
): string {
  const principal = actor();
  if (principal === null) {
    throw new Error(
      `${action === 'approval' ? 'Approval' : 'Rejection'} requires an authenticated principal.`,
    );
  }
  return principal;
}
