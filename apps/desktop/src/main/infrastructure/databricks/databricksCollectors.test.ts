/**
 * P6.9 — the Databricks DomainCollectors: cluster/warehouse/run state health, the Unity Catalog containment tree
 * (catalog `member_of` metastore, schema `member_of` catalog, table `member_of` schema — via TYPE-PRECISE resolved
 * ids so a shared native id can't cross-bind), the usage edges (job `runs_on` cluster, run `member_of` job,
 * external location `uses` storage credential), the bounded per-(catalog, schema) table fan-out, the bounded
 * notebook workspace-tree walk, and the Resource Graph projection. Pure-node; the REST transport is faked.
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { DATABRICKS_COLLECTORS } from './databricksCollectors';
import { AuthError, HttpError, NetworkError } from '../../unified/sync/http';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => DATABRICKS_COLLECTORS.find((c) => c.id === id)!;

type Rec = Record<string, unknown>;
/** A GET router keyed by URL — returns the JSON body for the first prefix/substring match, else `{}`. */
function fakeDbx(router: (url: string) => Rec | null): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req: DiscoveryRequest) => {
      const body = router(req.url);
      return { status: 200, headers: {}, text: body == null ? '{}' : JSON.stringify(body) };
    },
  };
}
const ctx = (http: DiscoveryHttp): DiscoveryContext => ({ platformId: 'databricks', accountId: 'ws1', region: null, cursor: null, now: NOW, http });

describe('Databricks compute', () => {
  it('maps clusters with state health (RUNNING healthy, TERMINATED unknown, ERROR critical)', async () => {
    const http = fakeDbx((u) => u.startsWith('/api/2.1/clusters/list')
      ? { clusters: [
          { cluster_id: '0708-a', cluster_name: 'analytics', state: 'RUNNING', autotermination_minutes: 30 },
          { cluster_id: '0708-b', cluster_name: 'idle', state: 'TERMINATED' },
          { cluster_id: '0708-c', cluster_name: 'broken', state: 'ERROR' },
        ] } : null);
    const p = await collector('databricks_clusters').collect(ctx(http));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(byId['0708-a'].health).toBe('healthy');
    expect(byId['0708-a'].id).toBe(makeResourceId('databricks', 'ws1', 'cluster', '0708-a'));
    expect(byId['0708-a'].attributes).toMatchObject({ autoterminationMinutes: 30 });
    expect(byId['0708-b'].health).toBe('unknown');
    expect(byId['0708-c'].health).toBe('critical');
  });

  it('maps SQL warehouses with state health (numeric auto_stop_mins coerced)', async () => {
    const http = fakeDbx((u) => u.startsWith('/api/2.0/sql/warehouses')
      ? { warehouses: [{ id: 'wh-1', name: 'serving', state: 'RUNNING', auto_stop_mins: 10, enable_serverless_compute: true }, { id: 'wh-2', name: 'off', state: 'STOPPED' }] } : null);
    const p = await collector('databricks_sql_warehouses').collect(ctx(http));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(byId['wh-1'].health).toBe('healthy');
    expect(byId['wh-1'].attributes).toMatchObject({ autoStopMins: 10, serverless: true });
    expect(byId['wh-2'].health).toBe('unknown'); // STOPPED is an intentional cost state
  });

  it('a job runs_on the cluster its tasks reference (type-precise), a run is member_of its job', async () => {
    const jobsHttp = fakeDbx((u) => u.startsWith('/api/2.2/jobs/list')
      ? { jobs: [{ job_id: 811, settings: { name: 'nightly', tasks: [{ existing_cluster_id: '0708-a' }, { existing_cluster_id: '0708-a' }] } }] } : null);
    const jobs = await collector('databricks_jobs').collect(ctx(jobsHttp));
    expect(jobs.resources[0].nativeId).toBe('811');
    expect(jobs.resources[0].relationships).toEqual([{ type: 'runs_on', targetId: makeResourceId('databricks', 'ws1', 'cluster', '0708-a') }]);

    const runsHttp = fakeDbx((u) => u.startsWith('/api/2.2/jobs/runs/list')
      ? { runs: [{ run_id: 9001, run_name: 'run-1', job_id: 811, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } }] } : null);
    const runs = await collector('databricks_job_runs').collect(ctx(runsHttp));
    expect(runs.resources[0].nativeId).toBe('9001');
    expect(runs.resources[0].health).toBe('healthy'); // TERMINATED + SUCCESS
    expect(runs.resources[0].relationships).toEqual([{ type: 'member_of', targetId: makeResourceId('databricks', 'ws1', 'job', '811') }]);
  });
});

