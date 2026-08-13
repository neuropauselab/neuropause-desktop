import { makeUnifiedId } from '../../ids';
/**
 * P5 — Increment 10: the ServiceNow connector FAMILY (Incidents, Problems, Change Requests, Requests,
 * Knowledge, CMDB, Assets, Users, Groups, Catalog on one `servicenow` connector). Pure-node, fake
 * HttpClient. Covers family composition, the uniform Table-API `sys_updated_on` high-water incremental
 * pull (order-only first sync, `>=` incremental with overlap + `^ORDERBYsys_updated_on^ORDERBYsys_id`,
 * within-run `sysparm_offset` paging via the Link header, run-scoped offset guard, MAX_PAGES cap), the
 * 400-missing-table → unprovisioned degrade, the mappers (kinds, per-table id prefixes, display_value=all
 * handling, UTC datetime normalization, deep links), and graceful degradation (403 / 5xx).
 */
// snBase() reads the instance from this env var at call time; set it before the pulls run.
process.env.NEUROPAUSE_SERVICENOW_INSTANCE = 'dev00001';

import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import { MANIFEST_BY_ID } from '../../../connectors/manifests';
import {
  servicenowAdapter,
  SERVICENOW_SERVICES,
  mapIncident,
  mapProblem,
  mapChange,
  mapRequest,
  mapKnowledge,
  mapCi,
  mapAsset,
  mapCatalogItem,
  mapUser,
  mapGroup,
} from './servicenow';

const BASE = 'https://dev00001.service-now.com';
const NOW = '2026-07-13T00:00:00.000Z';
const baseCtx = { tenantId: 'org-test', connectorId: 'servicenow', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };

/** A `sysparm_display_value=all` field: {value, display_value}. */
const f = (value: string, display?: string) => ({ value, display_value: display ?? value });

interface Handled { result?: Record<string, unknown>[]; link?: string }

