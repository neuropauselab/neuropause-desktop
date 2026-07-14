/**
 * P6.8 — the Snowflake DomainCollectors: warehouse/task state health, the containment tree (schema `member_of`
 * database, table/view/…`member_of` schema via qualified nativeIds), the usage edges (stream `uses` base table,
 * task `uses` warehouse), resource-monitor credit health, string-cell coercion (numbers/booleans arrive as
 * strings), and the Resource Graph projection. Pure-node; the SQL transport is faked (canned SHOW result sets).
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { SNOWFLAKE_COLLECTORS } from './snowflakeCollectors';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => SNOWFLAKE_COLLECTORS.find((c) => c.id === id)!;

/** Build a SQL API result body: cells are always strings, columns carried in resultSetMetaData.rowType. */
const sfResult = (cols: string[], rows: Array<Array<string | null>>) =>
  JSON.stringify({ resultSetMetaData: { rowType: cols.map((name) => ({ name })), partitionInfo: [{ rowCount: rows.length }] }, data: rows, statementHandle: 'h' });

function fakeSf(byStatement: Record<string, string>): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req: DiscoveryRequest) => {
      if (req.method === 'POST') {
        const stmt = (JSON.parse(req.body ?? '{}') as { statement?: string }).statement ?? '';
        return { status: 200, headers: {}, text: byStatement[stmt] ?? sfResult([], []) };
      }
      return { status: 200, headers: {}, text: '{}' }; // no partitions in these fixtures
    },
  };
}
const ctx = (http: DiscoveryHttp): DiscoveryContext => ({ platformId: 'snowflake', accountId: 'acct1', region: null, cursor: null, now: NOW, http });

describe('Snowflake compute + data platform', () => {
  it('maps a warehouse with state health', async () => {
    const http = fakeSf({ 'SHOW WAREHOUSES': sfResult(['name', 'state', 'size', 'auto_suspend', 'running', 'owner'], [['COMPUTE_WH', 'STARTED', 'X-SMALL', '600', '1', 'SYSADMIN'], ['DEV_WH', 'SUSPENDED', 'SMALL', '60', '0', 'SYSADMIN']]) });
    const p = await collector('sf_warehouses').collect(ctx(http));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(byId['COMPUTE_WH'].health).toBe('healthy'); // STARTED
    expect(byId['COMPUTE_WH'].id).toBe(makeResourceId('snowflake', 'acct1', 'warehouse', 'COMPUTE_WH'));
    expect(byId['COMPUTE_WH'].attributes).toMatchObject({ owner: 'SYSADMIN', autoSuspend: 600, running: 1 });
    expect(byId['DEV_WH'].health).toBe('unknown'); // SUSPENDED is an intentional cost state
  });

  it('maps a schema member_of its database, and a table member_of its schema (qualified nativeIds)', async () => {
    const schemas = await collector('sf_schemas').collect(ctx(fakeSf({ 'SHOW SCHEMAS IN ACCOUNT': sfResult(['name', 'database_name', 'owner'], [['PUBLIC', 'PROD_DB', 'SYSADMIN']]) })));
    expect(schemas.resources[0].nativeId).toBe('PROD_DB.PUBLIC');
    // type-precise target: the database's full resource id (not a bare name that could collide with a same-named warehouse)
    expect(schemas.resources[0].relationships).toEqual([{ type: 'member_of', targetId: makeResourceId('snowflake', 'acct1', 'database', 'PROD_DB') }]);

    const tables = await collector('sf_tables').collect(ctx(fakeSf({ 'SHOW TABLES IN ACCOUNT': sfResult(['name', 'database_name', 'schema_name', 'kind', 'rows', 'bytes', 'owner'], [['CUSTOMERS', 'PROD_DB', 'PUBLIC', 'TABLE', '1000', '2048', 'SYSADMIN']]) })));
    expect(tables.resources[0].nativeId).toBe('PROD_DB.PUBLIC.CUSTOMERS');
    expect(tables.resources[0].relationships).toEqual([{ type: 'member_of', targetId: makeResourceId('snowflake', 'acct1', 'schema', 'PROD_DB.PUBLIC') }]);
    expect(tables.resources[0].attributes).toMatchObject({ rows: 1000, bytes: 2048 }); // string cells coerced to numbers
  });
});

