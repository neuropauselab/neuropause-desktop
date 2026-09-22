/**
 * Account management: data export and account deletion.
 *
 * Data export: collects the authenticated user's data into a JSON envelope.
 *
 * SCOPE, STATED HONESTLY (corrected in NP-PILOT-FIRST-005): this is NOT "all data across the
 * system". It reads the account tables below plus the participant's pilot record, and it
 * TRUNCATES - `auth_sessions` at 100 rows and `audit_log` at 500 - with no marker in the JSON
 * saying so. A participant with more history than that receives a partial export that looks
 * complete. Recorded as an open gap rather than silently fixed, because adding a marker
 * changes the response contract.
 *
 * Account deletion: implements a confirmed deletion lifecycle:
 *   request → confirm → execute (revoke sessions, delete auth data, pseudonymize the user row)
 *
 * WHAT DELETION DOES AND DOES NOT DO, measured in NP-PILOT-FIRST-005 and stated here because
 * the previous wording ("anonymize") overstated it:
 *   - devices, auth_identities and auth_tokens are DELETED;
 *   - the users row is PSEUDONYMIZED, not anonymized — see the note at the UPDATE below;
 *   - NO user row is ever DELETED, so the `ON DELETE CASCADE` that every pilot table declares
 *     on users(id) CAN NEVER FIRE. The pilot record survives in full;
 *   - and a hard delete would not work either: three FKs to users(id) carry no ON DELETE
 *     clause at all (human_decisions.actor_id, pilot_lifecycle_events.actor_user_id,
 *     pilot_control.stop_actor_id), so NO ACTION applies and the statement would raise 23503
 *     for anyone who has ever acted in the pilot. Those three hold GOVERNANCE ACCOUNTABILITY
 *     records about an operator, which is a different question from erasing a subject.
 * None of this is repaired here: what a pilot participation owes an erasure request is a
 * controller decision, not an engineering one.
 */
import { query, withTransaction } from '../db/pool';
import { revokeAllAccessTokensForUser } from './jwt';
import { logger } from '../config/logger';
import { sqlPilotRepository } from '../pilot/repository';
import { exportParticipantPilotData, type ParticipantPilotExport } from '../pilot/export';

/* Row types for the export queries — no `any` needed. */
interface UserExportRow { id: string; email: string; display_name: string | null; email_verified: boolean; created_at: Date }
interface IdentityRow { provider: string; provider_user_id: string; email: string | null }
interface SessionRow { id: string; created_at: Date; expires_at: Date; revoked_at: Date | null }
interface MembershipRow { org_id: string; role: string; created_at: Date }
interface DeviceExportRow { device_id: string; org_id: string; platform: string; os: string; registered_at: Date }
interface AuditRow { action: string; created_at: Date; detail: unknown }

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
  /**
   * The participant's pilot record. ALWAYS PRESENT, never null: an account that never entered
   * the pilot gets the block with `consent.recorded` and `enrollment.recorded` both false.
   *
   * That is the point. A null block, or an omitted key, would be indistinguishable from "the
   * export forgot to look" — whereas an explicit `recorded: false` is a positive statement
   * that the pilot was asked and holds nothing.
   */
  pilot: ParticipantPilotExport;
  // NP-047 / B HIGH-2: `sync_state` is ORG-scoped (PRIMARY KEY (org_id,
  // entity_type, entity_id); no user_id column). It is organization data, not
  // per-user personal data, so it is NOT part of a user export. The previous
  // field queried a nonexistent column and could never return rows.
}

/**
 * Exports the authenticated user's data. Only the user's own data is returned; internal
 * secrets (password hashes, token hashes, device public keys) are excluded.
 *
 * The `pilot` block is assembled by the pilot module, which declares what it withholds rather
 * than omitting it - see pilot/export.ts.
 */
export async function exportUserData(userId: string): Promise<UserExportData> {
  const [userRes, identitiesRes, sessionsRes, membershipsRes, devicesRes, auditRes, pilotData] =
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
      // NP-047 / B HIGH-1: the relation is `memberships` (column org_id), not
      // `org_members`/`organization_id` — the previous query was 42P01 on
      // every call.
      query<MembershipRow>(
        `SELECT org_id, role, created_at FROM memberships WHERE user_id = $1`,
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
      // The pilot's own record, assembled by the pilot module so that knowledge of what the
      // pilot holds — and of what it withholds pending a human decision — lives with the
      // pilot rather than being re-derived here. Reads only, and runs concurrently.
      exportParticipantPilotData(sqlPilotRepository, userId),
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
      orgId: r.org_id,
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
    pilot: pilotData,
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

    // NP-047 / B HIGH-2: the previous step here was
    //   DELETE FROM sync_state WHERE user_id = $1  (.catch(() => {}))
    // `sync_state` is ORG-scoped and has no user_id column, so the statement
    // was 42703 on every call — and the swallowed error was poisoning the
    // enclosing transaction (a failed statement aborts it), rolling the whole
    // deletion back. sync_state rows are organization data, not per-user
    // personal data; they are not part of account deletion. The swallowed
    // catch around a transactional statement is removed as a class.

    // 6. PSEUDONYMIZE the user record — not anonymize, and the distinction is load-bearing.
    //
    // The row is kept so foreign keys stay valid, and the direct identifiers are cleared. But
    // the replacement email EMBEDS users.id VERBATIM, so the mapping back to the original
    // account is reversible by inspection: anyone holding the row can read the subject's
    // primary key out of the address, and every other table still keys off that same uuid.
    // (Measured in NP-PILOT-FIRST-005. The previous comment here said "strip all PII" and
    // called the result anonymized; that was inaccurate as written, and a false comment about
    // a privacy control is worse than none, because it is what a reviewer reads.)
    //
    // Whether a reversible pseudonym is acceptable, and whether a random local part should
    // replace the id, is a controller decision — see
    // NP-PILOT-FIRST-005 decisions/HUMAN-DECISION-DATA-LIFECYCLE.md. The UNIQUE index on
    // users.email is satisfied by any unique string, so the choice is not constrained here.
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
