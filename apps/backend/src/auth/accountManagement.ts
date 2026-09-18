/**
 * Account management: data export and account deletion.
 *
 * Data export: collects all user data from across the system into a JSON
 * envelope. Only the authenticated user's own data is included.
 *
 * Account deletion: implements a confirmed deletion lifecycle:
 *   request → confirm → execute (revoke sessions, anonymize/delete data)
 */
import { query, withTransaction } from '../db/pool';
import { revokeAllAccessTokensForUser } from './jwt';
import { logger } from '../config/logger';

/* Row types for the export queries — no `any` needed. */
interface UserExportRow { id: string; email: string; display_name: string | null; email_verified: boolean; created_at: Date }
interface IdentityRow { provider: string; provider_user_id: string; email: string | null }
interface SessionRow { id: string; created_at: Date; expires_at: Date; revoked_at: Date | null }
interface MembershipRow { organization_id: string; role: string; created_at: Date }
interface DeviceExportRow { device_id: string; org_id: string; platform: string; os: string; registered_at: Date }
interface AuditRow { action: string; created_at: Date; detail: unknown }
interface SyncRow { entity_type: string; entity_id: string; last_synced_at: Date | null }

export interface UserExportData {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    emailVerified: boolean;
    createdAt: string;
  };
  identities: Array<{ provider: string; providerUserId: string; email: string | null }>;
  sessions: Array<{ id: string; createdAt: string; expiresAt: string; revoked: boolean }>;
  organizations: Array<{ orgId: string; role: string; joinedAt: string }>;
  devices: Array<{ deviceId: string; orgId: string; platform: string; os: string; registeredAt: string }>;
  auditLog: Array<{ action: string; createdAt: string; detail: unknown }>;
  syncState: Array<{ entityType: string; entityId: string; lastSyncedAt: string }>;
}

/**
 * Exports all data associated with the authenticated user. Only the user's
 * own data is returned. Internal secrets (password hashes, token hashes)
 * are excluded.
 */
export async function exportUserData(userId: string): Promise<UserExportData> {
  const [userRes, identitiesRes, sessionsRes, membershipsRes, devicesRes, auditRes, syncRes] =
    await Promise.all([
      query<UserExportRow>(
        `SELECT id, email, display_name, email_verified, created_at FROM users WHERE id = $1`,
        [userId],
      ),
      query<IdentityRow>(
        `SELECT provider, provider_user_id, email FROM auth_identities WHERE user_id = $1`,
        [userId],
      ),
      query<SessionRow>(
        `SELECT id, created_at, expires_at, revoked_at FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [userId],
      ),
      query<MembershipRow>(
        `SELECT organization_id, role, created_at FROM org_members WHERE user_id = $1`,
        [userId],
      ),
      query<DeviceExportRow>(
        `SELECT device_id, org_id, platform, os, registered_at FROM devices WHERE user_id = $1`,
        [userId],
      ),
      query<AuditRow>(
        `SELECT action, created_at, detail FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
        [userId],
      ),
      query<SyncRow>(
        `SELECT entity_type, entity_id, last_synced_at FROM sync_state WHERE user_id = $1`,
        [userId],
      ).catch(() => ({ rows: [] as SyncRow[] })),
    ]);

  const user = userRes.rows[0];
  if (!user) throw new Error('User not found');

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      emailVerified: user.email_verified,
      createdAt: user.created_at.toISOString(),
    },
    identities: identitiesRes.rows.map((r) => ({
      provider: r.provider,
      providerUserId: r.provider_user_id,
      email: r.email,
    })),
    sessions: sessionsRes.rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      revoked: !!r.revoked_at,
    })),
    organizations: membershipsRes.rows.map((r) => ({
      orgId: r.organization_id,
      role: r.role,
      joinedAt: r.created_at.toISOString(),
    })),
    devices: devicesRes.rows.map((r) => ({
      deviceId: r.device_id,
      orgId: r.org_id,
      platform: r.platform,
      os: r.os,
      registeredAt: r.registered_at.toISOString(),
    })),
    auditLog: auditRes.rows.map((r) => ({
      action: r.action,
      createdAt: r.created_at.toISOString(),
      detail: r.detail,
    })),
    syncState: syncRes.rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      lastSyncedAt: r.last_synced_at?.toISOString() ?? '',
    })),
  };
}

