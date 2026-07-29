/**
 * Session Management (NCEA 14.0, Phase 2/9). Server-side sessions with an idle
 * timeout AND an absolute timeout, rotation (a new id on privilege change,
 * invalidating the old), revocation (single + all-for-identity), and optional
 * device binding. `validate()` enforces both timeouts and slides the idle window
 * on success. Lifecycle events are audited.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SecurityAudit } from './audit';

export interface SessionPolicy {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = { idleTimeoutMs: 30 * 60 * 1000, absoluteTimeoutMs: 12 * 60 * 60 * 1000 };

export interface Session {
  id: string;
  identityId: string;
  tenant: string;
  deviceId?: string;
  createdAt: number;
  lastSeenAt: number;
  revoked: boolean;
  rotatedFrom?: string;
}

export interface SessionValidation {
  valid: boolean;
  reason?: 'ok' | 'not-found' | 'revoked' | 'idle-timeout' | 'absolute-timeout';
  session?: Session;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly clock: Clock,
    private readonly audit: SecurityAudit,
    private readonly policy: SessionPolicy = DEFAULT_SESSION_POLICY,
  ) {}

  async create(input: { identityId: string; tenant: string; deviceId?: string }): Promise<Session> {
    const now = this.clock.now();
    const session: Session = {
      id: randomId('sess'),
      identityId: input.identityId,
      tenant: input.tenant,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      createdAt: now,
      lastSeenAt: now,
      revoked: false,
    };
    this.sessions.set(session.id, session);
    await this.audit.record({ category: 'session', action: 'create', actor: input.identityId, tenant: input.tenant, target: session.id });
    return session;
  }

  validate(id: string): SessionValidation {
    const session = this.sessions.get(id);
    if (!session) return { valid: false, reason: 'not-found' };
    if (session.revoked) return { valid: false, reason: 'revoked' };
    const now = this.clock.now();
    if (now - session.lastSeenAt > this.policy.idleTimeoutMs) return { valid: false, reason: 'idle-timeout' };
    if (now - session.createdAt > this.policy.absoluteTimeoutMs) return { valid: false, reason: 'absolute-timeout' };
    session.lastSeenAt = now; // slide the idle window
    return { valid: true, reason: 'ok', session };
  }

  /** Rotate on privilege change: mint a new id bound to the same identity, revoke the old. */
  async rotate(id: string): Promise<Session> {
    const current = this.sessions.get(id);
    if (!current) throw new Error(`session '${id}' not found`);
    current.revoked = true;
    const now = this.clock.now();
    const next: Session = { ...current, id: randomId('sess'), createdAt: now, lastSeenAt: now, revoked: false, rotatedFrom: id };
    this.sessions.set(next.id, next);
    await this.audit.record({ category: 'session', action: 'rotate', actor: current.identityId, tenant: current.tenant, target: next.id, meta: { from: id } });
    return next;
  }

  async revoke(id: string, actor = 'system'): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.revoked = true;
    await this.audit.record({ category: 'session', action: 'revoke', actor, target: id });
  }

  async revokeAllFor(identityId: string, actor = 'system'): Promise<number> {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.identityId === identityId && !s.revoked) {
        s.revoked = true;
        n += 1;
      }
    }
    await this.audit.record({ category: 'session', action: 'revoke.all', actor, target: identityId, meta: { count: n } });
    return n;
  }

  active(): Session[] {
    return [...this.sessions.values()].filter((s) => !s.revoked);
  }
}
