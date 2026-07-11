/**
 * P3.0 Increment 5 — SDK tests: generated EnterpriseResource routing, OAuth token,
 * pagination, transport retries, the generator itself, and the drift guard (the
 * committed generated file must equal the generator's current output).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ApiListPage } from '@neuropause/shared';
import { ENTERPRISE_API_ROUTE_MANIFEST } from '@neuropause/shared';
import { NeuroPauseClient } from './client';
import { HttpTransport, type FetchLike, type Transport, type TransportRequest, type TransportResponse } from './transport';
import { collect, paginate } from './pagination';
import { generateEnterpriseResource, methodName } from './codegen/generateEnterprise';

class MockTransport implements Transport {
  calls: TransportRequest[] = [];
  constructor(private readonly canned: unknown = {}) {}
  async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    this.calls.push(req);
    return { status: 200, data: this.canned as T, headers: {} };
  }
}

describe('EnterpriseResource (generated)', () => {
  it('routes record CRUD to the right method/path/scope with encoded params', async () => {
    const t = new MockTransport({ id: 'r1' });
    const np = new NeuroPauseClient({ transport: t });

    await np.enterprise.getModules();
    expect(t.calls[0]).toMatchObject({ method: 'GET', path: '/modules', scope: 'records:read' });

    await np.enterprise.getModulesModuleIdRecords('finance-invoices', { limit: 10, status: 'active' });
    expect(t.calls[1]).toMatchObject({ method: 'GET', path: '/modules/finance-invoices/records', scope: 'records:read' });
    expect(t.calls[1].query).toEqual({ limit: 10, status: 'active' });

    await np.enterprise.postModulesModuleIdRecords('crm-leads', { title: 'Acme' });
    expect(t.calls[2]).toMatchObject({ method: 'POST', path: '/modules/crm-leads/records', scope: 'records:write' });
    expect(t.calls[2].body).toEqual({ title: 'Acme' });

    await np.enterprise.getModulesModuleIdRecordsId('crm-leads', 'lead 9');
    expect(t.calls[3].path).toBe('/modules/crm-leads/records/lead%209'); // encoded
  });

  it('exposes graph / context / timeline / automation routes', async () => {
    const t = new MockTransport({});
    const np = new NeuroPauseClient({ transport: t });
    await np.enterprise.getGraphCounts();
    await np.enterprise.getContextId('erp:customer:Acme');
    await np.enterprise.getTimeline({ limit: 5 });
    await np.enterprise.getAutomation();
    expect(t.calls.map((c) => c.path)).toEqual(['/graph/counts', '/context/erp%3Acustomer%3AAcme', '/timeline', '/automation']);
  });
});

describe('OAuthResource', () => {
  it('requests a client-credentials token', async () => {
    const t = new MockTransport({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'records:read' });
    const np = new NeuroPauseClient({ transport: t });
    const res = await np.oauth.token({ clientId: 'npc_1', clientSecret: 'nps_1', scope: 'records:read' });
    expect(res.access_token).toBe('tok');
    expect(t.calls[0]).toMatchObject({ method: 'POST', path: '/oauth/token' });
    expect(t.calls[0].body).toEqual({ grantType: 'client_credentials', clientId: 'npc_1', clientSecret: 'nps_1', scope: 'records:read' });
  });
});

describe('pagination', () => {
  it('follows nextCursor across pages', async () => {
    const pages: Record<string, ApiListPage<number>> = {
      'null': { data: [1, 2], nextCursor: 'c1', total: 4, limit: 2 },
      c1: { data: [3, 4], nextCursor: null, total: 4, limit: 2 },
    };
    const all = await collect<number>((cursor) => Promise.resolve(pages[String(cursor)]));
    expect(all).toEqual([1, 2, 3, 4]);

    const seen: number[] = [];
    for await (const n of paginate<number>((cursor) => Promise.resolve(pages[String(cursor)]))) seen.push(n);
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe('HttpTransport retries', () => {
  function fakeFetch(statuses: number[]): FetchLike {
    let i = 0;
    return async () => {
      const status = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      return { status, headers: { get: () => null }, text: async () => '{"ok":true}' };
    };
  }

  it('retries a 503 then succeeds', async () => {
    const t = new HttpTransport({ baseUrl: 'https://api.test', maxRetries: 2, sleep: async () => {}, fetchImpl: fakeFetch([503, 200]) });
    const res = await t.request({ method: 'GET', path: '/modules' });
    expect(res.status).toBe(200);
  });

  it('throws after exhausting retries on persistent 429', async () => {
    const t = new HttpTransport({ baseUrl: 'https://api.test', maxRetries: 2, sleep: async () => {}, fetchImpl: fakeFetch([429]) });
    await expect(t.request({ method: 'GET', path: '/modules' })).rejects.toMatchObject({ status: 429 });
  });
});

describe('generator', () => {
  it('produces collision-free method names including path params', () => {
    expect(methodName({ method: 'GET', path: '/modules', scope: 'records:read', summary: '', list: false })).toBe('getModules');
    expect(methodName({ method: 'GET', path: '/modules/:moduleId/records', scope: 'records:read', summary: '', list: true })).toBe('getModulesModuleIdRecords');
    expect(methodName({ method: 'GET', path: '/modules/:moduleId/records/:id', scope: 'records:read', summary: '', list: false })).toBe('getModulesModuleIdRecordsId');
  });

  it('the committed generated resource is in sync with the generator + manifest', () => {
    const expected = generateEnterpriseResource(ENTERPRISE_API_ROUTE_MANIFEST);
    const committed = readFileSync(fileURLToPath(new URL('./generated/enterprise.ts', import.meta.url)), 'utf8');
    expect(committed).toBe(expected);
  });
});
