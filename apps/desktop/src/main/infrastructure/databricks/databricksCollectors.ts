/**
 * Databricks DomainCollectors (P6.9). Each collector discovers ONE Databricks object type via the P6.0
 * `DomainCollector` contract — it lists the objects through the bearer transport, maps each into a `CloudResource`
 * with its typed relationships, and returns a `DiscoveryPage`. The Discovery Engine degrades a domain on 403 (a
 * scoped PAT lacking a grant → unauthorized) / 404 (a service not enabled → unprovisioned) and sinks the resources
 * into the Resource Store + Graph.
 *
 * Databricks specifics: the WORKSPACE is the scope. List endpoints paginate on `next_page_token` (drained inside
 * `dbxList`), returning one `DiscoveryPage` per collector (Pattern B). Objects form a containment tree — a schema
 * is `member_of` its catalog, a table/volume `member_of` its schema, a catalog `member_of` its metastore — and a
 * job `runs_on` its cluster, a run `member_of` its job, an external location `uses` its storage credential. Every
 * containment/usage edge with a KNOWN target type is emitted as the TYPE-PRECISE resolved id (`ref`), so it binds
 * exactly even when two object types share a native id. Unity Catalog tables/volumes are discovered by a BOUNDED
 * per-(catalog, schema) fan-out (`MAX_FANOUT`) and notebooks by a BOUNDED workspace-tree walk (`MAX_DIRS`), so a
 * large workspace under-reports rather than issuing an unbounded number of requests — see the report.
 */
import {
  makeResource,
  makeResourceId,
  type DiscoveryContext,
  type DomainCollector,
  type DiscoveryPage,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { AuthError, NetworkError } from '../../unified/sync/http';
import { dbxGet, dbxList } from './databricksClient';

/** Bound the Unity Catalog table/volume fan-out (per-(catalog, schema)) + the notebook workspace-tree walk. */
export const MAX_FANOUT = 200;
export const MAX_DIRS = 200;

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
};

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean => v === true || String(v).trim().toLowerCase() === 'true';
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const enc = encodeURIComponent;
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
/** A type-precise relationship target (the target's full resource id, incl. type) so a known-type edge binds
 *  exactly via `byId` — avoiding cross-type native-id collisions (a cluster and a job sharing an id). */
const ref = (ctx: DiscoveryContext, type: string, nativeId: string | null): string | null =>
  nativeId ? makeResourceId(ctx.platformId, ctx.accountId, type, nativeId) : null;
/** A qualified Unity Catalog name (`catalog`, `catalog.schema`, `catalog.schema.object`). */
const qual = (...parts: Array<string | null>): string => parts.filter((p): p is string => !!p).join('.');
const page = (resources: DiscoveryPage['resources']): DiscoveryPage => ({ resources, cursor: null, hasMore: false });
/** A systemic transport failure (bad token / offline) — must degrade the domain, never be swallowed per-source. */
const isSystemic = (err: unknown): boolean => err instanceof AuthError || err instanceof NetworkError;

function build(ctx: DiscoveryContext, domain: InfrastructureDomain, resourceType: string, m: MappedResource) {
  return makeResource({
    platformId: ctx.platformId,
    provider: 'databricks',
    accountId: ctx.accountId,
    domain,
    resourceType,
    region: null, // the workspace IS the scope.
    now: ctx.now,
    nativeId: m.nativeId,
    name: m.name,
    status: m.status,
    health: m.health,
    tags: m.tags,
    attributes: m.attributes,
    relationships: m.relationships,
  });
}

/** Run an async fn per source (catalog/dir), tolerating a per-source non-systemic failure but degrading on a
 *  systemic (auth/offline) failure OR when EVERY source fails. */
async function forEachSource<T>(sources: T[], fn: (src: T) => Promise<void>): Promise<void> {
  let lastErr: unknown = null;
  let errored = 0;
  for (const src of sources) {
    try {
      await fn(src);
    } catch (err) {
      if (isSystemic(err)) throw err;
      lastErr = err;
      errored += 1;
    }
  }
  if (errored > 0 && errored === sources.length && lastErr) throw lastErr;
}

