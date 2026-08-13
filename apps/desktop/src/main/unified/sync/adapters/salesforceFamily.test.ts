import { makeUnifiedId } from '../../ids';
/**
 * P5 — Increment 8: the Salesforce connector FAMILY (Accounts, Contacts, Leads, Opportunities, Cases,
 * Campaigns, Products, Users, Tasks, Events on one `salesforce` connector). Pure-node, fake HttpClient.
 * Covers family composition, instance_url + queryable-object resolution (userinfo → describeGlobal →
 * cached in the cursor), graceful degradation (403 unauthorized; a non-queryable object degrades as
 * unprovisioned WITHOUT ever issuing the 400-INVALID_TYPE query), the mappers (kinds, container links,
 * SF-id uniqueness, timestamp normalization), the uniform SOQL SystemModstamp high-water pull
 * (ASC, nextRecordsUrl within-run paging, MAX_PAGES cap → leapfrog-free resume), and the service catalog.
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import {
  salesforceAdapter,
  SALESFORCE_SERVICES,
  mapAccount,
  mapContact,
  mapLead,
  mapOpportunity,
  mapCase,
  mapCampaign,
  mapProduct,
  mapUser,
  mapTask,
  mapEvent,
} from './salesforce';

const INSTANCE = 'https://acme.my.salesforce.com';
const ALL_OBJECTS = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Campaign', 'Product2', 'User', 'Task', 'Event'];
const NOW = '2026-07-13T00:00:00.000Z';
const baseCtx = { tenantId: 'org-test', connectorId: 'salesforce', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };
/** A cursor with the env pre-resolved (fresh `resolvedAt`), so a resource test skips userinfo + describeGlobal. */
const enved = (extra: Record<string, unknown> = {}, objects: string[] = ALL_OBJECTS): string =>
  JSON.stringify({ env: { instance: INSTANCE, objects, resolvedAt: NOW }, ...extra });

