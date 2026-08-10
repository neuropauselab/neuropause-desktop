import { describe, expect, it } from 'vitest';
import type { GraphGroup, GraphOrganization, GraphUser } from '@neuropause/shared';
import { entraAdapter, mapUser, mapGroup, mapOrganization } from './unified/sync/adapters/entra';
import type { SyncContext } from './unified/sync/adapterSdk';
import { HttpError } from './unified/sync/http';
import { makeUnifiedId } from './unified/ids';

const NOW = '2026-07-10T00:00:00.000Z';
const BASE = { tenantId: 'org-test', connectorId: 'microsoft-entra', accountId: 'acct-1', now: NOW } as const;

/** A SyncContext whose http returns a fixed Graph response (shape only — never live). */
function stubCtx(response: unknown, cursor: string | null = null): SyncContext {
  const http = {
    getJson: () => Promise.resolve({ data: response, headers: {}, status: 200 }),
    postJson: () => Promise.reject(new Error('unused')),
  } as unknown as SyncContext['http'];
  return { ...BASE, http, cursor };
}

/** A SyncContext whose http throws 410 once (expired deltaLink), then returns a fresh response. */
function stub410ThenCtx(finalResponse: unknown, cursor: string | null): SyncContext {
  let first = true;
  const http = {
    getJson: () => {
      if (first) {
        first = false;
        return Promise.reject(new HttpError(410, 'Gone', false));
      }
      return Promise.resolve({ data: finalResponse, headers: {}, status: 200 });
    },
    postJson: () => Promise.reject(new Error('unused')),
  } as unknown as SyncContext['http'];
  return { ...BASE, http, cursor };
}

const usersResource = () => entraAdapter.resources.find((r) => r.id === 'users')!;

describe('entraAdapter — mappers', () => {
  it('maps a Graph user to a contact entity with a deterministic id', () => {
    const u: GraphUser = {
      id: 'u1',
      displayName: 'Ada',
      userPrincipalName: 'ada@contoso.com',
      mail: 'ada@contoso.com',
      accountEnabled: true,
      userType: 'Member',
      createdDateTime: '2020-01-01T00:00:00Z',
    };
    const e = mapUser(stubCtx({}), u);
    expect(e.kind).toBe('contact');
    expect(e.id).toBe(makeUnifiedId('org-test', 'microsoft-entra', 'acct-1', 'contact', 'u1'));
    expect(e.title).toBe('Ada');
    expect(e.author).toBe('ada@contoso.com');
    expect(e.status).toBe('enabled');
    expect(e.metadata.directoryType).toBe('user');
    expect(e.createdAt).toBe('2020-01-01T00:00:00Z');
    expect(e.syncState).toBe('active');
  });

  it('maps a Graph group to an organization entity', () => {
    const g: GraphGroup = { id: 'g1', displayName: 'Engineering', securityEnabled: true };
    const e = mapGroup(stubCtx({}), g);
    expect(e.kind).toBe('organization');
    expect(e.id).toBe(makeUnifiedId('org-test', 'microsoft-entra', 'acct-1', 'organization', 'g1'));
    expect(e.title).toBe('Engineering');
    expect(e.metadata.directoryType).toBe('group');
    expect(e.metadata.groupClass).toBe('security');
  });

  it('maps the Graph organization to a tenant entity', () => {
    const org: GraphOrganization = {
      id: 'tid-1',
      displayName: 'Contoso',
      verifiedDomains: [{ name: 'contoso.com', isDefault: true }],
    };
    const e = mapOrganization(stubCtx({}), org);
    expect(e.kind).toBe('organization');
    expect(e.title).toBe('Contoso');
    expect(e.metadata.directoryType).toBe('tenant');
    expect(e.metadata.tenantId).toBe('tid-1');
    expect(e.metadata.defaultDomain).toBe('contoso.com');
  });
});

describe('entraAdapter — delta paging', () => {
  it('pages users then captures the deltaLink; removed users become deletes', async () => {
    const users = usersResource();
    const p1 = await users.pull(
      stubCtx(
        {
          value: [
            { id: 'u1', displayName: 'A' },
            { id: 'u2', '@removed': { reason: 'deleted' } },
          ],
          '@odata.nextLink': 'NEXT',
        },
        null,
      ),
    );
    expect(p1.entities.map((e) => e.sourceId)).toEqual(['u1']);
    expect(p1.deletedSourceIds).toEqual(['u2']);
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string)).toEqual({ next: 'NEXT' });

    const p2 = await users.pull(
      stubCtx({ value: [{ id: 'u3', displayName: 'C' }], '@odata.deltaLink': 'DELTA' }, p1.cursor),
    );
    expect(p2.entities.map((e) => e.sourceId)).toEqual(['u3']);
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string)).toEqual({ delta: 'DELTA' });
  });

  it('recovers from an expired deltaLink (410) with a full resync', async () => {
    const users = usersResource();
    const page = await users.pull(
      stub410ThenCtx(
        { value: [{ id: 'u1', displayName: 'A' }], '@odata.deltaLink': 'FRESH' },
        JSON.stringify({ delta: 'STALE' }),
      ),
    );
    expect(page.entities.map((e) => e.sourceId)).toEqual(['u1']);
    expect(JSON.parse(page.cursor as string)).toEqual({ delta: 'FRESH' });
  });
});

describe('entraAdapter — registration', () => {
  it('declares the users/groups/organization directory resources first', () => {
    expect(entraAdapter.connectorId).toBe('microsoft-entra');
    // Directory resources lead; the Microsoft 365 resources (mail/calendar/drive/contacts/teams) are
    // appended on the same connector/token in P2.3.
    expect(entraAdapter.resources.map((r) => r.id).slice(0, 3)).toEqual(['users', 'groups', 'organization']);
    expect(entraAdapter.resources.map((r) => r.kind).slice(0, 3)).toEqual(['contact', 'organization', 'organization']);
    expect(entraAdapter.resources.map((r) => r.id)).toEqual(
      expect.arrayContaining(['mail', 'calendar', 'drive', 'contacts', 'teams']),
    );
  });
});