describe('Databricks Unity Catalog', () => {
  it('a catalog is member_of its metastore (type-precise id)', async () => {
    const http = fakeDbx((u) => u.startsWith('/api/2.1/unity-catalog/catalogs')
      ? { catalogs: [{ name: 'PROD', catalog_type: 'MANAGED_CATALOG', metastore_id: 'meta-1' }] } : null);
    const p = await collector('databricks_catalogs').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('PROD');
    expect(p.resources[0].relationships).toEqual([{ type: 'member_of', targetId: makeResourceId('databricks', 'ws1', 'metastore', 'meta-1') }]);
  });

  it('the metastore is a single workspace-level object (metastore_summary)', async () => {
    const http = fakeDbx((u) => u.startsWith('/api/2.1/unity-catalog/metastore_summary')
      ? { metastore_id: 'meta-1', name: 'primary', cloud: 'aws', region: 'us-east-1' } : null);
    const p = await collector('databricks_metastores').collect(ctx(http));
    expect(p.resources).toHaveLength(1);
    expect(p.resources[0].nativeId).toBe('meta-1');
    expect(p.resources[0].attributes).toMatchObject({ cloud: 'aws', region: 'us-east-1' });
  });

  it('schemas fan out per catalog, each member_of its catalog (type-precise id)', async () => {
    const http = fakeDbx((u) => {
      if (u.startsWith('/api/2.1/unity-catalog/catalogs')) return { catalogs: [{ name: 'PROD' }] };
      if (u.startsWith('/api/2.1/unity-catalog/schemas')) return { schemas: [{ name: 'PUBLIC', full_name: 'PROD.PUBLIC', owner: 'admin' }] };
      return null;
    });
    const p = await collector('databricks_schemas').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('PROD.PUBLIC');
    expect(p.resources[0].relationships).toEqual([{ type: 'member_of', targetId: makeResourceId('databricks', 'ws1', 'catalog', 'PROD') }]);
  });

  it('tables fan out per (catalog, schema), each member_of its schema (type-precise id)', async () => {
    const http = fakeDbx((u) => {
      if (u.startsWith('/api/2.1/unity-catalog/catalogs')) return { catalogs: [{ name: 'PROD' }] };
      if (u.startsWith('/api/2.1/unity-catalog/schemas')) return { schemas: [{ name: 'PUBLIC' }] };
      if (u.startsWith('/api/2.1/unity-catalog/tables')) return { tables: [{ name: 'CUSTOMERS', full_name: 'PROD.PUBLIC.CUSTOMERS', table_type: 'MANAGED' }] };
      return null;
    });
    const p = await collector('databricks_tables').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('PROD.PUBLIC.CUSTOMERS');
    expect(p.resources[0].relationships).toEqual([{ type: 'member_of', targetId: makeResourceId('databricks', 'ws1', 'schema', 'PROD.PUBLIC') }]);
  });

  it('an external location uses its storage credential (type-precise id)', async () => {
    const http = fakeDbx((u) => u.startsWith('/api/2.1/unity-catalog/external-locations')
      ? { external_locations: [{ name: 'raw-zone', url: 's3://bucket/raw', credential_name: 's3-cred' }] } : null);
    const p = await collector('databricks_external_locations').collect(ctx(http));
    expect(p.resources[0].relationships).toEqual([{ type: 'uses', targetId: makeResourceId('databricks', 'ws1', 'storage_credential', 's3-cred') }]);
  });
});

describe('Databricks notebooks — bounded workspace-tree walk', () => {
  it('walks directories breadth-first and emits NOTEBOOK objects', async () => {
    const http = fakeDbx((u) => {
      if (!u.includes('/api/2.0/workspace/list')) return null;
      if (u.includes('%2FUsers')) return { objects: [{ object_type: 'NOTEBOOK', path: '/Users/etl', language: 'PYTHON' }] };
      return { objects: [{ object_type: 'DIRECTORY', path: '/Users' }, { object_type: 'NOTEBOOK', path: '/top', language: 'SQL' }] };
    });
    const p = await collector('databricks_notebooks').collect(ctx(http));
    expect(p.resources.map((r) => r.name).sort()).toEqual(['etl', 'top']);
    expect(p.resources.find((r) => r.name === 'etl')!.attributes).toMatchObject({ path: '/Users/etl', language: 'PYTHON' });
  });
});

