/**
 * The tenant/membership identity of the active principal (S17 / FG-6, condition 2).
 *
 * For a cloud session it is the account email. For a device-local principal it
 * is an explicitly-synthetic, non-routable `local-<id>@device.invalid` address
 * derived from the stable local id — the SAME value at every `sessionEmail` site
 * and at `bindOwner`, so first-claim-wins binds the owner the membership check
 * then matches. It never collides with or implies a real account.
 */
import type { AuthStatus } from '@neuropause/shared';
import { localSessionEmail } from './localNamespace';

/** The tenant/membership email for the active principal, or null when there is none. */
export function sessionEmailFor(status: AuthStatus): string | null {
  if (status.state === 'authenticated') return status.session.user.email;
  if (status.state === 'local') return localSessionEmail(status.principal.id);
  return null;
}

/** A human-facing display name for the active principal, or null when there is none. */
export function principalDisplayName(status: AuthStatus): string | null {
  if (status.state === 'authenticated') {
    return status.session.user.displayName ?? status.session.user.email;
  }
  if (status.state === 'local') return status.principal.displayName;
  return null;
}
