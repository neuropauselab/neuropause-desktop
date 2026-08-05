/**
 * Identity Platform (Wave 1, Module 2). Real login (scrypt password verify),
 * logout, persisted sessions (idle + absolute timeout reusing the Phase-14 session
 * policy), user profiles, invitations, password reset, MFA hooks (TOTP via the
 * Phase-14 crypto), and device sessions. Reuses Phase-14 identity/session semantics
 * and the one audit chain + event bus. No social login, no external IdP.
 */
import { randomId, sha256Hex, type Clock } from '@neuropause/cloud-core';
import { randomBytes } from 'node:crypto';
import { DEFAULT_SESSION_POLICY, verifyTotp, base32Encode, type SessionPolicy } from '@neuropause/security';
import type { SqlDriver } from '@neuropause/persistence';
import { one, many, run } from './db';
import { verifyPassword, hashPassword } from './credentials';
import type { UserService, User } from './users';
import type { Gov } from './governance';
import type { MutationContext } from './types';

export interface Session {
  id: string;
  tenantId: string;
  userId: string;
  device: string | null;
  correlationId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revoked: boolean;
}
export type LoginResult =
  | { ok: true; session: Session; user: User }
  | { ok: false; reason: 'invalid-credentials' | 'inactive' | 'mfa-required' | 'mfa-invalid' };
export interface SessionValidation {
  valid: boolean;
  reason?: 'ok' | 'not-found' | 'revoked' | 'idle-timeout' | 'absolute-timeout';
  session?: Session;
}

interface SessRow {
  id: string; tenant_id: string; user_id: string; device: string | null; correlation_id: string;
  created_at: string | number; last_seen_at: string | number; expires_at: string | number; revoked: boolean;
}
const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
function mapSess(r: SessRow): Session {
  return { id: r.id, tenantId: r.tenant_id, userId: r.user_id, device: r.device, correlationId: r.correlation_id, createdAt: num(r.created_at), lastSeenAt: num(r.last_seen_at), expiresAt: num(r.expires_at), revoked: r.revoked };
}