/* ── health mappers ──────────────────────────────────────────────────────────── */

function clusterHealth(state: string | null): ResourceHealth {
  switch (state) {
    case 'RUNNING': return 'healthy';
    case 'ERROR': return 'critical';
    case 'TERMINATED': return 'unknown'; // intentional cost state
    case 'PENDING': case 'RESTARTING': case 'RESIZING': case 'TERMINATING': return 'degraded';
    default: return 'unknown';
  }
}
function warehouseHealth(state: string | null): ResourceHealth {
  switch (state) {
    case 'RUNNING': return 'healthy';
    case 'STOPPED': return 'unknown';
    case 'STARTING': case 'STOPPING': return 'degraded';
    case 'DELETED': case 'DELETING': return 'critical';
    default: return 'unknown';
  }
}
function runHealth(lifecycle: string | null, result: string | null): ResourceHealth {
  if (lifecycle === 'TERMINATED') return result === 'SUCCESS' ? 'healthy' : result === 'CANCELED' ? 'degraded' : 'critical';
  if (lifecycle === 'INTERNAL_ERROR') return 'critical';
  if (lifecycle === 'RUNNING' || lifecycle === 'PENDING' || lifecycle === 'QUEUED' || lifecycle === 'TERMINATING') return 'degraded';
  return 'unknown';
}

/* ── simple (flat, paginated) collectors ───────────────────────────────────────── */

interface SimpleSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  path: string;
  listKey: string;
  opts?: { tokenParam?: string; maxResults?: number; limit?: number };
  map: (row: Rec, ctx: DiscoveryContext) => MappedResource;
}
function simpleCollector(spec: SimpleSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const rows = await dbxList(ctx.http, spec.path, spec.listKey, spec.opts);
      const resources = rows
        .map((row) => spec.map(row, ctx))
        .filter((m) => m.nativeId)
        .map((m) => build(ctx, spec.domain, spec.resourceType, m));
      return page(resources);
    },
  };
}

