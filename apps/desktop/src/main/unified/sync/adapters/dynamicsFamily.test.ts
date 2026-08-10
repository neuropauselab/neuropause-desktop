import { makeUnifiedId } from '../../ids';
/**
 * P5 — Increment 13: the Microsoft Dynamics 365 connector FAMILY (Accounts, Contacts, Leads, Opportunities,
 * Cases, Products, Sales Orders, Purchase Orders, Invoices, Projects, Assets, Users on one `dynamics365`
 * connector). Pure-node, fake HttpClient. Covers family composition, the uniform Dataverse OData v4 pull
 * (modifiedon `ge` high-water with the UNQUOTED ISO-Z literal, `@odata.nextLink` within-run paging followed
 * verbatim, the run-scoped nextLink guard, the MAX_PAGES cap, the saturated-instant carry), the FormattedValue
 * annotations, the deep-link urls, the 400/403/404 degrade, the mappers (kinds, globally-unique GUID sourceIds,
 * no prefix), and graceful degradation.
 */
// dynBase() reads the Dataverse org URL from this env var at call time; set it before the pulls run.
process.env.NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL = 'https://myorg.crm.dynamics.com';

import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import { MANIFEST_BY_ID } from '../../../connectors/manifests';
import {
  dynamicsAdapter,
  DYNAMICS_SERVICES,
  mapAccount,
  mapContact,
  mapLead,
  mapOpportunity,
  mapCase,
  mapProduct,
  mapSalesOrder,
  mapPurchaseOrder,
  mapInvoice,
  mapProject,
  mapAsset,
  mapUser,
} from './dynamics';

const BASE = 'https://myorg.crm.dynamics.com';
const API = `${BASE}/api/data/v9.2`;
const NOW = '2026-07-13T00:00:00.000Z';
const baseCtx = { tenantId: 'org-test', connectorId: 'dynamics365', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };

interface Handled { value?: Record<string, unknown>[]; next?: string }

