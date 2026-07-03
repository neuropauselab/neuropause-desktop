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
 * returns that user. Otherwise links the identity to an existing user with the
 * same verified email, or provisions a brand-new account — all atomically.
 */
export async function resolveOAuthUser(
  provider: string,
  profile: ProviderProfile,
): Promise<{ user: User; isNew: boolean }> {
  const existingByIdentity = await findUserByIdentity(provider, profile.providerUserId);
  if (existingByIdentity) return { user: existingByIdentity, isNew: false };

  return withTransaction(async (client) => {
    let isNew = false;
    let userId: string;

    if (profile.email) {
      const byEmail = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1',
        [profile.email],
      );
      if (byEmail.rows[0]) {
        userId = byEmail.rows[0].id;
      } else {
        const created = await insertUserTx(
          client,
          profile.email,
          profile.displayName,
          profile.avatarUrl,
        );
        userId = created.id;
        isNew = true;
      }
    } else {
      // No email from provider: synthesize a stable placeholder address.
      const synthetic = `${provider}_${profile.providerUserId}@users.neuropause.local`;
      const created = await insertUserTx(client, synthetic, profile.displayName, profile.avatarUrl);
      userId = created.id;
      isNew = true;
    }

    await linkIdentityTx(client, userId, provider, profile.providerUserId, profile.email);

    const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
    return { user: mapUser(rows[0]), isNew };
  });
}
