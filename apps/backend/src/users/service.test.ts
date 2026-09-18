import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules that would trigger env validation (we only test pure user logic).
vi.mock('../config/env', () => ({
  loadEnv: () => ({}),
  env: new Proxy({}, { get: () => '' }),
}));
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// In-memory state for the test database.
const users: Array<{
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}> = [];
const identities: Array<{
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
}> = [];

let nextId = 1;

// Mock the database pool with an in-memory implementation.
vi.mock('../db/pool', () => {
  const fakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO users')) {
        const id = `user-${nextId++}`;
        const row = {
          id,
          email: params![0] as string,
          display_name: (params![1] as string) ?? null,
          avatar_url: (params![2] as string) ?? null,
          password_hash: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        users.push(row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO auth_identities')) {
        identities.push({
          user_id: params![0] as string,
          provider: params![1] as string,
          provider_user_id: params![2] as string,
          email: (params![3] as string) ?? null,
        });
        return { rows: [] };
      }
      if (sql.includes('SELECT id FROM users WHERE email')) {
        const found = users.find(
          (u) => u.email.toLowerCase() === (params![0] as string).toLowerCase(),
        );
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (sql.includes('SELECT * FROM users WHERE id')) {
        const found = users.find((u) => u.id === params![0]);
        return { rows: found ? [found] : [] };
      }
      return { rows: [] };
    }),
  };

  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM users u') && sql.includes('JOIN auth_identities')) {
        const identity = identities.find(
          (i) => i.provider === params![0] && i.provider_user_id === params![1],
        );
        if (!identity) return { rows: [] };
        const user = users.find((u) => u.id === identity.user_id);
        return { rows: user ? [user] : [] };
      }
      return fakeClient.query(sql, params);
    }),
    withTransaction: vi.fn(async (fn: (client: typeof fakeClient) => Promise<unknown>) => {
      return fn(fakeClient);
    }),
  };
});

import { resolveOAuthUser } from './service';

describe('resolveOAuthUser', () => {
  beforeEach(() => {
    users.length = 0;
    identities.length = 0;
    nextId = 1;
  });

  it('creates a new account for a new OAuth user', async () => {
    const result = await resolveOAuthUser('google', {
      providerUserId: 'g-123',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatarUrl: null,
    });
    expect(result.isNew).toBe(true);
    expect(result.user.email).toBe('alice@example.com');
    expect(identities).toHaveLength(1);
    expect(identities[0].provider).toBe('google');
  });

  it('returns existing user when the same provider identity logs in again', async () => {
    const first = await resolveOAuthUser('google', {
      providerUserId: 'g-123',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatarUrl: null,
    });
    const second = await resolveOAuthUser('google', {
      providerUserId: 'g-123',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatarUrl: null,
    });
    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('does NOT auto-link a new OAuth identity to an existing account by email (account takeover prevention)', async () => {
    // First: create a user via one provider (e.g., email/password or Google).
    const victim = await resolveOAuthUser('google', {
      providerUserId: 'g-victim',
      email: 'victim@example.com',
      displayName: 'Victim',
      avatarUrl: null,
    });

    // Attacker registers with a different provider claiming the same email.
    const attacker = await resolveOAuthUser('github', {
      providerUserId: 'gh-attacker',
      email: 'victim@example.com',
      displayName: 'Attacker',
      avatarUrl: null,
    });

    // Critical assertion: the attacker gets a SEPARATE account, not the victim's.
    expect(attacker.user.id).not.toBe(victim.user.id);
    expect(attacker.isNew).toBe(true);
    // The attacker's account uses a provider-scoped placeholder email.
    expect(attacker.user.email).toContain('users.neuropause.local');
  });

  it('handles a provider profile with no email', async () => {
    const result = await resolveOAuthUser('github', {
      providerUserId: 'gh-no-email',
      email: null,
      displayName: 'NoEmail',
      avatarUrl: null,
    });
    expect(result.isNew).toBe(true);
    expect(result.user.email).toBe('github_gh-no-email@users.neuropause.local');
  });
});
