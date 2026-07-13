/**
 * P5 — Increment 14: the Workday connector FAMILY (Workers, Organizations, Positions, Jobs, Departments,
 * Supervisory Organizations, Recruiting, Candidates, Benefits, Payroll, Learning, Time Off on one `workday`
 * connector). Pure-node, fake HttpClient. Covers family composition, the uniform REST `{total,data}`
 * offset/limit pull (offset advance by row count, total-driven termination + full-page fallback, continue-
 * across-runs + reset-on-drain, the empty-page guard), the host+tenant URL construction, the 400/403/404
 * degrade, the mappers (kinds, globally-unique WID sourceIds with no prefix, descriptor titles, nested-ref
 * descriptors, stable stamps), and graceful degradation.
 */
// workdayBase()/workdayTenant() read these at call time; set them before the pulls run.
process.env.NEUROPAUSE_WORKDAY_HOST = 'wd2-impl-services1.workday.com';
process.env.NEUROPAUSE_WORKDAY_TENANT = 'acme';

import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import { MANIFEST_BY_ID } from '../../../connectors/manifests';
import {
  workdayAdapter,
  WORKDAY_SERVICES,
  mapWorker,
  mapOrganization,
  mapPosition,
  mapJob,
  mapDepartment,
  mapSupervisoryOrg,
  mapRequisition,
  mapCandidate,
  mapBenefit,
  mapPayroll,
  mapLearning,
  mapTimeOff,
} from './workday';

const BASE = 'https://wd2-impl-services1.workday.com';
const API = `${BASE}/ccx/api`;
const NOW = '2026-07-13T00:00:00.000Z';
const baseCtx = { connectorId: 'workday', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };

interface Handled { total?: number; data?: Record<string, unknown>[] }