export class IdentityService {
  private readonly resetTokens = new Map<string, { userId: string; tenantId: string; expiresAt: number }>();

  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock,
    private readonly gov: Gov,
    private readonly users: UserService,
    private readonly policy: SessionPolicy = DEFAULT_SESSION_POLICY,
  ) {}

  // ── login / logout / sessions ──
  async login(input: { tenantId: string; email: string; password: string; mfaCode?: string; deviceId?: string; correlationId?: string }): Promise<LoginResult> {
    const cred = await this.users.credentials(input.tenantId, input.email);
    if (!cred) return { ok: false, reason: 'invalid-credentials' };
    if (cred.status !== 'active') return { ok: false, reason: 'inactive' };
    if (!verifyPassword(input.password, cred.hash, cred.salt)) return { ok: false, reason: 'invalid-credentials' };
    if (cred.mfaSecret) {
      if (!input.mfaCode) return { ok: false, reason: 'mfa-required' };
      if (!verifyTotp(cred.mfaSecret, input.mfaCode, this.clock.now())) return { ok: false, reason: 'mfa-invalid' };
    }
    const session = await this.createSession(input.tenantId, cred.id, input.deviceId, input.correlationId);
    const ctx: MutationContext = { tenantId: input.tenantId, actorId: cred.id, sessionId: session.id, correlationId: session.correlationId, ...(input.deviceId ? { deviceId: input.deviceId } : {}) };
    this.gov.audit.record({ ctx, entity: 'session', entityId: session.id, operation: 'login' });
    await this.gov.events.publish('nems.session.started', ctx, { sessionId: session.id, userId: cred.id, device: session.device });
    return { ok: true, session, user: (await this.users.get(input.tenantId, cred.id))! };
  }

  private async createSession(tenantId: string, userId: string, deviceId?: string, correlationId?: string): Promise<Session> {
    const id = randomId('sess');
    const now = this.clock.now();
    const cid = correlationId ?? randomId('corr');
    const expires = now + this.policy.absoluteTimeoutMs;
    await run(this.db, `INSERT INTO nems_sessions (id, tenant_id, user_id, device, correlation_id, created_at, last_seen_at, expires_at, revoked) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,FALSE)`, [id, tenantId, userId, deviceId ?? null, cid, now, expires]);
    return { id, tenantId, userId, device: deviceId ?? null, correlationId: cid, createdAt: now, lastSeenAt: now, expiresAt: expires, revoked: false };
  }

  async getSession(id: string): Promise<Session | undefined> {
    const r = await one<SessRow>(this.db, `SELECT * FROM nems_sessions WHERE id=$1`, [id]);
    return r ? mapSess(r) : undefined;
  }

  async validate(sessionId: string): Promise<SessionValidation> {
    const s = await this.getSession(sessionId);
    if (!s) return { valid: false, reason: 'not-found' };
    if (s.revoked) return { valid: false, reason: 'revoked' };
    const now = this.clock.now();
    if (now - s.lastSeenAt > this.policy.idleTimeoutMs) return { valid: false, reason: 'idle-timeout' };
    if (now > s.expiresAt) return { valid: false, reason: 'absolute-timeout' };
    await run(this.db, `UPDATE nems_sessions SET last_seen_at=$2 WHERE id=$1`, [sessionId, now]);
    return { valid: true, reason: 'ok', session: { ...s, lastSeenAt: now } };
  }

  async logout(sessionId: string): Promise<void> {
    const s = await this.getSession(sessionId);
    if (!s) return;
    await run(this.db, `UPDATE nems_sessions SET revoked=TRUE WHERE id=$1`, [sessionId]);
    const ctx: MutationContext = { tenantId: s.tenantId, actorId: s.userId, sessionId };
    this.gov.audit.record({ ctx, entity: 'session', entityId: sessionId, operation: 'logout' });
    await this.gov.events.publish('nems.session.ended', ctx, { sessionId });
  }

  /** Device sessions for a user (active, most recent first). */
  async deviceSessions(tenantId: string, userId: string): Promise<Session[]> {
    return (await many<SessRow>(this.db, `SELECT * FROM nems_sessions WHERE tenant_id=$1 AND user_id=$2 AND revoked=FALSE ORDER BY last_seen_at DESC`, [tenantId, userId])).map(mapSess);
  }
  async revokeAll(tenantId: string, userId: string): Promise<number> {
    return run(this.db, `UPDATE nems_sessions SET revoked=TRUE WHERE tenant_id=$1 AND user_id=$2 AND revoked=FALSE`, [tenantId, userId]);
  }

  // ── invitations ──
  async invite(ctx: MutationContext, input: { email: string; role: string; ttlMs?: number }): Promise<{ invitationId: string; token: string }> {
    const id = randomId('inv');
    const token = randomId('invtok');
    const at = this.clock.now();
    const expires = at + (input.ttlMs ?? 7 * 24 * 3600 * 1000);
    await run(this.db, `INSERT INTO nems_invitations (id, tenant_id, email, role, token_hash, status, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)`, [id, ctx.tenantId, input.email.toLowerCase(), input.role, sha256Hex(token), expires, at]);
    this.gov.audit.record({ ctx, entity: 'invitation', entityId: id, operation: 'create', after: { email: input.email, role: input.role } });
    return { invitationId: id, token };
  }
  async acceptInvitation(tenantId: string, token: string, input: { password: string; displayName: string }): Promise<User> {
    const inv = await one<{ id: string; email: string; role: string; expires_at: string | number; status: string }>(this.db, `SELECT id,email,role,expires_at,status FROM nems_invitations WHERE tenant_id=$1 AND token_hash=$2`, [tenantId, sha256Hex(token)]);
    if (!inv || inv.status !== 'pending') throw new Error('invalid or already-used invitation');
    if (this.clock.now() > num(inv.expires_at)) {
      await run(this.db, `UPDATE nems_invitations SET status='expired' WHERE id=$1`, [inv.id]);
      throw new Error('invitation expired');
    }
    const user = await this.users.create({ tenantId, actorId: 'system' }, { email: inv.email, password: input.password, displayName: input.displayName, roles: [inv.role], status: 'active' });
    await run(this.db, `UPDATE nems_invitations SET status='accepted' WHERE id=$1`, [inv.id]);
    return user;
  }

  // ── password reset (in-run token; durable reset store is a refinement) ──
  async requestPasswordReset(tenantId: string, email: string): Promise<{ token: string } | undefined> {
    const cred = await this.users.credentials(tenantId, email);
    if (!cred) return undefined;
    const token = randomId('reset');
    this.resetTokens.set(sha256Hex(token), { userId: cred.id, tenantId, expiresAt: this.clock.now() + 3600 * 1000 });
    return { token };
  }
  async resetPassword(tenantId: string, token: string, newPassword: string): Promise<boolean> {
    const key = sha256Hex(token);
    const rec = this.resetTokens.get(key);
    if (!rec || rec.tenantId !== tenantId || this.clock.now() > rec.expiresAt) return false;
    const { hash, salt } = hashPassword(newPassword);
    await this.users.setPassword(rec.userId, tenantId, hash, salt);
    this.resetTokens.delete(key);
    await this.revokeAll(tenantId, rec.userId); // invalidate sessions on reset
    const ctx: MutationContext = { tenantId, actorId: rec.userId };
    this.gov.audit.record({ ctx, entity: 'user', entityId: rec.userId, operation: 'update', after: { passwordReset: true } });
    return true;
  }

  // ── MFA hooks (TOTP) ──
  async enrollMfa(ctx: MutationContext, userId: string): Promise<{ secret: string }> {
    const secret = base32Encode(randomBytes(20));
    await this.users.setMfaSecret(userId, ctx.tenantId, secret);
    this.gov.audit.record({ ctx, entity: 'user', entityId: userId, operation: 'update', after: { mfa: 'enrolled' } });
    return { secret };
  }
  async disableMfa(ctx: MutationContext, userId: string): Promise<void> {
    await this.users.setMfaSecret(userId, ctx.tenantId, null);
    this.gov.audit.record({ ctx, entity: 'user', entityId: userId, operation: 'update', after: { mfa: 'disabled' } });
  }
}