/** ctx whose http replays a body per URL (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => unknown, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        return Promise.resolve({ data: handler(url, opts), headers: {}, status: 200 });
      } catch (err) {
        return Promise.reject(err);
      }
    },
  } as unknown as SyncContext['http'];
  return { ...baseCtx, http, cursor };
}
const rejecting = (err: Error, cursor: string | null): SyncContext => ({
  ...baseCtx,
  http: { getJson: () => Promise.reject(err) } as unknown as SyncContext['http'],
  cursor,
});

const accountsR = salesforceAdapter.resources.find((r) => r.id === 'salesforce_accounts')!;
const casesR = salesforceAdapter.resources.find((r) => r.id === 'salesforce_cases')!;

describe('Salesforce family — composition, instance + capability resolution & graceful', () => {
  it('is ONE connector with every CRM object mounted as a service resource', () => {
    expect(salesforceAdapter.connectorId).toBe('salesforce');
    expect(salesforceAdapter.resources.map((r) => r.id)).toEqual([
      'salesforce_accounts', 'salesforce_contacts', 'salesforce_leads', 'salesforce_opportunities',
      'salesforce_cases', 'salesforce_campaigns', 'salesforce_products', 'salesforce_users',
      'salesforce_tasks', 'salesforce_events',
    ]);
  });

  it('resolves instance_url (userinfo origin) + queryable objects (describeGlobal) and caches env in the cursor', async () => {
    const ctx = routed((url) => {
      if (url.includes('/services/oauth2/userinfo')) {
        // urls.rest carries a literal `{version}` placeholder → only its origin is the instance.
        return { urls: { rest: 'https://acme.my.salesforce.com/services/data/v{version}/' } };
      }
      if (url.endsWith('/services/data/v59.0/sobjects/')) {
        return { sobjects: [{ name: 'Account', queryable: true }, { name: 'Case', queryable: false }] };
      }
      if (url.includes('/services/data/v59.0/query')) {
        return { records: [{ Id: '001', Name: 'Acme', SystemModstamp: '2026-07-10T00:00:00.000+0000' }], done: true };
      }
      throw new Error(`unexpected ${url}`);
    }, null);
    const page = await accountsR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['001']);
    const env = JSON.parse(page.cursor as string).env;
    expect(env.instance).toBe(INSTANCE); // origin extracted despite the {version} placeholder
    expect(env.objects).toContain('Account');
    expect(env.objects).not.toContain('Case'); // queryable:false filtered out
    expect(env.resolvedAt).toBe(NOW); // stamped so it can be re-resolved after the TTL
  });

  it('re-resolves the env once the cache is older than the TTL, so a newly-queryable object is picked up live', async () => {
    let describeCalls = 0;
    const ctx = routed((url) => {
      if (url.includes('/services/oauth2/userinfo')) return { urls: { rest: 'https://acme.my.salesforce.com/services/data/v{version}/' } };
      if (url.endsWith('/sobjects/')) { describeCalls += 1; return { sobjects: [{ name: 'Account', queryable: true }] }; }
      if (url.includes('/query')) return { records: [], done: true };
      throw new Error(`unexpected ${url}`);
    }, JSON.stringify({ env: { instance: INSTANCE, objects: [], resolvedAt: '2020-01-01T00:00:00.000Z' } }));
    const page = await accountsR.pull(ctx);
    expect(describeCalls).toBe(1); // stale env → re-resolved rather than trusted forever
    const env = JSON.parse(page.cursor as string).env;
    expect(env.objects).toContain('Account'); // capability discovery stays live
    expect(env.resolvedAt).toBe(NOW);
  });

  it('a non-queryable object degrades as unprovisioned WITHOUT issuing the query (no 400 INVALID_TYPE escapes)', async () => {
    // env has Case excluded → the preflight must short-circuit; the throwing http proves no call is made.
    const page = await casesR.pull(rejecting(new Error('http must not be called'), enved({}, ['Account'])));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned');
  });

  it('graceful — a 403 on the query degrades the SERVICE as unauthorized, not the family', async () => {
    const page = await accountsR.pull(rejecting(new AuthError('forbidden', 403), enved()));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('a rate limit / 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(accountsR.pull(rejecting(new HttpError(500, 'server error', true), enved()))).rejects.toThrow();
  });
});

describe('Salesforce mappers', () => {
  it('maps an Account → organization with a Lightning URL and SF type', () => {
    const e = mapAccount(pureCtx, INSTANCE, { Id: '001AA', Name: 'Acme', Industry: 'Tech', SystemModstamp: '2026-07-01T00:00:00.000+0000' });
    expect(e.kind).toBe('organization');
    expect(e.id).toBe(makeUnifiedId('org-test', 'salesforce', 'a1', 'organization', '001AA'));
    expect(e.url).toBe('https://acme.my.salesforce.com/lightning/r/Account/001AA/view');
    expect(e.metadata.sfType).toBe('Account');
  });

  it('maps a Contact → contact, linked to its Account (organization) container, with a normalized (Z) timestamp', () => {
    const e = mapContact(pureCtx, INSTANCE, {
      Id: '003BB', Name: 'Ada Byron', Email: 'ada@acme.com', AccountId: '001AA',
      LastModifiedDate: '2026-07-02T10:00:00.000+0000', CreatedDate: '2026-06-01T00:00:00.000+0000',
    });
    expect(e.kind).toBe('contact');
    expect(e.containerId).toBe(makeUnifiedId('org-test', 'salesforce', 'a1', 'organization', '001AA')); // Contact.AccountId → Account (organization)
    expect(e.updatedAt).toBe('2026-07-02T10:00:00.000Z'); // +0000 normalized to Z
    expect(e.metadata.email).toBe('ada@acme.com');
  });

  it('maps a Lead and a User → contact, disambiguated by sfType', () => {
    const lead = mapLead(pureCtx, INSTANCE, { Id: '00Q1', Name: 'Grace Hopper', Company: 'Navy', Status: 'Open' });
    const user = mapUser(pureCtx, INSTANCE, { Id: '005X', Name: 'Sales Rep', Username: 'rep@acme.com', IsActive: true });
    expect(lead.kind).toBe('contact');
    expect(lead.metadata.sfType).toBe('Lead');
    expect(user.kind).toBe('contact');
    expect(user.metadata.sfType).toBe('User');
    expect(lead.id).not.toBe(user.id);
  });

  it('maps an Opportunity → task linked to its Account, preserving amount/stage as scalar metadata', () => {
    const e = mapOpportunity(pureCtx, INSTANCE, { Id: '006OP', Name: 'Big Deal', StageName: 'Prospecting', Amount: 50000, AccountId: '001AA', CloseDate: '2026-09-01', IsWon: false });
    expect(e.kind).toBe('task');
    expect(e.status).toBe('Prospecting');
    expect(e.containerId).toBe(makeUnifiedId('org-test', 'salesforce', 'a1', 'organization', '001AA'));
    expect(e.metadata.amount).toBe(50000); // numeric scalar preserved
    expect(e.metadata.isWon).toBe(false);
  });

  it('maps a Case → task, a Campaign → project, a Product → document', () => {
    const c = mapCase(pureCtx, INSTANCE, { Id: '500C', Subject: 'Login broken', Status: 'New', CaseNumber: '00001234', AccountId: '001AA' });
    expect(c.kind).toBe('task');
    expect(c.containerId).toBe(makeUnifiedId('org-test', 'salesforce', 'a1', 'organization', '001AA'));
    const camp = mapCampaign(pureCtx, INSTANCE, { Id: '701K', Name: 'Summer Launch', Status: 'In Progress' });
    expect(camp.kind).toBe('project');
    const prod = mapProduct(pureCtx, INSTANCE, { Id: '01t9', Name: 'Widget', ProductCode: 'W-1', IsActive: true });
    expect(prod.kind).toBe('document');
  });

  it('maps a Task → task and an Event → calendar_event with start/end timestamps', () => {
    const t = mapTask(pureCtx, INSTANCE, { Id: '00T1', Subject: 'Call back', Status: 'Not Started', ActivityDate: '2026-07-15' });
    expect(t.kind).toBe('task');
    const ev = mapEvent(pureCtx, INSTANCE, { Id: '00U1', Subject: 'Demo', StartDateTime: '2026-07-15T15:00:00.000+0000', EndDateTime: '2026-07-15T16:00:00.000+0000' });
    expect(ev.kind).toBe('calendar_event');
    expect(ev.timestamp).toBe('2026-07-15T15:00:00.000Z');
    expect(ev.endTimestamp).toBe('2026-07-15T16:00:00.000Z');
  });
});

describe('Salesforce pulls — SOQL SystemModstamp high-water (ASC, leapfrog-free)', () => {
  it('first sync: no WHERE filter, ORDER BY SystemModstamp ASC, commits the newest high-water on drain', async () => {
    let seenSoql = '';
    const ctx = routed((url, opts) => {
      if (url.includes('/query')) {
        seenSoql = String(opts?.query?.q);
        return { records: [{ Id: '001', Name: 'A', SystemModstamp: '2026-07-10T00:00:00.000+0000' }], done: true };
      }
      throw new Error(url);
    }, enved());
    const page = await accountsR.pull(ctx);
    expect(seenSoql).not.toContain('WHERE');
    expect(seenSoql).toContain('FROM Account');
    expect(seenSoql).toContain('ORDER BY SystemModstamp ASC, Id ASC'); // Id tiebreak → deterministic paging
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-10T00:00:00.000+0000'); // raw newest committed
  });

  it('incremental: filters WHERE SystemModstamp >= the high-water (unquoted, second-precision UTC literal)', async () => {
    let seenSoql = '';
    const ctx = routed((url, opts) => {
      seenSoql = String(opts?.query?.q);
      return { records: [{ Id: '002', SystemModstamp: '2026-07-11T09:00:00.000+0000' }], done: true };
    }, enved({ hw: '2026-07-05T08:15:20.500+0000' }));
    await accountsR.pull(ctx);
    expect(seenSoql).toContain('WHERE SystemModstamp >= 2026-07-05T08:15:20Z'); // millis truncated, Z, unquoted
    expect(seenSoql).toContain('ORDER BY SystemModstamp ASC, Id ASC');
  });

  it('within a run it follows nextRecordsUrl (relative → prefixed with the instance), tagged with the run clock', async () => {
    const p1 = await accountsR.pull(routed((url) => {
      expect(url).toContain('/services/data/v59.0/query');
      return { records: [{ Id: '1', SystemModstamp: '2026-07-18T00:00:00.000+0000' }], done: false, nextRecordsUrl: '/services/data/v59.0/query/01g-2000' };
    }, enved()));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.next).toBe('/services/data/v59.0/query/01g-2000');
    expect(c1.runAt).toBe(NOW); // locator tagged with the run that minted it
    expect(c1.pending).toBe('2026-07-18T00:00:00.000+0000');
    expect(c1.hw).toBeUndefined(); // not committed mid-walk

    const p2 = await accountsR.pull(routed((url) => {
      expect(url).toBe(`${INSTANCE}/services/data/v59.0/query/01g-2000`); // locator resolved against the instance
      return { records: [{ Id: '2', SystemModstamp: '2026-07-20T00:00:00.000+0000' }], done: true };
    }, p1.cursor)); // same-run ctx (now === NOW) → the locator is followed
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe('2026-07-20T00:00:00.000+0000'); // newest across the walk
  });

  it('a locator left by a PRIOR run (runAt ≠ now) is NEVER replayed — it rebuilds from the high-water (no dead-session wedge)', async () => {
    let calledUrl = '';
    let seenSoql = '';
    const ctx = routed((url, opts) => {
      calledUrl = url;
      seenSoql = String(opts?.query?.q ?? '');
      return { records: [{ Id: 'r', SystemModstamp: '2026-07-30T00:00:00.000+0000' }], done: true };
    }, enved({ hw: '2026-07-02T00:00:00.000+0000', next: '/services/data/v59.0/query/STALE-2000', runAt: '2020-01-01T00:00:00.000Z', page: 5 }));
    const page = await accountsR.pull(ctx);
    // The stale session locator must NOT be GET; the walk rebuilds a fresh SOQL query from the high-water.
    expect(calledUrl).toContain('/services/data/v59.0/query');
    expect(calledUrl).not.toContain('STALE');
    expect(seenSoql).toContain('WHERE SystemModstamp >= 2026-07-02T00:00:00Z');
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-30T00:00:00.000+0000');
  });

  it('at the MAX_PAGES cap it commits the high-water and drops the locator — the SOQL resumes next run (NO leapfrog)', async () => {
    // Within the run (runAt === now) at page 9 → page+1 (10) is not < MAX_PAGES (10), so it caps even WITH a live locator.
    const page = await accountsR.pull(routed(() => ({
      records: [{ Id: '9', SystemModstamp: '2026-07-25T00:00:00.000+0000' }], done: false, nextRecordsUrl: '/services/data/v59.0/query/MORE-2000',
    }), enved({ hw: '2026-07-01T00:00:00.000+0000', next: '/services/data/v59.0/query/PREV-2000', runAt: NOW, page: 9 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe('2026-07-25T00:00:00.000+0000'); // committed → next run's `SystemModstamp >= this` resumes forward
    expect(c.next).toBeUndefined(); // locator dropped; the high-water (not the ephemeral locator) drives resumption
  });
});

describe('Salesforce capability discovery (runtime-driven)', () => {
  it('the service catalog ids match the adapter resource ids (so live counts appear per service)', () => {
    expect(SALESFORCE_SERVICES.map((s) => s.id)).toEqual(salesforceAdapter.resources.map((r) => r.id));
  });

  it('every service maps to a concrete SOQL object + UDM kind', () => {
    const byId = Object.fromEntries(SALESFORCE_SERVICES.map((s) => [s.id, s]));
    expect(byId.salesforce_accounts.object).toBe('Account');
    expect(byId.salesforce_accounts.kind).toBe('organization');
    expect(byId.salesforce_events.kind).toBe('calendar_event');
  });
});
