import type { User } from '@neuropause/shared';
import type { PoolClient } from 'pg';
import { query } from '../db/pool';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findUserByIdentity(
  provider: string,
  providerUserId: string,
): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `SELECT u.* FROM users u
       JOIN auth_identities i ON i.user_id = u.id
      WHERE i.provider = $1 AND i.provider_user_id = $2`,
    [provider, providerUserId],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function createUserWithPassword(
  email: string,
  passwordHash: string,
  displayName: string | null,
): Promise<User> {
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3) RETURNING *`,
    [email, passwordHash, displayName],
  );
  return toUser(rows[0]);
}

export function rawToUser(row: UserRow): User {
  return toUser(row);
}

export type { UserRow };
export { toUser as mapUser };

/** Used inside a transaction when provisioning an OAuth user. */
export async function insertUserTx(
  client: PoolClient,
  email: string,
  displayName: string | null,
  avatarUrl: string | null,
): Promise<User> {
  const { rows } = await client.query<UserRow>(
    `INSERT INTO users (email, display_name, avatar_url)
     VALUES ($1, $2, $3) RETURNING *`,
    [email, displayName, avatarUrl],
  );
  return toUser(rows[0]);
}

export async function linkIdentityTx(
  client: PoolClient,
  userId: string,
  provider: string,
  providerUserId: string,
  email: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [userId, provider, providerUserId, email],
  );
}