/** ctx whose http replays a Dataverse `{value, '@odata.nextLink'}` body (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => Handled, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        const out = handler(url, opts);
        const body: Record<string, unknown> = { value: out.value ?? [] };
        if (out.next) body['@odata.nextLink'] = out.next;
        return Promise.resolve({ data: body, headers: {}, status: 200 });
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

const byId = (id: string) => dynamicsAdapter.resources.find((r) => r.id === id)!;
const accountsR = byId('dynamics365_accounts');
const casesR = byId('dynamics365_cases');

describe('Dynamics family — composition & catalog', () => {
  it('is ONE connector with every Dataverse table mounted as a service resource', () => {
    expect(dynamicsAdapter.connectorId).toBe('dynamics365');
    expect(dynamicsAdapter.resources.map((r) => r.id)).toEqual([
      'dynamics365_accounts', 'dynamics365_contacts', 'dynamics365_leads', 'dynamics365_opportunities',
      'dynamics365_cases', 'dynamics365_products', 'dynamics365_salesorders', 'dynamics365_purchaseorders',
      'dynamics365_invoices', 'dynamics365_projects', 'dynamics365_assets', 'dynamics365_users',
    ]);
  });

  it('sends the OData version headers connector-wide (bearer token injected by the framework)', () => {
    expect(dynamicsAdapter.baseHeaders).toMatchObject({ 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' });
  });

  it('the catalog ids match the adapter resource ids, each with a concrete entity set + kind', () => {
    expect(DYNAMICS_SERVICES.map((s) => s.id)).toEqual(dynamicsAdapter.resources.map((r) => r.id));
    const m = Object.fromEntries(DYNAMICS_SERVICES.map((s) => [s.id, s]));
    expect(m.dynamics365_cases.entitySet).toBe('incidents'); // Cases = incidents
    expect(m.dynamics365_purchaseorders.entitySet).toBe('msdyn_purchaseorders'); // Field Service
    expect(m.dynamics365_projects.entitySet).toBe('msdyn_projects'); // Project Operations
    expect(m.dynamics365_accounts.kind).toBe('organization');
    expect(m.dynamics365_opportunities.kind).toBe('task');
    expect(m.dynamics365_projects.kind).toBe('project');
  });
});

describe('Dynamics mappers — kinds, GUID sourceIds (no prefix), deep links, FormattedValue', () => {
  it('maps an Account → organization with the raw GUID sourceId, a deep-link url, and the FormattedValue status', () => {
    const e = mapAccount(pureCtx, {
      accountid: 'aaaa1111-0000-0000-0000-000000000001', name: 'Acme Corp',
      statuscode: 1, 'statuscode@OData.Community.Display.V1.FormattedValue': 'Active',
      createdon: '2026-06-01T00:00:00Z', modifiedon: '2026-07-02T09:30:00Z',
    });
    expect(e.kind).toBe('organization');
    expect(e.id).toBe(makeUnifiedId('org-test', 'dynamics365', 'a1', 'organization', 'aaaa1111-0000-0000-0000-000000000001')); // GUID sourceId, no prefix
    expect(e.title).toBe('Acme Corp');
    expect(e.status).toBe('Active'); // the @OData...FormattedValue label, not the raw `1`
    expect(e.url).toBe(`${BASE}/main.aspx?pagetype=entityrecord&etn=account&id=aaaa1111-0000-0000-0000-000000000001`);
    expect(e.updatedAt).toBe('2026-07-02T09:30:00.000Z');
  });

  it('globally-unique GUIDs need no per-object prefix — the kind segment disambiguates', () => {
    const acc = mapAccount(pureCtx, { accountid: 'g1', name: 'A' });
    const con = mapContact(pureCtx, { contactid: 'g2', fullname: 'C' });
    const opp = mapOpportunity(pureCtx, { opportunityid: 'g3', name: 'O' });
    expect(acc.id).toBe(makeUnifiedId('org-test', 'dynamics365', 'a1', 'organization', 'g1'));
    expect(con.id).toBe(makeUnifiedId('org-test', 'dynamics365', 'a1', 'contact', 'g2'));
    expect(opp.id).toBe(makeUnifiedId('org-test', 'dynamics365', 'a1', 'task', 'g3'));
    expect(new Set([acc.id, con.id, opp.id]).size).toBe(3);
  });

  it('maps every remaining table to its kind and correct deep-link etn', () => {
    expect(mapLead(pureCtx, { leadid: 'l1', fullname: 'Prospect' }).kind).toBe('contact');
    expect(mapCase(pureCtx, { incidentid: 'i1', title: 'Broken' }).kind).toBe('task');
    expect(mapCase(pureCtx, { incidentid: 'i1', title: 'Broken' }).url).toBe(`${BASE}/main.aspx?pagetype=entityrecord&etn=incident&id=i1`);
    expect(mapProduct(pureCtx, { productid: 'p1', name: 'Widget' }).kind).toBe('document');
    expect(mapSalesOrder(pureCtx, { salesorderid: 'so1', name: 'SO-1' }).kind).toBe('task');
    expect(mapPurchaseOrder(pureCtx, { msdyn_purchaseorderid: 'po1', msdyn_name: 'PO-1' }).url).toBe(`${BASE}/main.aspx?pagetype=entityrecord&etn=msdyn_purchaseorder&id=po1`);
    expect(mapInvoice(pureCtx, { invoiceid: 'inv1', name: 'INV-1' }).kind).toBe('document');
    expect(mapProject(pureCtx, { msdyn_projectid: 'pr1', msdyn_subject: 'Rollout' }).kind).toBe('project');
    expect(mapProject(pureCtx, { msdyn_projectid: 'pr1', msdyn_subject: 'Rollout' }).title).toBe('Rollout'); // msdyn_subject, not msdyn_name
    expect(mapAsset(pureCtx, { msdyn_customerassetid: 'as1', msdyn_name: 'Pump 4' }).kind).toBe('document');
  });

  it('maps a User → contact, deriving enabled/disabled from isdisabled (systemuser has no statecode)', () => {
    expect(mapUser(pureCtx, { systemuserid: 'u1', fullname: 'Jane', isdisabled: false }).status).toBe('enabled');
    expect(mapUser(pureCtx, { systemuserid: 'u1', fullname: 'Jane', isdisabled: true }).status).toBe('disabled');
    expect(mapUser(pureCtx, { systemuserid: 'u1', fullname: 'Jane' }).kind).toBe('contact');
  });

  it('a stamp-less record falls back to the STABLE baseline (never the run clock) so it is not re-churned', () => {
    const e = mapAccount(pureCtx, { accountid: 'a9', name: 'No Dates Inc' });
    expect(e.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(e.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(e.syncedAt).toBe(NOW); // syncedAt is the run clock; created/updated are not
  });
});

describe('Dynamics OData delta — modifiedon high-water (ge, unquoted ISO-Z, leapfrog-free)', () => {
  it('first sync: no $filter, orders by modifiedon asc, commits the newest high-water on drain', async () => {
    let q: Record<string, unknown> = {};
    const ctx = routed((url, opts) => {
      expect(url).toBe(`${API}/accounts`);
      q = opts?.query as Record<string, unknown>;
      return { value: [{ accountid: 'a1', name: 'Acme', modifiedon: '2026-07-10T00:00:00Z' }] };
    }, null);
    const page = await accountsR.pull(ctx);
    expect(q.$filter).toBeUndefined(); // no high-water yet
    expect(q.$orderby).toBe('modifiedon asc');
    expect(String(q.$select)).toContain('modifiedon'); // WHO fields appended to $select
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00Z')); // epoch-ms high-water
  });

  it('incremental: filters `modifiedon ge <UNQUOTED ISO-Z>` at the high-water minus the overlap window', async () => {
    const hw = Date.parse('2026-07-05T08:15:20.000Z');
    const floor = new Date(hw - 2 * 60 * 1000).toISOString();
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { value: [{ accountid: 'a2', modifiedon: '2026-07-11T00:00:00Z' }] }; }, JSON.stringify({ hw }));
    await accountsR.pull(ctx);
    expect(q.$filter).toBe(`modifiedon ge ${floor}`);
    expect(floor).toBe('2026-07-05T08:13:20.000Z'); // 2 min earlier, unquoted, Z suffix (Dataverse rejects a quoted literal)
  });

  it('within a run it follows @odata.nextLink VERBATIM (no query appended) while more, then drains', async () => {
    const nextLink = `${API}/accounts?$skiptoken=%3Ccookie%3E`;
    const p1 = await accountsR.pull(routed((url, opts) => {
      expect(url).toBe(`${API}/accounts`);
      expect(opts?.query?.$orderby).toBe('modifiedon asc');
      return { value: [{ accountid: 'a1', modifiedon: '2026-07-18T00:00:00Z' }], next: nextLink };
    }, null));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.next).toBe(nextLink);
    expect(c1.runAt).toBe(NOW);
    expect(c1.hw).toBeUndefined(); // not committed mid-walk
    expect(c1.pending).toBe(Date.parse('2026-07-18T00:00:00Z'));

    const p2 = await accountsR.pull(routed((url, opts) => {
      expect(url).toBe(nextLink); // followed VERBATIM
      expect(opts?.query).toBeUndefined(); // NEVER append query options to a nextLink (would corrupt the skiptoken)
      return { value: [{ accountid: 'a2', modifiedon: '2026-07-20T00:00:00Z' }] }; // no nextLink → drain
    }, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe(Date.parse('2026-07-20T00:00:00Z'));
  });

  it('a nextLink AND a mid-walk pending from a PRIOR run (runAt ≠ now) are NEVER replayed — rebuild from the high-water', async () => {
    const hw = Date.parse('2026-07-02T00:00:00.000Z');
    let url = '';
    let q: Record<string, unknown> = {};
    const ctx = routed((u, opts) => { url = u; q = opts?.query as Record<string, unknown>; return { value: [{ accountid: 'a', modifiedon: '2026-07-30T00:00:00Z' }] }; },
      JSON.stringify({ hw, next: `${API}/accounts?$skiptoken=STALE`, runAt: '2020-01-01T00:00:00.000Z', pending: Date.parse('2026-12-31T00:00:00Z'), page: 5 }));
    const page = await accountsR.pull(ctx);
    expect(url).toBe(`${API}/accounts`); // stale nextLink dropped; a fresh run rebuilds the base query
    expect(String(q.$filter)).toContain('modifiedon ge'); // rebuilt from the durable high-water
    // Committed high-water derives from THIS page's records, never the stale mid-walk pending.
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-30T00:00:00Z'));
  });

  it('a row missing modifiedon does not crash and does not corrupt the high-water', async () => {
    const ctx = routed(() => ({ value: [
      { accountid: 'a1', modifiedon: '2026-07-10T00:00:00Z' },
      { accountid: 'a2' }, // no modifiedon → skipped for the high-water, still mapped
    ] }), null);
    const page = await accountsR.pull(ctx);
    expect(page.entities).toHaveLength(2);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00Z'));
  });

  it('incremental with zero rows commits the high-water unchanged (steady state)', async () => {
    const hw = Date.parse('2026-07-10T00:00:00.000Z');
    const page = await accountsR.pull(routed(() => ({ value: [] }), JSON.stringify({ hw })));
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(hw);
  });

  it('at the MAX_PAGES cap it commits the high-water and drops the nextLink — the query resumes next run', async () => {
    // Within the run (runAt === now) at page 24 → page+1 (25) is not < MAX_PAGES (25), so it caps with a live nextLink.
    const page = await accountsR.pull(routed(() => ({ value: [{ accountid: 'a9', modifiedon: '2026-07-25T00:00:00Z' }], next: `${API}/accounts?$skiptoken=MORE` }),
      JSON.stringify({ hw: Date.parse('2026-07-01T00:00:00Z'), next: `${API}/accounts?$skiptoken=CUR`, runAt: NOW, page: 24 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe(Date.parse('2026-07-25T00:00:00Z')); // committed → next run's ge(this) resumes forward
    expect(c.next).toBeUndefined(); // nextLink dropped; the durable high-water drives resumption
  });

  it('saturated-instant guard: a capped run whose high-water cannot advance carries the nextLink across runs (no stall)', async () => {
    const instant = Date.parse('2026-07-05T00:00:00.000Z');
    const capNext = `${API}/accounts?$skiptoken=SAT`;
    // At the cap, every row shares the SAME modifiedon as the high-water, so it can't advance.
    const capped = await accountsR.pull(routed(() => ({
      value: [{ accountid: 'a900', modifiedon: '2026-07-05T00:00:00Z' }],
      next: capNext,
    }), JSON.stringify({ hw: instant, next: `${API}/accounts?$skiptoken=CUR`, runAt: NOW, page: 24 })));
    expect(capped.hasMore).toBe(false);
    const c = JSON.parse(capped.cursor as string);
    expect(c.sat).toBe(true);        // saturated → continuation flagged (NOT a stall)
    expect(c.next).toBe(capNext);    // the CURRENT page's nextLink kept so the next run drains further
    expect(c.hw).toBe(instant);      // high-water unchanged (a single instant can't be sub-divided)

    // Next run (runAt no longer matches) HONORS the sat continuation: follows the nextLink instead of rebuilding.
    let url = '';
    await accountsR.pull(routed((u) => { url = u; return { value: [{ accountid: 'a901', modifiedon: '2026-07-06T00:00:00Z' }] }; }, capped.cursor));
    expect(url).toBe(capNext); // continued across the run boundary (would rebuild from hw → stall without the sat carry)
  });

  it('a pathological nextLink-with-no-rows response stops instead of looping forever', async () => {
    const page = await accountsR.pull(routed(() => ({ value: [], next: `${API}/accounts?$skiptoken=X` }), JSON.stringify({ hw: Date.parse('2026-07-01T00:00:00Z') })));
    expect(page.hasMore).toBe(false); // rows.length === 0 guard overrides the nextLink
  });

  it('a 400 while following a carried sat skiptoken DROPS the token and resumes from the high-water (self-heal, no permanent stall)', async () => {
    const hw = Date.parse('2026-07-05T00:00:00.000Z');
    const satCursor = JSON.stringify({ hw, next: `${API}/accounts?$skiptoken=STALE`, pending: hw, sat: true });
    const page = await accountsR.pull(rejecting(new HttpError(400, 'Invalid skiptoken', false), satCursor));
    expect(page.degraded?.kind).toBe('unprovisioned');
    expect(page.degraded?.reason).toContain('continuation expired'); // distinct reason, not the schema one
    // The stale token is DROPPED so the next run rebuilds `modifiedon ge hw` fresh (a new skiptoken) — without
    // this the sat cursor (which has no runAt) would re-follow the poisoned token forever → permanent stall.
    const c = JSON.parse(page.cursor as string);
    expect(c).toEqual({ hw });
    expect(c.next).toBeUndefined();
    expect(c.sat).toBeUndefined();
  });

  it('drops a keyless row rather than coalescing it to an empty, collision-prone sourceId', async () => {
    const page = await accountsR.pull(routed(() => ({ value: [
      { accountid: 'a1', name: 'Real', modifiedon: '2026-07-10T00:00:00Z' },
      { name: 'Keyless ghost', modifiedon: '2026-07-10T00:00:00Z' }, // no accountid → skipped, not mapped to ''
    ] }), null));
    expect(page.entities).toHaveLength(1);
    expect(page.entities[0].sourceId).toBe('a1');
  });
});

describe('Dynamics graceful degradation', () => {
  it('a 400 (a customization made an attribute unqueryable) degrades the SERVICE visibly, not the family', async () => {
    const page = await accountsR.pull(rejecting(new HttpError(400, 'Bad Request', false), null));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned');
    expect(page.degraded?.reason).toContain('400'); // observable, not masked as a native 404
    expect(page.cursor).toBeNull(); // cursor preserved (here the null first-run cursor) — no high-water advance
  });

  it('a 404 (table/solution not installed) degrades as unprovisioned; a 403 (security role) as unauthorized', async () => {
    expect((await casesR.pull(rejecting(new HttpError(404, 'Resource not found', false), null))).degraded?.kind).toBe('unprovisioned');
    expect((await casesR.pull(rejecting(new AuthError('forbidden', 403), null))).degraded?.kind).toBe('unauthorized');
  });

  it('a 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(accountsR.pull(rejecting(new HttpError(503, 'server error', true), null))).rejects.toThrow();
  });
});

describe('Dynamics manifest — Microsoft Entra OAuth (PKCE) + per-org resource scope', () => {
  it('builds Entra v2.0 OAuth endpoints with PKCE, no secret, user_impersonation + offline_access, port 42829', () => {
    const dyn = MANIFEST_BY_ID['dynamics365'];
    expect(dyn?.authType).toBe('oauth2_pkce');
    expect(dyn?.oauth?.authorizeUrl).toMatch(/login\.microsoftonline\.com\/.+\/oauth2\/v2\.0\/authorize$/);
    expect(dyn?.oauth?.tokenUrl).toMatch(/\/oauth2\/v2\.0\/token$/);
    expect(dyn?.oauth?.usePkce).toBe(true);
    expect(dyn?.oauth?.tokenAuthStyle).toBe('body');
    expect(dyn?.oauth?.clientSecretEnv).toBeNull(); // public client — a desktop secret trips AADSTS700025
    expect(dyn?.oauth?.scopes).toContain('offline_access'); // yields the refresh token
    expect(dyn?.oauth?.scopes?.some((s) => s.endsWith('/user_impersonation'))).toBe(true); // per-org Dataverse scope
    expect(dyn?.oauth?.loopbackPort).toBe(42829); // distinct from the other families' ports
    expect(dyn?.oauth?.accessTokenTtlSeconds).toBeUndefined(); // expires_in returned → existing refresh path
    expect(dyn?.multiAccount).toBe(false); // one org per deployment
  });
});