/** ctx whose http replays a Table-API body + optional Link header (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => Handled, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        const out = handler(url, opts);
        return Promise.resolve({ data: { result: out.result ?? [] }, headers: out.link ? { link: out.link } : {}, status: 200 });
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

const byId = (id: string) => servicenowAdapter.resources.find((r) => r.id === id)!;
const incidentsR = byId('servicenow_incidents');
const assetsR = byId('servicenow_assets');

describe('ServiceNow family — composition & catalog', () => {
  it('is ONE connector with every ITSM/CMDB table mounted as a service resource', () => {
    expect(servicenowAdapter.connectorId).toBe('servicenow');
    expect(servicenowAdapter.resources.map((r) => r.id)).toEqual([
      'servicenow_incidents', 'servicenow_problems', 'servicenow_changes', 'servicenow_requests',
      'servicenow_knowledge', 'servicenow_cmdb', 'servicenow_assets', 'servicenow_users',
      'servicenow_groups', 'servicenow_catalog',
    ]);
  });

  it('the catalog ids match the adapter resource ids, each with a concrete table + kind', () => {
    expect(SERVICENOW_SERVICES.map((s) => s.id)).toEqual(servicenowAdapter.resources.map((r) => r.id));
    const byId2 = Object.fromEntries(SERVICENOW_SERVICES.map((s) => [s.id, s]));
    expect(byId2.servicenow_incidents.table).toBe('incident');
    expect(byId2.servicenow_incidents.kind).toBe('task');
    expect(byId2.servicenow_groups.kind).toBe('organization');
  });
});

describe('ServiceNow mappers — kinds, per-table id prefixes, display_value + deep links', () => {
  it('maps an Incident → task with a number+desc title, display-value status, a UTC timestamp, and a deep link', () => {
    const e = mapIncident(pureCtx, BASE, 'incident', {
      sys_id: f('abc123'), number: f('INC0010023'), short_description: f('Email down'),
      state: f('2', 'In Progress'), assigned_to: f('a1', 'Ada Byron'),
      sys_created_on: f('2026-06-01 00:00:00'), sys_updated_on: f('2026-07-02 10:00:00'),
    });
    expect(e.kind).toBe('task');
    expect(e.id).toBe(makeUnifiedId('org-test', 'servicenow', 'a1', 'task', 'incident-abc123')); // per-table prefix
    expect(e.title).toBe('INC0010023 — Email down');
    expect(e.status).toBe('In Progress'); // display_value of the choice code, not "2"
    expect(e.author).toBe('Ada Byron'); // reference display_value, not the sys_id
    expect(e.updatedAt).toBe('2026-07-02T10:00:00.000Z'); // SN "YYYY-MM-DD HH:MM:SS" parsed as UTC
    expect(e.url).toBe('https://dev00001.service-now.com/incident.do?sys_id=abc123');
    expect(e.metadata.number).toBe('INC0010023');
  });

  it('prefixes sourceIds per table so different tables mapping to `task` never collide on a shared sys_id', () => {
    const rec = (sysId: string) => ({ sys_id: f(sysId), number: f('X'), sys_updated_on: f('2026-07-01 00:00:00') });
    const inc = mapIncident(pureCtx, BASE, 'incident', rec('same'));
    const prob = mapProblem(pureCtx, BASE, 'problem', rec('same'));
    const chg = mapChange(pureCtx, BASE, 'change_request', rec('same'));
    const req = mapRequest(pureCtx, BASE, 'sc_request', rec('same'));
    expect([inc.kind, prob.kind, chg.kind, req.kind]).toEqual(['task', 'task', 'task', 'task']);
    expect(new Set([inc.id, prob.id, chg.id, req.id]).size).toBe(4); // four DISTINCT ids from one sys_id
    expect(inc.id).toBe(makeUnifiedId('org-test', 'servicenow', 'a1', 'task', 'incident-same'));
    expect(chg.id).toBe(makeUnifiedId('org-test', 'servicenow', 'a1', 'task', 'change_request-same'));
  });

  it('maps Knowledge/CMDB/Asset/Catalog → document (HTML stripped) and User → contact, Group → organization', () => {
    const kb = mapKnowledge(pureCtx, BASE, 'kb_knowledge', { sys_id: f('k1'), short_description: f('How to VPN'), text: f('<p>Steps&nbsp;here</p>'), workflow_state: f('published', 'Published') });
    expect(kb.kind).toBe('document');
    expect(kb.body).toBe('Steps here'); // HTML stripped
    const ci = mapCi(pureCtx, BASE, 'cmdb_ci', { sys_id: f('c1'), name: f('web-prod-01'), sys_class_name: f('cmdb_ci_linux_server', 'Linux Server'), operational_status: f('1', 'Operational') });
    expect(ci.kind).toBe('document');
    expect(ci.metadata.ciClass).toBe('Linux Server');
    const asset = mapAsset(pureCtx, BASE, 'alm_asset', { sys_id: f('as1'), display_name: f('MacBook'), install_status: f('1', 'In use') });
    expect(asset.kind).toBe('document');
    expect(asset.status).toBe('In use'); // install_status (there is no `state` column on alm_asset)
    const cat = mapCatalogItem(pureCtx, BASE, 'sc_cat_item', { sys_id: f('ci1'), name: f('New Laptop'), active: f('true') });
    expect(cat.kind).toBe('document');
    const user = mapUser(pureCtx, BASE, 'sys_user', { sys_id: f('u1'), name: f('Grace Hopper'), email: f('grace@navy.mil'), active: f('true') });
    expect(user.kind).toBe('contact');
    expect(user.id).toBe(makeUnifiedId('org-test', 'servicenow', 'a1', 'contact', 'sys_user-u1'));
    const group = mapGroup(pureCtx, BASE, 'sys_user_group', { sys_id: f('g1'), name: f('Network Team'), active: f('true') });
    expect(group.kind).toBe('organization');
  });
});

describe('ServiceNow Table-API incremental — sys_updated_on high-water (ASC, leapfrog-free)', () => {
  it('first sync: order-only query (no filter), commits the newest high-water on drain (no next Link)', async () => {
    let sentQuery = '';
    const ctx = routed((url, opts) => {
      expect(url).toBe('https://dev00001.service-now.com/api/now/table/incident');
      sentQuery = String(opts?.query?.sysparm_query);
      expect(opts?.query?.sysparm_display_value).toBe('all');
      return { result: [{ sys_id: f('1'), sys_updated_on: f('2026-07-10 00:00:00') }] };
    }, null);
    const page = await incidentsR.pull(ctx);
    expect(sentQuery).toBe('ORDERBYsys_updated_on^ORDERBYsys_id'); // no high-water yet → order only
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-10 00:00:00'); // committed high-water
  });

  it('incremental: filters sys_updated_on>= (high-water minus the overlap window) and orders by updated,sys_id', async () => {
    const hw = '2026-07-05 08:15:20';
    const expectedFloor = new Date(Date.parse('2026-07-05T08:15:20Z') - 2 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    let sentQuery = '';
    const ctx = routed((_url, opts) => {
      sentQuery = String(opts?.query?.sysparm_query);
      return { result: [{ sys_id: f('2'), sys_updated_on: f('2026-07-11 09:00:00') }] };
    }, JSON.stringify({ hw }));
    await incidentsR.pull(ctx);
    expect(sentQuery).toBe(`sys_updated_on>=${expectedFloor}^ORDERBYsys_updated_on^ORDERBYsys_id`);
    expect(expectedFloor).toBe('2026-07-05 08:13:20'); // 2-minute overlap below the high-water
  });

  it('within a run it advances sysparm_offset (tagged with the run clock) while the Link header says next', async () => {
    const p1 = await incidentsR.pull(routed((_url, opts) => {
      expect(opts?.query?.sysparm_offset).toBe(0);
      return { result: [{ sys_id: f('1'), sys_updated_on: f('2026-07-18 00:00:00') }], link: '<...sysparm_offset=100>;rel="next"' };
    }, null));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.offset).toBe(100);
    expect(c1.runAt).toBe(NOW);
    expect(c1.hw).toBeUndefined(); // not committed mid-walk
    expect(c1.pending).toBe('2026-07-18 00:00:00');

    const p2 = await incidentsR.pull(routed((_url, opts) => {
      expect(opts?.query?.sysparm_offset).toBe(100); // same-run offset resumed
      return { result: [{ sys_id: f('2'), sys_updated_on: f('2026-07-20 00:00:00') }] }; // no Link → drain
    }, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe('2026-07-20 00:00:00'); // newest across the walk
  });

  it('an offset AND a mid-walk pending from a PRIOR run (runAt ≠ now) are NEVER replayed — rebuild from the high-water', async () => {
    const hw = '2026-07-02 00:00:00';
    let sentOffset: unknown;
    const ctx = routed((_url, opts) => {
      sentOffset = opts?.query?.sysparm_offset;
      return { result: [{ sys_id: f('r'), sys_updated_on: f('2026-07-30 00:00:00') }] };
    }, JSON.stringify({ hw, offset: 600, runAt: '2020-01-01T00:00:00.000Z', pending: '2026-12-31 00:00:00', page: 6 }));
    const page = await incidentsR.pull(ctx);
    expect(sentOffset).toBe(0); // stale offset dropped; a fresh run restarts at 0
    // Committed high-water derives from THIS page's records, never the stale mid-walk pending.
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-30 00:00:00');
  });

  it('a row missing sys_updated_on does not crash and does not corrupt the high-water', async () => {
    const ctx = routed(() => ({ result: [
      { sys_id: f('1'), sys_updated_on: f('2026-07-10 00:00:00') },
      { sys_id: f('2') }, // no sys_updated_on → skipped for the high-water, still mapped
    ] }), null);
    const page = await incidentsR.pull(ctx);
    expect(page.entities).toHaveLength(2); // both mapped, no crash
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-10 00:00:00'); // only the row that HAS it advances hw
  });

  it('incremental with zero new rows commits the high-water unchanged (steady state, no stall)', async () => {
    const ctx = routed(() => ({ result: [] }), JSON.stringify({ hw: '2026-07-10 00:00:00' }));
    const page = await incidentsR.pull(ctx);
    expect(page.entities).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-10 00:00:00'); // unchanged → next run re-queries from here
  });

  it('at the MAX_PAGES cap it commits the high-water and drops the offset — the query resumes next run', async () => {
    // Within the run (runAt === now) at page 29 → page+1 (30) is not < MAX_PAGES (30), so it caps with a live Link.
    const page = await incidentsR.pull(routed(() => ({
      result: [{ sys_id: f('9'), sys_updated_on: f('2026-07-25 00:00:00') }], link: '<...>;rel="next"',
    }), JSON.stringify({ hw: '2026-07-01 00:00:00', offset: 2900, runAt: NOW, page: 29 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe('2026-07-25 00:00:00'); // committed → next run's sys_updated_on>= resumes forward
    expect(c.offset).toBeUndefined(); // offset dropped; the durable high-water drives resumption
  });
});

describe('ServiceNow graceful degradation', () => {
  it('a 400 "Invalid table" (plugin not installed) degrades the SERVICE as unprovisioned, not the family', async () => {
    const page = await assetsR.pull(rejecting(new HttpError(400, 'Invalid table alm_asset', false), null));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned'); // 400 re-mapped to 404 → graceful unprovisioned
  });

  it('a 403 (role/ACL denial) degrades the SERVICE as unauthorized', async () => {
    const page = await incidentsR.pull(rejecting(new AuthError('forbidden', 403), null));
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('a 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(incidentsR.pull(rejecting(new HttpError(500, 'server error', true), null))).rejects.toThrow();
  });
});

describe('ServiceNow manifest — instance host + refresh', () => {
  it('builds instance-hosted OAuth endpoints, useraccount scope, no synthesized TTL, single-account', () => {
    const sn = MANIFEST_BY_ID['servicenow'];
    expect(sn?.oauth?.authorizeUrl).toMatch(/\.service-now\.com\/oauth_auth\.do$/);
    expect(sn?.oauth?.tokenUrl).toMatch(/\.service-now\.com\/oauth_token\.do$/);
    expect(sn?.oauth?.scopes).toEqual(['useraccount']); // access is role-governed; useraccount is a no-op
    // ServiceNow returns expires_in, so the EXISTING proactive-refresh path covers it — no synthesized TTL.
    expect(sn?.oauth?.accessTokenTtlSeconds).toBeUndefined();
    expect(sn?.multiAccount).toBe(false); // one instance per deployment (a single env var)
  });
});
