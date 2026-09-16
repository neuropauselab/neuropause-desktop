/**
 * Honest governed-actor resolution for a CST admission (S17 / FG-6, condition 3).
 *
 * The actor that flows into `boundDecisionClaimMint` (and the mail.send governed
 * transition) is derived from the auth status. A device-local principal is
 * disclosed as local by an unmistakable `local:<id>` string — an admission
 * carrying it can never read as cloud-authenticated. Deny-by-default: only
 * `authenticated` and `local` yield an actor; everything else → null → the
 * mint's NO_ACTOR refusal.
 */
import type { AuthStatus, User } from '@neuropause/shared';
import { isReservedLocalActor, localActorId } from './localNamespace';

/**
 * True when SOME principal — cloud-authenticated OR device-local — is active.
 * The RBAC dispatch gate (`secureBridge.isAuthenticated`). Deny-by-default for
 * `authenticating` / `error` / `unauthenticated`.
 */
export function hasActivePrincipal(status: AuthStatus): boolean {
  return status.state === 'authenticated' || status.state === 'local';
}

/**
 * Resolve the authoritative governed actor, honestly:
 *   - authenticated → the picked cloud identity, UNLESS it forges the reserved
 *     `local:` namespace (a compromised/forged session claiming to be local) →
 *     DENY (null) (FG-6 pin 1; the S33 confused-deputy edge).
 *   - local         → `local:<id>` (self-disclosing; stable → correlates, pin 3).
 *   - anything else → null → NO_ACTOR (pin 4, deny-by-default).
 * The `local:` prefix is never stripped anywhere — the string IS the identity (pin 2).
 */
export function resolveGovernedActor(
  status: AuthStatus,
  pick: (u: User) => string | null,
): string | null {
  if (status.state === 'authenticated') {
    const id = pick(status.session.user);
    if (id === null || id.trim() === '' || isReservedLocalActor(id)) return null;
    return id;
  }
  if (status.state === 'local') return localActorId(status.principal.id);
  return null;
}