export interface DeletionRequestResult {
  requestId: string;
  status: string;
  requestedAt: string;
}

/**
 * Creates an account deletion request. Does not immediately delete — the user
 * must confirm with `confirmAccountDeletion`.
 */
export async function requestAccountDeletion(
  userId: string,
  reason?: string,
): Promise<DeletionRequestResult> {
  // Cancel any pending (unconfirmed) requests for this user.
  await query(
    `UPDATE account_deletion_requests SET status = 'cancelled'
     WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );

  const { rows } = await query(
    `INSERT INTO account_deletion_requests (user_id, reason)
     VALUES ($1, $2) RETURNING id, status, requested_at`,
    [userId, reason ?? null],
  );

  return {
    requestId: rows[0].id,
    status: rows[0].status,
    requestedAt: rows[0].requested_at.toISOString(),
  };
}

/**
 * Confirms and executes an account deletion request. This:
 * 1. Revokes all sessions (refresh tokens) and access tokens.
 * 2. Deletes the user's devices, identities, tokens, and sync state.
 * 3. Anonymizes the user record (replaces email/name, keeps the row for
 *    audit trail integrity with a retention window).
 * 4. Marks the deletion request as executed.
 */
export async function confirmAccountDeletion(
  userId: string,
  requestId: string,
): Promise<{ executed: boolean }> {
  return withTransaction(async (client) => {
    // Verify the request exists, belongs to this user, and is pending.
    const { rows } = await client.query(
      `SELECT id FROM account_deletion_requests
       WHERE id = $1 AND user_id = $2 AND status = 'pending' FOR UPDATE`,
      [requestId, userId],
    );
    if (!rows[0]) return { executed: false };

    // 1. Revoke all refresh sessions.
    await client.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    // 1b. Revoke access tokens via the deny list.
    await revokeAllAccessTokensForUser(userId);

    // 2. Delete user's devices.
    await client.query(`DELETE FROM devices WHERE user_id = $1`, [userId]);

    // 3. Delete auth identities.
    await client.query(`DELETE FROM auth_identities WHERE user_id = $1`, [userId]);

    // 4. Delete auth tokens (verification/reset).
    await client.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [userId]);

    // 5. Delete sync state (if table exists).
    await client.query(`DELETE FROM sync_state WHERE user_id = $1`, [userId]).catch(() => {});

    // 6. Anonymize the user record. We keep the row so audit_log foreign keys
    // remain valid, but strip all PII. The email is replaced with a non-routable
    // placeholder so the unique constraint is satisfied.
    const anonymizedEmail = `deleted_${userId}@deleted.neuropause.local`;
    await client.query(
      `UPDATE users SET
         email = $2,
         display_name = NULL,
         avatar_url = NULL,
         password_hash = NULL,
         email_verified = FALSE
       WHERE id = $1`,
      [userId, anonymizedEmail],
    );

    // 7. Anonymize audit log entries (remove IP and detail PII).
    await client.query(
      `UPDATE audit_log SET ip = NULL, detail = '{"redacted": true}'::jsonb WHERE user_id = $1`,
      [userId],
    );

    // 8. Mark the deletion request as executed with a 30-day retention window.
    await client.query(
      `UPDATE account_deletion_requests SET
         status = 'executed',
         confirmed_at = now(),
         executed_at = now(),
         retention_until = now() + interval '30 days'
       WHERE id = $1`,
      [requestId],
    );

    logger.info({ userId, requestId }, 'Account deletion executed');
    return { executed: true };
  });
}
