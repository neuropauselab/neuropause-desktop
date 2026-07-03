import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryConnectorAccountRepository } from './memoryRepository';
import type { ConnectorAccountRepository } from './types';
import {
  ConnectorAccountError,
  listOrgConnectorAccounts,
  listUserConnectorAccounts,
  recordConnectorAccount,
  revokeConnectorAccount,
} from './service';

let repo: ConnectorAccountRepository;
beforeEach(() => {
  repo = createMemoryConnectorAccountRepository();
});

const base = { orgId: 'org-1', userId: 'user-1' };

describe('recordConnectorAccount', () => {
  it('records a connected account', async () => {
    const acct = await recordConnectorAccount(repo, {
      ...base,
      provider: 'GitHub',
      externalAccountId: 'gh-123',
      displayName: 'octocat',
    });
    expect(acct.provider).toBe('github'); // normalized
    expect(acct.status).toBe('connected');
    expect(acct.displayName).toBe('octocat');
  });

  it('upserts on reconnect rather than duplicating', async () => {
    const first = await recordConnectorAccount(repo, {
      ...base,
      provider: 'github',
      displayName: 'old',
    });
    const second = await recordConnectorAccount(repo, {
      ...base,
      provider: 'github',
      displayName: 'new',
    });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('new');
    expect(await listUserConnectorAccounts(repo, base.orgId, base.userId)).toHaveLength(1);
  });

  it('keeps different providers as separate accounts', async () => {
    await recordConnectorAccount(repo, { ...base, provider: 'github' });
    await recordConnectorAccount(repo, { ...base, provider: 'notion' });
    expect(await listUserConnectorAccounts(repo, base.orgId, base.userId)).toHaveLength(2);
  });

  it('rejects an empty provider', async () => {
    await expect(recordConnectorAccount(repo, { ...base, provider: '  ' })).rejects.toMatchObject({
      name: 'ConnectorAccountError',
      code: 'invalid',
    });
  });
});

describe('listing', () => {
  it('lists an org’s accounts across users, and filters by user', async () => {
    await recordConnectorAccount(repo, { orgId: 'org-1', userId: 'user-1', provider: 'github' });
    await recordConnectorAccount(repo, { orgId: 'org-1', userId: 'user-2', provider: 'slack' });
    expect(await listOrgConnectorAccounts(repo, 'org-1')).toHaveLength(2);
    expect(await listUserConnectorAccounts(repo, 'org-1', 'user-1')).toHaveLength(1);
  });
});

describe('revokeConnectorAccount', () => {
  it('marks an account revoked', async () => {
    const acct = await recordConnectorAccount(repo, { ...base, provider: 'slack' });
    const revoked = await revokeConnectorAccount(repo, acct.id);
    expect(revoked.status).toBe('revoked');
  });

  it('throws for an unknown account', async () => {
    await expect(revokeConnectorAccount(repo, 'nope')).rejects.toBeInstanceOf(
      ConnectorAccountError,
    );
  });
});
