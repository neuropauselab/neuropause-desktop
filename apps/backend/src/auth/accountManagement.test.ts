/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory database state for testing.
const users: any[] = [];
const identities: any[] = [];
const sessions: any[] = [];
const memberships: any[] = [];
const devices: any[] = [];
const auditLog: any[] = [];
const deletionRequests: any[] = [];

let nextId = 1;

vi.mock('../db/pool', () => {
  const fakeClient = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM account_deletion_requests') && sql.includes('FOR UPDATE')) {
        const found = deletionRequests.find(
          (r: any) => r.id === params![0] && r.user_id === params![1] && r.status === 'pending',
        );
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('UPDATE account_deletion_requests SET status = \'executed\'')) {
        const req = deletionRequests.find((r: any) => r.id === params![0]);
        if (req) req.status = 'executed';
        return { rows: [] };
      }
      if (sql.includes('UPDATE auth_sessions SET revoked_at')) {
        sessions.forEach((s: any) => {
          if (s.user_id === params![0]) s.revoked_at = new Date();
        });
        return { rows: [] };
      }
      if (sql.includes('DELETE FROM devices')) {
        const idx = devices.findIndex((d: any) => d.user_id === params![0]);
        if (idx >= 0) devices.splice(idx, 1);
        return { rows: [] };
      }
      if (sql.includes('DELETE FROM auth_identities')) {
        const idx = identities.findIndex((i: any) => i.user_id === params![0]);
        if (idx >= 0) identities.splice(idx, 1);
        return { rows: [] };
      }
      if (sql.includes('DELETE FROM auth_tokens')) return { rows: [] };
      if (sql.includes('DELETE FROM sync_state')) return { rows: [] };
      if (sql.includes('UPDATE users SET')) {
        const user = users.find((u: any) => u.id === params![0]);
        if (user) {
          user.email = params![1];
          user.display_name = null;
          user.password_hash = null;
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE audit_log')) return { rows: [] };
      return { rows: [] };
    }),
  };

  return {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM users WHERE id')) {
        const found = users.find((u: any) => u.id === params![0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('FROM auth_identities')) {
        return { rows: identities.filter((i: any) => i.user_id === params![0]) };
      }
      if (sql.includes('FROM auth_sessions')) {
        return { rows: sessions.filter((s: any) => s.user_id === params![0]) };
      }
      if (sql.includes('FROM org_members')) {
        return { rows: memberships.filter((m: any) => m.user_id === params![0]) };
      }
      if (sql.includes('FROM devices')) {
        return { rows: devices.filter((d: any) => d.user_id === params![0]) };
      }
      if (sql.includes('FROM audit_log')) {
        return { rows: auditLog.filter((a: any) => a.user_id === params![0]) };
      }
      if (sql.includes('FROM sync_state')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE account_deletion_requests SET status = \'cancelled\'')) {
        deletionRequests.forEach((r: any) => {
          if (r.user_id === params![0] && r.status === 'pending') r.status = 'cancelled';
        });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO account_deletion_requests')) {
        const req = {
          id: `del-${nextId++}`,
          user_id: params![0],
          reason: params![1],
          status: 'pending',
          requested_at: new Date(),
        };
        deletionRequests.push(req);
        return { rows: [req] };
      }
      return { rows: [] };
    }),
    withTransaction: vi.fn(async (fn: any) => fn(fakeClient)),
  };
});

vi.mock('./jwt', () => ({
  revokeAllAccessTokensForUser: vi.fn(),
}));

vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { exportUserData, requestAccountDeletion, confirmAccountDeletion } from './accountManagement';

describe('accountManagement', () => {
  beforeEach(() => {
    users.length = 0;
    identities.length = 0;
    sessions.length = 0;
    memberships.length = 0;
    devices.length = 0;
    auditLog.length = 0;
    deletionRequests.length = 0;
    nextId = 1;
  });

  describe('exportUserData', () => {
    it('returns the authenticated user\'s data', async () => {
      users.push({
        id: 'user-1',
        email: 'alice@example.com',
        display_name: 'Alice',
        email_verified: true,
        created_at: new Date('2026-01-01'),
      });
      identities.push({ user_id: 'user-1', provider: 'google', provider_user_id: 'g-1', email: 'alice@example.com' });

      const data = await exportUserData('user-1');
      expect(data.user.email).toBe('alice@example.com');
      expect(data.identities).toHaveLength(1);
      expect(data.identities[0].provider).toBe('google');
    });

    it('does not include another user\'s data', async () => {
      users.push({
        id: 'user-1',
        email: 'alice@example.com',
        display_name: 'Alice',
        email_verified: true,
        created_at: new Date('2026-01-01'),
      });
      users.push({
        id: 'user-2',
        email: 'bob@example.com',
        display_name: 'Bob',
        email_verified: false,
        created_at: new Date('2026-01-02'),
      });
      identities.push({ user_id: 'user-2', provider: 'github', provider_user_id: 'gh-2', email: 'bob@example.com' });

      const data = await exportUserData('user-1');
      expect(data.user.email).toBe('alice@example.com');
      expect(data.identities).toHaveLength(0); // user-2's identity not included
    });

    it('throws for a non-existent user', async () => {
      await expect(exportUserData('nonexistent')).rejects.toThrow('User not found');
    });
  });

  describe('requestAccountDeletion', () => {
    it('creates a pending deletion request', async () => {
      const result = await requestAccountDeletion('user-1', 'No longer needed');
      expect(result.status).toBe('pending');
      expect(result.requestId).toBeTruthy();
    });
  });

  describe('confirmAccountDeletion', () => {
    it('executes deletion for a valid pending request', async () => {
      users.push({ id: 'user-1', email: 'alice@example.com' });
      deletionRequests.push({
        id: 'del-99',
        user_id: 'user-1',
        status: 'pending',
        requested_at: new Date(),
      });

      const result = await confirmAccountDeletion('user-1', 'del-99');
      expect(result.executed).toBe(true);
    });

    it('returns executed=false for a non-existent request', async () => {
      const result = await confirmAccountDeletion('user-1', 'nonexistent');
      expect(result.executed).toBe(false);
    });

    it('returns executed=false for another user\'s request', async () => {
      deletionRequests.push({
        id: 'del-88',
        user_id: 'user-2',
        status: 'pending',
        requested_at: new Date(),
      });

      const result = await confirmAccountDeletion('user-1', 'del-88');
      expect(result.executed).toBe(false);
    });
  });
});