/** ctx whose http replays a Workday `{ total, data }` body (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => Handled, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        const out = handler(url, opts);
        return Promise.resolve({ data: { total: out.total, data: out.data ?? [] }, headers: {}, status: 200 });
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

const byId = (id: string) => workdayAdapter.resources.find((r) => r.id === id)!;
const workersR = byId('workday_workers');
const recruitingR = byId('workday_recruiting');
const timeOffR = byId('workday_time_off');

describe('Workday family — composition & catalog', () => {
  it('is ONE connector with every HCM object mounted as a service resource', () => {
    expect(workdayAdapter.connectorId).toBe('workday');
    expect(workdayAdapter.resources.map((r) => r.id)).toEqual([
      'workday_workers', 'workday_organizations', 'workday_positions', 'workday_jobs', 'workday_departments',
      'workday_supervisory_organizations', 'workday_recruiting', 'workday_candidates', 'workday_benefits',
      'workday_payroll', 'workday_learning', 'workday_time_off',
    ]);
  });

  it('the catalog ids match the adapter resource ids, each with a concrete resource + kind', () => {
    expect(WORKDAY_SERVICES.map((s) => s.id)).toEqual(workdayAdapter.resources.map((r) => r.id));
    const m = Object.fromEntries(WORKDAY_SERVICES.map((s) => [s.id, s]));
    expect(m.workday_workers.kind).toBe('contact');
    expect(m.workday_organizations.kind).toBe('organization');
    expect(m.workday_recruiting.kind).toBe('task');
    expect(m.workday_time_off.kind).toBe('event');
  });
});

describe('Workday mappers — kinds, object-prefixed WID sourceIds, descriptors, nested refs', () => {
  it('maps a Worker → contact with the object-prefixed WID sourceId, the descriptor title, and a nested-ref field', () => {
    const e = mapWorker(pureCtx, {
      id: 'WID-worker-1', descriptor: 'Jane Doe', primaryWorkEmail: 'jane@acme.com', businessTitle: 'Staff Engineer',
      primaryJob: { id: 'JOB-1', descriptor: 'Software Engineer' },
    });
    expect(e.kind).toBe('contact');
    expect(e.id).toBe('workday:a1:contact:worker-WID-worker-1'); // object-type-prefixed WID
    expect(e.title).toBe('Jane Doe');
    expect(e.author).toBe('jane@acme.com');
    expect(e.metadata.businessTitle).toBe('Staff Engineer');
    expect(e.metadata.primaryJob).toBe('Software Engineer'); // nested { id, descriptor } → descriptor
  });

  it('prefixes sourceIds per object so the SAME WID across same-kind endpoints never collides (the org trio)', () => {
    // A supervisory org IS an organization and a department is an organization — the same WID surfaces in all
    // three endpoints, all mapping to kind `organization`. The unified id has no resource segment, so WITHOUT
    // the prefix these collapse to one id and overwrite each other every sync (masking two of the three).
    const org = mapOrganization(pureCtx, { id: 'ORG-1', descriptor: 'Engineering' });
    const dept = mapDepartment(pureCtx, { id: 'ORG-1', descriptor: 'Engineering' });
    const sup = mapSupervisoryOrg(pureCtx, { id: 'ORG-1', descriptor: 'Engineering' });
    expect(org.id).toBe('workday:a1:organization:organization-ORG-1');
    expect(dept.id).toBe('workday:a1:organization:department-ORG-1');
    expect(sup.id).toBe('workday:a1:organization:supervisory_org-ORG-1');
    expect(new Set([org.id, dept.id, sup.id]).size).toBe(3); // three DISTINCT ids despite the shared WID + kind
  });

  it('maps every remaining object to its kind', () => {
    expect(mapPosition(pureCtx, { id: 'p1', descriptor: 'P' }).kind).toBe('document');
    expect(mapJob(pureCtx, { id: 'j1', descriptor: 'J' }).kind).toBe('document');
    expect(mapDepartment(pureCtx, { id: 'd1', descriptor: 'D' }).kind).toBe('organization');
    expect(mapSupervisoryOrg(pureCtx, { id: 's1', descriptor: 'S' }).kind).toBe('organization');
    expect(mapRequisition(pureCtx, { id: 'r1', descriptor: 'R' }).kind).toBe('task');
    expect(mapCandidate(pureCtx, { id: 'c1', descriptor: 'C' }).kind).toBe('contact');
    expect(mapBenefit(pureCtx, { id: 'b1', descriptor: 'B' }).kind).toBe('document');
    expect(mapPayroll(pureCtx, { id: 'pr1', descriptor: 'PR' }).kind).toBe('document');
    expect(mapLearning(pureCtx, { id: 'l1', descriptor: 'L' }).kind).toBe('document');
  });

  it('maps Time Off → event, threading start/end dates onto the timestamps', () => {
    const e = mapTimeOff(pureCtx, { id: 't1', descriptor: 'PTO', startDate: '2026-08-01', endDate: '2026-08-05', worker: { id: 'w1', descriptor: 'Jane Doe' } });
    expect(e.kind).toBe('event');
    expect(e.timestamp).toBe('2026-08-01');
    expect(e.endTimestamp).toBe('2026-08-05');
    expect(e.metadata.worker).toBe('Jane Doe');
  });

  it('a record with no reliable modified time uses the STABLE baseline (never the run clock) so it is not re-churned', () => {
    const e = mapOrganization(pureCtx, { id: 'o9', descriptor: 'Org' });
    expect(e.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(e.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(e.syncedAt).toBe(NOW); // syncedAt is the run clock; created/updated are not
  });
});

describe('Workday REST — the host + tenant URL construction', () => {
  it('builds `/ccx/api/{service}/{version}/{tenant}/{resource}` from the host + tenant env', async () => {
    let workersUrl = '';
    await workersR.pull(routed((url) => { workersUrl = url; return { total: 0, data: [] }; }, null));
    expect(workersUrl).toBe(`${API}/staffing/v6/acme/workers`);

    let recruitingUrl = '';
    await recruitingR.pull(routed((url) => { recruitingUrl = url; return { total: 0, data: [] }; }, null));
    expect(recruitingUrl).toBe(`${API}/recruiting/v4/acme/jobRequisitions`);

    let timeOffUrl = '';
    await timeOffR.pull(routed((url) => { timeOffUrl = url; return { total: 0, data: [] }; }, null));
    expect(timeOffUrl).toBe(`${API}/absenceManagement/v1/acme/timeOffs`);
  });
});

describe('Workday REST full-list — offset/limit over {total,data}, continue-across-runs, reset-on-drain', () => {
  it('first page requests offset 0 / limit 100 and advances the offset by the ACTUAL row count while more', async () => {
    let q: Record<string, unknown> = {};
    const p1 = await workersR.pull(routed((_url, opts) => {
      q = opts?.query as Record<string, unknown>;
      return { total: 3, data: [{ id: 'w1', descriptor: 'A' }, { id: 'w2', descriptor: 'B' }] };
    }, null));
    expect(q.limit).toBe(100);
    expect(q.offset).toBe(0);
    expect(p1.hasMore).toBe(true); // 0 + 2 < 3
    expect(JSON.parse(p1.cursor as string)).toEqual({ offset: 2 }); // advanced by the row count
  });

  it('continues the offset across runs and RESETS to 0 on drain (offset + rows reaches total)', async () => {
    const p2 = await workersR.pull(routed((_url, opts) => {
      expect(opts?.query?.offset).toBe(2); // prior run's offset honored (full-list continues across runs)
      return { total: 3, data: [{ id: 'w3', descriptor: 'C' }] };
    }, JSON.stringify({ offset: 2 })));
    expect(p2.hasMore).toBe(false); // 2 + 1 = 3, not < 3 → drained
    expect(JSON.parse(p2.cursor as string)).toEqual({ offset: 0 }); // reset → next pass re-walks the snapshot
  });

  it('without a `total`, falls back to the full-page heuristic (a PAGE-sized page means more; a short page drains)', async () => {
    const full = Array.from({ length: 100 }, (_v, i) => ({ id: `w${i}`, descriptor: `W${i}` }));
    const p1 = await workersR.pull(routed(() => ({ data: full }), null)); // no total
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string)).toEqual({ offset: 100 });

    const p2 = await workersR.pull(routed(() => ({ data: [{ id: 'w', descriptor: 'W' }] }), JSON.stringify({ offset: 100 })));
    expect(p2.hasMore).toBe(false); // short page → drain
    expect(JSON.parse(p2.cursor as string)).toEqual({ offset: 0 });
  });

  it('a pathological non-empty `total` with an empty page stops instead of advancing the offset forever', async () => {
    const page = await workersR.pull(routed(() => ({ total: 500, data: [] }), JSON.stringify({ offset: 200 })));
    expect(page.hasMore).toBe(false); // rows.length === 0 guard overrides the total comparison
    expect(JSON.parse(page.cursor as string)).toEqual({ offset: 0 });
  });

  it('drops a keyless row rather than coalescing it to an empty, collision-prone sourceId', async () => {
    const page = await workersR.pull(routed(() => ({ total: 2, data: [
      { id: 'w1', descriptor: 'Real' },
      { descriptor: 'Keyless ghost' }, // no id/WID → skipped, not mapped to ''
    ] }), null));
    expect(page.entities).toHaveLength(1);
    expect(page.entities[0].sourceId).toBe('worker-w1'); // object-prefixed
  });
});

describe('Workday graceful degradation', () => {
  it('a 400 (per-version REST-shape quirk) degrades the SERVICE visibly, not the family', async () => {
    const page = await workersR.pull(rejecting(new HttpError(400, 'Bad Request', false), null));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned');
    expect(page.degraded?.reason).toContain('400'); // observable, not masked
    expect(page.cursor).toBeNull(); // cursor preserved (here the null first-run cursor)
  });

  it('a 404 (module/resource not provisioned) degrades as unprovisioned; a 403 (ISU security) as unauthorized', async () => {
    expect((await recruitingR.pull(rejecting(new HttpError(404, 'not found', false), null))).degraded?.kind).toBe('unprovisioned');
    expect((await recruitingR.pull(rejecting(new AuthError('forbidden', 403), null))).degraded?.kind).toBe('unauthorized');
  });

  it('a 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(workersR.pull(rejecting(new HttpError(503, 'server error', true), null))).rejects.toThrow();
  });
});

describe('Workday manifest — tenant-hosted OAuth (Basic auth) + refresh', () => {
  it('builds host+tenant OAuth endpoints with Basic client auth, no request scopes, no TTL, single-account', () => {
    const wd = MANIFEST_BY_ID['workday'];
    expect(wd?.authType).toBe('oauth2_confidential');
    expect(wd?.oauth?.authorizeUrl).toMatch(/\/ccx\/oauth2\/.+\/authorize$/);
    expect(wd?.oauth?.tokenUrl).toMatch(/\/ccx\/oauth2\/.+\/token$/);
    expect(wd?.oauth?.tokenAuthStyle).toBe('basic'); // Workday token endpoint takes HTTP Basic client auth
    expect(wd?.oauth?.usePkce).toBe(false);
    expect(wd?.oauth?.scopes).toEqual([]); // access is ISU-security-governed, not request-scope-gated
    expect(wd?.oauth?.revokeUrl).toBeNull();
    expect(wd?.oauth?.loopbackPort).toBe(42831); // distinct from the other families' ports
    expect(wd?.oauth?.accessTokenTtlSeconds).toBeUndefined(); // expires_in returned → existing refresh path
    expect(wd?.multiAccount).toBe(false); // one tenant per deployment
  });
});