describe('Snowflake data movement — usage edges', () => {
  it('a stream is member_of its schema and uses its base table', async () => {
    const http = fakeSf({ 'SHOW STREAMS IN ACCOUNT': sfResult(['name', 'database_name', 'schema_name', 'table_name', 'source_type', 'stale', 'owner'], [['ORDERS_STREAM', 'PROD_DB', 'PUBLIC', 'PROD_DB.PUBLIC.ORDERS', 'Table', 'false', 'SYSADMIN']]) });
    const p = await collector('sf_streams').collect(ctx(http));
    expect(p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual([
      `member_of:${makeResourceId('snowflake', 'acct1', 'schema', 'PROD_DB.PUBLIC')}`,
      'uses:PROD_DB.PUBLIC.ORDERS', // base-table target is a bare qualified name (ambiguous table/view type)
    ].sort());
    expect(p.resources[0].health).toBe('healthy'); // not stale
  });

  it('a task is member_of its schema and uses its warehouse; state drives health', async () => {
    const http = fakeSf({ 'SHOW TASKS IN ACCOUNT': sfResult(['name', 'database_name', 'schema_name', 'state', 'warehouse', 'schedule', 'owner'], [['DAILY_LOAD', 'PROD_DB', 'PUBLIC', 'suspended', 'COMPUTE_WH', '60 MINUTE', 'SYSADMIN']]) });
    const p = await collector('sf_tasks').collect(ctx(http));
    expect(p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual([
      `member_of:${makeResourceId('snowflake', 'acct1', 'schema', 'PROD_DB.PUBLIC')}`,
      `uses:${makeResourceId('snowflake', 'acct1', 'warehouse', 'COMPUTE_WH')}`,
    ].sort());
    expect(p.resources[0].health).toBe('degraded'); // suspended task
  });
});

describe('Snowflake identity + security', () => {
  it('a resource monitor near its credit quota is degraded', async () => {
    const http = fakeSf({ 'SHOW RESOURCE MONITORS': sfResult(['name', 'credit_quota', 'used_credits', 'level'], [['GOVERNOR', '1000', '950', 'ACCOUNT']]) });
    const p = await collector('sf_resource_monitors').collect(ctx(http));
    expect(p.resources[0].health).toBe('degraded'); // 95% used
    expect(p.resources[0].attributes).toMatchObject({ creditQuota: 1000, usedCredits: 950 });
  });

  it('a disabled user is degraded', async () => {
    const http = fakeSf({ 'SHOW USERS': sfResult(['name', 'disabled', 'default_role', 'default_warehouse'], [['SVC_USER', 'true', 'SYSADMIN', 'COMPUTE_WH']]) });
    const p = await collector('sf_users').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('SVC_USER');
    expect(p.resources[0].health).toBe('degraded');
    expect(p.resources[0].attributes.disabled).toBe(true);
  });
});

describe('Snowflake Resource Graph projection', () => {
  it('projects Database + Schema + Table and resolves the member_of containment tree (+ blast radius)', async () => {
    const http = fakeSf({
      'SHOW DATABASES': sfResult(['name', 'owner', 'kind'], [['PROD_DB', 'SYSADMIN', 'STANDARD']]),
      'SHOW SCHEMAS IN ACCOUNT': sfResult(['name', 'database_name', 'owner'], [['PUBLIC', 'PROD_DB', 'SYSADMIN']]),
      'SHOW TABLES IN ACCOUNT': sfResult(['name', 'database_name', 'schema_name', 'owner'], [['CUSTOMERS', 'PROD_DB', 'PUBLIC', 'SYSADMIN']]),
    });
    const resources = [
      ...(await collector('sf_databases').collect(ctx(http))).resources,
      ...(await collector('sf_schemas').collect(ctx(http))).resources,
      ...(await collector('sf_tables').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(3);
    // schema member_of db + table member_of schema = 2 resolved edges.
    expect(model.edges).toHaveLength(2);
    expect(model.edges.map((e) => e.type)).toEqual(['member_of', 'member_of']);
    const dbId = makeResourceId('snowflake', 'acct1', 'database', 'PROD_DB');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === dbId)).toBe(true);
  });
});

describe('Snowflake platform — one adapter, six domains', () => {
  it('the collectors span databases / compute / storage / serverless / identity / security', () => {
    const domains = new Set(SNOWFLAKE_COLLECTORS.map((c) => c.domain));
    for (const d of ['databases', 'compute', 'storage', 'serverless', 'identity', 'security'] as const) expect(domains.has(d)).toBe(true);
    expect(SNOWFLAKE_COLLECTORS).toHaveLength(13);
  });
});