const SIMPLE: SimpleSpec[] = [
  {
    id: 'databricks_clusters', domain: 'compute', label: 'Clusters', resourceType: 'cluster', path: '/api/2.1/clusters/list', listKey: 'clusters',
    map: (c) => ({ nativeId: str(c.cluster_id) ?? '', name: str(c.cluster_name) || str(c.cluster_id) || 'cluster', status: str(c.state), health: clusterHealth(str(c.state)), attributes: { state: str(c.state), sparkVersion: str(c.spark_version), nodeType: str(c.node_type_id), autoterminationMinutes: num(c.autotermination_minutes), creator: str(c.creator_user_name) } }),
  },
  {
    id: 'databricks_sql_warehouses', domain: 'compute', label: 'SQL Warehouses', resourceType: 'sql_warehouse', path: '/api/2.0/sql/warehouses', listKey: 'warehouses',
    map: (w) => ({ nativeId: str(w.id) ?? '', name: str(w.name) || 'warehouse', status: str(w.state), health: warehouseHealth(str(w.state)), attributes: { state: str(w.state), clusterSize: str(w.cluster_size), autoStopMins: num(w.auto_stop_mins), serverless: bool(w.enable_serverless_compute), creator: str(w.creator_name) } }),
  },
  {
    id: 'databricks_jobs', domain: 'compute', label: 'Jobs', resourceType: 'job', path: '/api/2.2/jobs/list?expand_tasks=true', listKey: 'jobs',
    map: (j, ctx) => {
      const settings = obj(j.settings);
      const clusterIds = new Set<string>();
      for (const task of arr(settings.tasks)) {
        const cid = str((task as Rec).existing_cluster_id);
        if (cid) clusterIds.add(cid);
      }
      return {
        nativeId: str(j.job_id) ?? '', name: str(settings.name) || `job-${str(j.job_id)}`, health: 'healthy',
        attributes: { creator: str(j.creator_user_name), tasks: arr(settings.tasks).length },
        relationships: [...clusterIds].flatMap((cid) => rel('runs_on', ref(ctx, 'cluster', cid))),
      };
    },
  },
  {
    id: 'databricks_job_runs', domain: 'compute', label: 'Job Runs', resourceType: 'job_run', path: '/api/2.2/jobs/runs/list', listKey: 'runs', opts: { limit: 20 },
    map: (r, ctx) => {
      const state = obj(r.state);
      const lifecycle = str(state.life_cycle_state);
      const result = str(state.result_state);
      return { nativeId: str(r.run_id) ?? '', name: str(r.run_name) || `run-${str(r.run_id)}`, status: lifecycle, health: runHealth(lifecycle, result), attributes: { lifecycleState: lifecycle, resultState: result, jobId: str(r.job_id) }, relationships: rel('member_of', ref(ctx, 'job', str(r.job_id))) };
    },
  },
  {
    id: 'databricks_catalogs', domain: 'databases', label: 'Catalogs', resourceType: 'catalog', path: '/api/2.1/unity-catalog/catalogs', listKey: 'catalogs',
    map: (c, ctx) => ({ nativeId: str(c.name) ?? '', name: str(c.name) || 'catalog', status: str(c.catalog_type), health: 'healthy', attributes: { owner: str(c.owner), type: str(c.catalog_type), metastore: str(c.metastore_id) }, relationships: rel('member_of', ref(ctx, 'metastore', str(c.metastore_id))) }),
  },
  {
    id: 'databricks_storage_credentials', domain: 'security', label: 'Storage Credentials', resourceType: 'storage_credential', path: '/api/2.1/unity-catalog/storage-credentials', listKey: 'storage_credentials',
    map: (s) => ({ nativeId: str(s.name) ?? '', name: str(s.name) || 'storage-credential', health: 'healthy', attributes: { owner: str(s.owner), readOnly: bool(s.read_only) } }),
  },
  {
    id: 'databricks_external_locations', domain: 'storage', label: 'External Locations', resourceType: 'external_location', path: '/api/2.1/unity-catalog/external-locations', listKey: 'external_locations',
    map: (e, ctx) => ({ nativeId: str(e.name) ?? '', name: str(e.name) || 'external-location', health: 'healthy', attributes: { url: str(e.url), credential: str(e.credential_name), owner: str(e.owner), readOnly: bool(e.read_only) }, relationships: rel('uses', ref(ctx, 'storage_credential', str(e.credential_name))) }),
  },
  {
    id: 'databricks_repos', domain: 'serverless', label: 'Repos', resourceType: 'repo', path: '/api/2.0/repos', listKey: 'repos', opts: { tokenParam: 'next_page_token' },
    map: (r) => ({ nativeId: str(r.id) ?? '', name: str(r.path) || str(r.id) || 'repo', status: str(r.provider), health: 'healthy', attributes: { path: str(r.path), url: str(r.url), provider: str(r.provider), branch: str(r.branch) } }),
  },
  {
    id: 'databricks_serving_endpoints', domain: 'serverless', label: 'Serving Endpoints', resourceType: 'serving_endpoint', path: '/api/2.0/serving-endpoints', listKey: 'endpoints',
    map: (e) => {
      const config = obj(e.config);
      const modelNames = new Set<string>();
      for (const se of arr(config.served_entities)) { const n = str((se as Rec).entity_name); if (n) modelNames.add(n); }
      for (const sm of arr(config.served_models)) { const n = str((sm as Rec).model_name); if (n) modelNames.add(n); }
      const ready = str(obj(e.state).ready);
      // A served entity may be a workspace-registry model OR a UC model (full name) — target the bare name so the
      // graph resolves it case-insensitively to whichever exists.
      return { nativeId: str(e.name) ?? '', name: str(e.name) || 'endpoint', status: ready, health: ready === 'READY' ? 'healthy' : 'degraded', attributes: { ready, creator: str(e.creator) }, relationships: [...modelNames].flatMap((m) => rel('uses', m)) };
    },
  },
  {
    id: 'databricks_ml_models', domain: 'serverless', label: 'ML Models', resourceType: 'ml_model', path: '/api/2.0/mlflow/registered-models/list', listKey: 'registered_models',
    map: (m) => ({ nativeId: str(m.name) ?? '', name: str(m.name) || 'model', health: 'healthy', attributes: { user: str(m.user_id), versions: arr(m.latest_versions).length } }),
  },
];

