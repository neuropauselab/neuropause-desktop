/**
 * P6.9 — Databricks automation actions (HIGH PRIVILEGE).
 *
 * Confirmation-gated mutations against the Databricks REST API over the SAME host-pinned PAT transport discovery
 * uses: start / stop / restart a cluster, run a job, cancel a run, and start / stop a SQL warehouse. Every one is
 * `mutates: true`, so the shared `InfraActionExecutor` refuses it without an explicit human confirmation and AI can
 * never reach it. Discovery runs read-only `list`/`get` calls; these actions are the only writes, and the
 * discovery PAT's own Databricks grants govern whether they run (a denial surfaces as a least-privilege message).
 *
 * The transport is already pinned to the ONE configured workspace host, so an action only builds RELATIVE paths.
 * Cluster / warehouse ids are opaque strings — validated against a strict `[A-Za-z0-9-]` charset before use; job /
 * run ids are int64 numerics — validated to ≤15 digits (well under 2^53) and sent as JSON numbers. The warehouse id
 * is interpolated into the request PATH, so it is additionally `encodeURIComponent`-escaped (defense-in-depth with
 * the strict charset + host pin) — every other id travels only in a JSON body.
 */
import { dbxPost } from './databricksClient';
import { reqStr, InfraActionInputError, type InfraAction } from '../actionSdk';

/* ── strict validators (fail closed BEFORE any request is built) ─────────────────────────────────── */

/** An opaque Databricks cluster / warehouse id (`0708-...-abc123`) — the strict charset excludes `/`, `?`, `#`,
 *  whitespace, and every other path/metachar, so it is safe to interpolate into a path once escaped. */
const OPAQUE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
function opaqueId(v: string, what: string): string {
  if (!OPAQUE_ID_RE.test(v)) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return v;
}
/** A Databricks numeric int64 id (job_id / run_id). Capped at 15 digits so `Number()` stays exact (< 2^53). */
const NUMERIC_ID_RE = /^[0-9]{1,15}$/;
function numericId(v: string, what: string): number {
  if (!NUMERIC_ID_RE.test(v)) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return Number(v);
}

export const DATABRICKS_ACTIONS: InfraAction[] = [
  {
    id: 'dbx_cluster_start', label: 'Start Cluster', platformId: 'databricks', domain: 'compute',
    description: 'Starts a terminated cluster (spins up compute — incurs cost).', mutates: true, risk: 'medium', targetResourceType: 'cluster',
    params: [{ key: 'clusterId', label: 'Cluster', required: true, hint: '0708-201045-abc123' }],
    run: async (ctx, p) => {
      const clusterId = opaqueId(reqStr(p, 'clusterId'), 'cluster id');
      await dbxPost(ctx.http, '/api/2.1/clusters/start', { cluster_id: clusterId });
      return { ok: true, summary: `Started cluster ${clusterId}`, data: { clusterId } };
    },
  },
  {
    id: 'dbx_cluster_stop', label: 'Stop Cluster', platformId: 'databricks', domain: 'compute',
    description: 'Terminates a running cluster (stops compute billing; state is preserved for a later start).', mutates: true, risk: 'medium', targetResourceType: 'cluster',
    params: [{ key: 'clusterId', label: 'Cluster', required: true, hint: '0708-201045-abc123' }],
    run: async (ctx, p) => {
      const clusterId = opaqueId(reqStr(p, 'clusterId'), 'cluster id');
      await dbxPost(ctx.http, '/api/2.1/clusters/delete', { cluster_id: clusterId });
      return { ok: true, summary: `Stopped cluster ${clusterId}`, data: { clusterId } };
    },
  },
  {
    id: 'dbx_cluster_restart', label: 'Restart Cluster', platformId: 'databricks', domain: 'compute',
    description: 'Restarts a cluster — interrupts any workloads currently running on it.', mutates: true, risk: 'high', targetResourceType: 'cluster',
    params: [{ key: 'clusterId', label: 'Cluster', required: true, hint: '0708-201045-abc123' }],
    run: async (ctx, p) => {
      const clusterId = opaqueId(reqStr(p, 'clusterId'), 'cluster id');
      await dbxPost(ctx.http, '/api/2.1/clusters/restart', { cluster_id: clusterId });
      return { ok: true, summary: `Restarted cluster ${clusterId}`, data: { clusterId } };
    },
  },
  {
    id: 'dbx_job_run', label: 'Run Job', platformId: 'databricks', domain: 'compute',
    description: 'Triggers an immediate run of a job, outside its schedule.', mutates: true, risk: 'high', targetResourceType: 'job',
    params: [{ key: 'jobId', label: 'Job', required: true, hint: '620327932332001' }],
    run: async (ctx, p) => {
      const jobId = numericId(reqStr(p, 'jobId'), 'job id');
      const result = await dbxPost(ctx.http, '/api/2.2/jobs/run-now', { job_id: jobId });
      const runId = typeof result.run_id === 'number' ? result.run_id : null;
      return { ok: true, summary: `Triggered job ${jobId}${runId != null ? ` (run ${runId})` : ''}`, data: { jobId, runId } };
    },
  },
  {
    id: 'dbx_run_cancel', label: 'Cancel Run', platformId: 'databricks', domain: 'compute',
    description: 'Cancels an in-progress job run.', mutates: true, risk: 'high', targetResourceType: 'job_run',
    params: [{ key: 'runId', label: 'Run', required: true, hint: '820327932332009' }],
    run: async (ctx, p) => {
      const runId = numericId(reqStr(p, 'runId'), 'run id');
      await dbxPost(ctx.http, '/api/2.2/jobs/runs/cancel', { run_id: runId });
      return { ok: true, summary: `Cancelled run ${runId}`, data: { runId } };
    },
  },
  {
    id: 'dbx_warehouse_start', label: 'Start Warehouse', platformId: 'databricks', domain: 'compute',
    description: 'Starts a stopped SQL warehouse (spins up compute — incurs cost).', mutates: true, risk: 'medium', targetResourceType: 'sql_warehouse',
    params: [{ key: 'warehouseId', label: 'Warehouse', required: true, hint: '8e7e1a2b3c4d5e6f' }],
    run: async (ctx, p) => {
      const warehouseId = opaqueId(reqStr(p, 'warehouseId'), 'warehouse id');
      await dbxPost(ctx.http, `/api/2.0/sql/warehouses/${encodeURIComponent(warehouseId)}/start`);
      return { ok: true, summary: `Started warehouse ${warehouseId}`, data: { warehouseId } };
    },
  },
  {
    id: 'dbx_warehouse_stop', label: 'Stop Warehouse', platformId: 'databricks', domain: 'compute',
    description: 'Stops a running SQL warehouse (halts compute billing).', mutates: true, risk: 'medium', targetResourceType: 'sql_warehouse',
    params: [{ key: 'warehouseId', label: 'Warehouse', required: true, hint: '8e7e1a2b3c4d5e6f' }],
    run: async (ctx, p) => {
      const warehouseId = opaqueId(reqStr(p, 'warehouseId'), 'warehouse id');
      await dbxPost(ctx.http, `/api/2.0/sql/warehouses/${encodeURIComponent(warehouseId)}/stop`);
      return { ok: true, summary: `Stopped warehouse ${warehouseId}`, data: { warehouseId } };
    },
  },
];

/** Bind the Databricks actions (used by the executor registration in the runtime composition root). */
export function databricksActions(): InfraAction[] {
  return DATABRICKS_ACTIONS;
}
