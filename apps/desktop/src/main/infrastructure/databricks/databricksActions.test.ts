/**
 * P6.9 — Databricks automation actions through the SHARED confirmation-gated executor. Proves: the gate refuses a
 * mutation without `confirmed` (and never issues a request), each action builds the correct REST path + JSON body
 * (cluster start/delete/restart, jobs run-now, runs cancel, warehouse start/stop), the STRICT id validators fail
 * closed on a bad opaque id (path-injection attempt) or a non-numeric / oversized job/run id BEFORE any request,
 * the started→completed|failed audit fan-out, and 403 classification. Pure-node; the transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { DATABRICKS_ACTIONS } from './databricksActions';

const NOW = '2026-07-13T00:00:00.000Z';

function harness(router: (req: DiscoveryRequest) => { status?: number; text?: string; error?: Error }) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: r.status ?? 200, headers: {}, text: r.text ?? '{}' };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, now: () => NOW },
    DATABRICKS_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);
const bodyOf = (req: DiscoveryRequest): Record<string, unknown> => JSON.parse(req.body ?? '{}') as Record<string, unknown>;

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER issues a request', async () => {
    const { exec, events, requests } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('databricks', 'ws1', 'dbx_cluster_stop', { clusterId: '0708-a' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('cluster + job + warehouse requests', () => {
  it('cluster start / stop / restart POST the right path + cluster_id body, audit started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('databricks', 'ws1', 'dbx_cluster_start', { clusterId: '0708-a' }, true);
    expect(requests[0].url).toBe('/api/2.1/clusters/start');
    expect(bodyOf(requests[0])).toEqual({ cluster_id: '0708-a' });
    await exec.execute('databricks', 'ws1', 'dbx_cluster_stop', { clusterId: '0708-a' }, true);
    expect(requests[1].url).toBe('/api/2.1/clusters/delete');
    await exec.execute('databricks', 'ws1', 'dbx_cluster_restart', { clusterId: '0708-a' }, true);
    expect(requests[2].url).toBe('/api/2.1/clusters/restart');
    expect(types(events).slice(0, 2)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('run job sends job_id as a NUMBER and surfaces the returned run_id', async () => {
    const { exec, requests } = harness(() => ({ text: JSON.stringify({ run_id: 555 }) }));
    const res = await exec.execute('databricks', 'ws1', 'dbx_job_run', { jobId: '811' }, true);
    expect(requests[0].url).toBe('/api/2.2/jobs/run-now');
    expect(bodyOf(requests[0])).toEqual({ job_id: 811 }); // numeric, not "811"
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ jobId: 811, runId: 555 });
  });

  it('cancel run sends run_id as a NUMBER', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('databricks', 'ws1', 'dbx_run_cancel', { runId: '9001' }, true);
    expect(requests[0].url).toBe('/api/2.2/jobs/runs/cancel');
    expect(bodyOf(requests[0])).toEqual({ run_id: 9001 });
  });

  it('warehouse start / stop put the id in the PATH (encoded) with no body', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('databricks', 'ws1', 'dbx_warehouse_start', { warehouseId: 'wh-1' }, true);
    expect(requests[0].url).toBe('/api/2.0/sql/warehouses/wh-1/start');
    expect(requests[0].body).toBeUndefined();
    await exec.execute('databricks', 'ws1', 'dbx_warehouse_stop', { warehouseId: 'wh-1' }, true);
    expect(requests[1].url).toBe('/api/2.0/sql/warehouses/wh-1/stop');
  });
});

describe('strict id validation + classification', () => {
  it('rejects a bad opaque id (path-injection attempt) and a non-numeric / oversized id BEFORE any request', async () => {
    const { exec, requests, events } = harness(() => ({ text: '{}' }));
    const injWh = await exec.execute('databricks', 'ws1', 'dbx_warehouse_start', { warehouseId: 'wh/../secret' }, true);
    expect(injWh.message).toContain('Invalid warehouse id');
    const injCl = await exec.execute('databricks', 'ws1', 'dbx_cluster_stop', { clusterId: '0708 a; rm' }, true);
    expect(injCl.message).toContain('Invalid cluster id');
    const badJob = await exec.execute('databricks', 'ws1', 'dbx_job_run', { jobId: 'not-a-number' }, true);
    expect(badJob.message).toContain('Invalid job id');
    const bigJob = await exec.execute('databricks', 'ws1', 'dbx_run_cancel', { runId: '1234567890123456789' }, true); // 19 digits > 15
    expect(bigJob.message).toContain('Invalid run id');
    expect(requests).toHaveLength(0); // fail closed — no request ever issued
    expect(types(events)).toEqual(Array.from({ length: 4 }).flatMap(() => ['infrastructure.action_started', 'infrastructure.action_failed']));
  });

  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('Forbidden', 403) }));
    const res = await exec.execute('databricks', 'ws1', 'dbx_cluster_start', { clusterId: '0708-a' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('lists exactly the seven high-privilege Databricks actions', () => {
    const { exec } = harness(() => ({ text: '{}' }));
    const cat = exec.list('databricks');
    expect(cat.map((a) => a.id).sort()).toEqual(
      ['dbx_cluster_restart', 'dbx_cluster_start', 'dbx_cluster_stop', 'dbx_job_run', 'dbx_run_cancel', 'dbx_warehouse_start', 'dbx_warehouse_stop'].sort(),
    );
    expect(cat.every((a) => a.mutates && a.platformId === 'databricks')).toBe(true);
  });
});