describe('Databricks Resource Graph projection', () => {
  it('projects Metastore + Catalog + Schema + Table and resolves the member_of containment tree', async () => {
    const http = fakeDbx((u) => {
      if (u.startsWith('/api/2.1/unity-catalog/metastore_summary')) return { metastore_id: 'meta-1', name: 'primary' };
      if (u.startsWith('/api/2.1/unity-catalog/catalogs')) return { catalogs: [{ name: 'PROD', metastore_id: 'meta-1' }] };
      if (u.startsWith('/api/2.1/unity-catalog/schemas')) return { schemas: [{ name: 'PUBLIC', full_name: 'PROD.PUBLIC' }] };
      if (u.startsWith('/api/2.1/unity-catalog/tables')) return { tables: [{ name: 'CUSTOMERS', full_name: 'PROD.PUBLIC.CUSTOMERS' }] };
      return null;
    });
    const resources = [
      ...(await collector('databricks_metastores').collect(ctx(http))).resources,
      ...(await collector('databricks_catalogs').collect(ctx(http))).resources,
      ...(await collector('databricks_schemas').collect(ctx(http))).resources,
      ...(await collector('databricks_tables').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // catalog member_of metastore + schema member_of catalog + table member_of schema = 3 resolved edges.
    expect(model.edges).toHaveLength(3);
    expect(model.edges.every((e) => e.type === 'member_of')).toBe(true);
    const metaId = makeResourceId('databricks', 'ws1', 'metastore', 'meta-1');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === metaId)).toBe(true);
  });
});

describe('Databricks discovery resilience — degrade vs tolerate (no false-healthy)', () => {
  /** A GET fake whose router may THROW a transport error for a given URL. */
  const throwingDbx = (router: (url: string) => Rec | Error | null): DiscoveryHttp => ({
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req: DiscoveryRequest) => {
      const r = router(req.url);
      if (r instanceof Error) throw r;
      return { status: 200, headers: {}, text: r == null ? '{}' : JSON.stringify(r) };
    },
  });

  it('notebook walk propagates a NetworkError on a SUBdirectory (offline mid-walk degrades, never partial-healthy)', async () => {
    const http = throwingDbx((u) => {
      if (!u.includes('/api/2.0/workspace/list')) return null;
      if (u.includes('%2FUsers')) return new NetworkError('connection reset');
      return { objects: [{ object_type: 'DIRECTORY', path: '/Users' }, { object_type: 'NOTEBOOK', path: '/top' }] };
    });
    await expect(collector('databricks_notebooks').collect(ctx(http))).rejects.toBeInstanceOf(NetworkError);
  });

  it('notebook walk TOLERATES a per-folder 403 on a subdirectory (Databricks workspace ACL) and returns readable notebooks', async () => {
    const http = throwingDbx((u) => {
      if (!u.includes('/api/2.0/workspace/list')) return null;
      if (u.includes('%2Fsecret')) return new AuthError('folder denied', 403);
      return { objects: [{ object_type: 'DIRECTORY', path: '/secret' }, { object_type: 'NOTEBOOK', path: '/visible', language: 'PYTHON' }] };
    });
    const p = await collector('databricks_notebooks').collect(ctx(http));
    expect(p.resources.map((r) => r.name)).toEqual(['visible']);
  });

  it('tables DEGRADE when every catalog schema-list fails non-systemically (no false-healthy 0 tables)', async () => {
    const http = throwingDbx((u) => {
      if (u.startsWith('/api/2.1/unity-catalog/catalogs')) return { catalogs: [{ name: 'PROD' }, { name: 'ANALYTICS' }] };
      if (u.startsWith('/api/2.1/unity-catalog/schemas')) return new HttpError(500, 'uc control-plane incident', true);
      return null;
    });
    await expect(collector('databricks_tables').collect(ctx(http))).rejects.toBeInstanceOf(HttpError);
  });

  it('tables TOLERATE a single unreadable catalog and still return tables from readable ones', async () => {
    const http = throwingDbx((u) => {
      if (u.startsWith('/api/2.1/unity-catalog/catalogs')) return { catalogs: [{ name: 'PROD' }, { name: 'LOCKED' }] };
      if (u.startsWith('/api/2.1/unity-catalog/schemas')) {
        return u.includes('catalog_name=LOCKED') ? new HttpError(500, 'locked', true) : { schemas: [{ name: 'PUBLIC' }] };
      }
      if (u.startsWith('/api/2.1/unity-catalog/tables')) return { tables: [{ name: 'CUSTOMERS', full_name: 'PROD.PUBLIC.CUSTOMERS' }] };
      return null;
    });
    const p = await collector('databricks_tables').collect(ctx(http));
    expect(p.resources.map((r) => r.nativeId)).toEqual(['PROD.PUBLIC.CUSTOMERS']);
  });
});

describe('Databricks platform — one adapter, five domains, sixteen collectors', () => {
  it('the collectors span compute / databases / storage / security / serverless', () => {
    const domains = new Set(DATABRICKS_COLLECTORS.map((c) => c.domain));
    for (const d of ['compute', 'databases', 'storage', 'security', 'serverless'] as const) expect(domains.has(d)).toBe(true);
    expect(DATABRICKS_COLLECTORS).toHaveLength(16);
  });
});
