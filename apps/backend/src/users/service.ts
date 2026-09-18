import type { User } from '@neuropause/shared';
import type { ProviderProfile } from '../auth/providers/types';
import { withTransaction } from '../db/pool';
import {
  createUserWithPassword,
  findUserByEmail,
  findUserByIdentity,
  insertUserTx,
  linkIdentityTx,
  mapUser,
} from './repository';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { conflict, unauthorized } from '../middleware/error';

/** Registers a new email/password user. Fails if the email already exists. */
export async function registerEmailUser(email: string, password: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) throw conflict('email_taken', 'An account with this email already exists');
  const passwordHash = await hashPassword(password);
  return createUserWithPassword(email, passwordHash, null);
}

/** Verifies email/password credentials, returning the user on success. */
export async function authenticateEmailUser(email: string, password: string): Promise<User> {
  const row = await findUserByEmail(email);
  if (!row || !row.password_hash) {
    // Run a dummy verify to keep timing roughly uniform.
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA', password);
    throw unauthorized('invalid_credentials', 'Invalid email or password');
  }
  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) throw unauthorized('invalid_credentials', 'Invalid email or password');
  return mapUser(row);
}

/**
 * Resolves an OAuth profile to a user. If the federated identity is known,
 * returns that user. Otherwise provisions a brand-new account.
 *
 * SECURITY: we do NOT auto-link an OAuth identity to an existing account by
 * email alone. An attacker who controls an OAuth provider reporting a victim's
 * email would otherwise hijack their account. A new OAuth identity always
 * creates a fresh account. If the email is already taken, a unique suffix is
 * appended so no collision occurs. Users who want to link multiple providers
 * must do so explicitly through a future account-linking flow while
 * authenticated on both sides.
 */
export async function resolveOAuthUser(
  provider: string,
  profile: ProviderProfile,
): Promise<{ user: User; isNew: boolean }> {
  const existingByIdentity = await findUserByIdentity(provider, profile.providerUserId);
  if (existingByIdentity) return { user: existingByIdentity, isNew: false };

  return withTransaction(async (client) => {
    let email: string;

    if (profile.email) {
      // Check if the email is already in use. If so, create a provider-scoped
      // address so we never auto-link to an account we don't control.
      const byEmail = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1',
        [profile.email],
      );
      if (byEmail.rows[0]) {
        // Email already belongs to another user. Create a provider-scoped
        // placeholder so this new OAuth user gets their own account.
        email = `${provider}_${profile.providerUserId}@users.neuropause.local`;
      } else {
        email = profile.email;
      }
    } else {
      // No email from provider: synthesize a stable placeholder address.
      email = `${provider}_${profile.providerUserId}@users.neuropause.local`;
    }

    const created = await insertUserTx(
      client,
      email,
      profile.displayName,
      profile.avatarUrl,
    );
    await linkIdentityTx(client, created.id, provider, profile.providerUserId, profile.email);

    const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [created.id]);
    return { user: mapUser(rows[0]), isNew: true };
  });
}