/* ── custom collectors (single object / fan-out / recursive walk) ───────────────── */

/** The workspace itself — one synthetic root resource for the discovery scope. */
const workspaceCollector: DomainCollector = {
  id: 'databricks_workspaces', domain: 'compute', label: 'Workspaces', resourceTypes: ['workspace'],
  collect: async (ctx) => {
    const id = ctx.accountId || 'workspace';
    return page([build(ctx, 'compute', 'workspace', { nativeId: id, name: id, health: 'healthy', attributes: {} })]);
  },
};

/** The workspace's assigned Unity Catalog metastore (a single object; workspace-level, not the admin-only list). */
const metastoreCollector: DomainCollector = {
  id: 'databricks_metastores', domain: 'databases', label: 'Metastores', resourceTypes: ['metastore'],
  collect: async (ctx) => {
    const m = await dbxGet(ctx.http, '/api/2.1/unity-catalog/metastore_summary');
    const id = str(m.metastore_id);
    if (!id) return page([]);
    return page([build(ctx, 'databases', 'metastore', { nativeId: id, name: str(m.name) || id, health: 'healthy', attributes: { cloud: str(m.cloud), region: str(m.region), owner: str(m.owner) } })]);
  },
};

/** Schemas — one list per catalog (a per-catalog fan-out), each `member_of` its catalog. */
const schemaCollector: DomainCollector = {
  id: 'databricks_schemas', domain: 'databases', label: 'Schemas', resourceTypes: ['schema'],
  collect: async (ctx) => {
    const out: DiscoveryPage['resources'] = [];
    const catalogs = await dbxList(ctx.http, '/api/2.1/unity-catalog/catalogs', 'catalogs');
    const catNames = catalogs.map((c) => str(c.name)).filter((x): x is string => !!x);
    await forEachSource(catNames, async (catName) => {
      const schemas = await dbxList(ctx.http, `/api/2.1/unity-catalog/schemas?catalog_name=${enc(catName)}`, 'schemas');
      for (const s of schemas) {
        const full = str(s.full_name) || qual(catName, str(s.name));
        if (!full) continue;
        out.push(build(ctx, 'databases', 'schema', { nativeId: full, name: str(s.name) || 'schema', health: 'healthy', attributes: { owner: str(s.owner), catalog: catName }, relationships: rel('member_of', ref(ctx, 'catalog', catName)) }));
      }
    });
    return page(out);
  },
};

/** Enumerate up to `MAX_FANOUT` (catalog, schema) pairs, skipping a catalog whose schemas can't be read. */
async function enumerateSchemaPairs(ctx: DiscoveryContext): Promise<Array<{ catalog: string; schema: string }>> {
  const pairs: Array<{ catalog: string; schema: string }> = [];
  const catalogs = await dbxList(ctx.http, '/api/2.1/unity-catalog/catalogs', 'catalogs');
  let attempted = 0;
  let errored = 0;
  let lastErr: unknown = null;
  for (const cat of catalogs) {
    const catName = str(cat.name);
    if (!catName) continue;
    attempted += 1;
    let schemas: Rec[];
    try {
      schemas = await dbxList(ctx.http, `/api/2.1/unity-catalog/schemas?catalog_name=${enc(catName)}`, 'schemas');
    } catch (err) {
      if (isSystemic(err)) throw err;
      lastErr = err;
      errored += 1;
      continue; // a catalog we can't read is skipped
    }
    for (const sch of schemas) {
      const schName = str(sch.name);
      if (!schName) continue;
      pairs.push({ catalog: catName, schema: schName });
      if (pairs.length >= MAX_FANOUT) return pairs;
    }
  }
  // If EVERY catalog we attempted failed (non-systemically) and nothing was enumerated, degrade the domain rather
  // than reporting a false-healthy "0 tables/volumes" — mirrors forEachSource's all-sources-failed guard so the
  // table/volume collectors stay consistent with the sibling schema collector during a UC control-plane incident.
  if (pairs.length === 0 && errored > 0 && errored === attempted && lastErr) throw lastErr;
  return pairs;
}

function ucChildCollector(id: string, domain: InfrastructureDomain, label: string, resourceType: string, endpoint: string, listKey: string, extraQuery: string, mapAttrs: (row: Rec) => ResourceAttributes): DomainCollector {
  return {
    id, domain, label, resourceTypes: [resourceType],
    collect: async (ctx) => {
      const out: DiscoveryPage['resources'] = [];
      const pairs = await enumerateSchemaPairs(ctx);
      await forEachSource(pairs, async ({ catalog, schema }) => {
        const rows = await dbxList(ctx.http, `/api/2.1/unity-catalog/${endpoint}?catalog_name=${enc(catalog)}&schema_name=${enc(schema)}${extraQuery}`, listKey);
        for (const row of rows) {
          const full = str(row.full_name) || qual(catalog, schema, str(row.name));
          if (!full) continue;
          out.push(build(ctx, domain, resourceType, { nativeId: full, name: str(row.name) || resourceType, health: 'healthy', attributes: { ...mapAttrs(row), catalog, schema }, relationships: rel('member_of', ref(ctx, 'schema', qual(catalog, schema))) }));
        }
      });
      return page(out);
    },
  };
}

/** Tables — a bounded per-(catalog, schema) fan-out; each `member_of` its schema. */
const tableCollector = ucChildCollector('databricks_tables', 'databases', 'Tables', 'table', 'tables', 'tables', '&omit_columns=true&omit_properties=true&omit_username=true', (t) => ({ owner: str(t.owner), tableType: str(t.table_type), format: str(t.data_source_format), storageLocation: str(t.storage_location) }));

/** Volumes — a bounded per-(catalog, schema) fan-out; each `member_of` its schema. */
const volumeCollector = ucChildCollector('databricks_volumes', 'storage', 'Volumes', 'volume', 'volumes', 'volumes', '', (v) => ({ owner: str(v.owner), volumeType: str(v.volume_type), storageLocation: str(v.storage_location) }));

/** Notebooks — a bounded breadth-first walk of the workspace tree (`workspace/list` is single-level). */
const notebookCollector: DomainCollector = {
  id: 'databricks_notebooks', domain: 'serverless', label: 'Notebooks', resourceTypes: ['notebook'],
  collect: async (ctx) => {
    const out: DiscoveryPage['resources'] = [];
    const queue: string[] = ['/'];
    let walked = 0;
    while (queue.length > 0 && walked < MAX_DIRS) {
      const path = queue.shift() as string;
      walked += 1;
      let objects: Rec[];
      try {
        objects = arr(obj(await dbxGet(ctx.http, `/api/2.0/workspace/list?path=${enc(path)}`)).objects);
      } catch (err) {
        // Offline is never a per-folder condition — a NetworkError anywhere in the walk must degrade the domain,
        // never silently under-report a partial tree as healthy.
        if (err instanceof NetworkError) throw err;
        // A systemic auth failure at the ROOT degrades; a subdir 403 may be a legitimate per-folder workspace ACL
        // (a valid PAT can be denied a single folder), so it is tolerated and that subtree is skipped.
        if (isSystemic(err) && walked === 1) throw err;
        continue;
      }
      for (const o of objects) {
        const type = str((o as Rec).object_type);
        const p = str((o as Rec).path);
        if (!p) continue;
        if (type === 'DIRECTORY' || type === 'REPO') {
          if (queue.length + walked < MAX_DIRS) queue.push(p);
        } else if (type === 'NOTEBOOK') {
          out.push(build(ctx, 'serverless', 'notebook', { nativeId: p, name: p.split('/').pop() || p, health: 'healthy', attributes: { path: p, language: str((o as Rec).language) } }));
        }
      }
    }
    return page(out);
  },
};

/** Every Databricks collector, across the five Databricks infrastructure domains. */
export const DATABRICKS_COLLECTORS: DomainCollector[] = [
  workspaceCollector,
  ...SIMPLE.map(simpleCollector),
  metastoreCollector,
  schemaCollector,
  tableCollector,
  volumeCollector,
  notebookCollector,
];
