/**
 * P6.3 — GCP automation actions through the SHARED confirmation-gated executor (the same `InfraActionExecutor`
 * P6.1 built for AWS and P6.2 extended for Azure). Proves: the confirmation gate refuses a mutation without
 * `confirmed` (and never touches the provider), each action builds the correct host/path/verb with the project
 * taken from `accountId`, the strict path-segment validators fail closed BEFORE any request, the
 * started→completed|failed audit fan-out, and 403 classification. Pure-node; the bearer transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { GCP_ACTIONS } from './gcpActions';

const NOW = '2026-07-13T00:00:00.000Z';
const PROJECT = 'proj-123';

function harness(router: (req: DiscoveryRequest) => { text?: string; error?: Error }) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: 200, headers: {}, text: r.text ?? '' };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, ownsAccount: () => true, /* P13C R7 — these suites act AS the owning tenant; cross-tenant refusal is asserted in infrastructureTenancy.test.ts */ now: () => NOW },
    GCP_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER calls the provider', async () => {
    const { exec, events, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('gcp', PROJECT, 'gcp_vm_reset', { zone: 'us-central1-a', instanceName: 'vm1' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('Compute VM lifecycle (project taken from accountId)', () => {
  it('Start posts the start verb on compute.googleapis.com under the project and audits started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ text: JSON.stringify({ name: 'operation-1' }) }));
    const res = await exec.execute('gcp', PROJECT, 'gcp_vm_start', { zone: 'us-central1-a', instanceName: 'vm1' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Start requested for VM vm1');
    expect(res.data).toMatchObject({ project: PROJECT, zone: 'us-central1-a', instance: 'vm1', operation: 'operation-1' });
    const u = new URL(requests[0].url);
    expect(u.hostname).toBe('compute.googleapis.com');
    expect(u.pathname).toBe(`/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/vm1/start`);
    expect(requests[0].method).toBe('POST');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });
  it('Stop → stop verb; Reset → reset verb', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    await exec.execute('gcp', PROJECT, 'gcp_vm_stop', { zone: 'us-central1-a', instanceName: 'vm1' }, true);
    await exec.execute('gcp', PROJECT, 'gcp_vm_reset', { zone: 'us-central1-a', instanceName: 'vm1' }, true);
    expect(new URL(requests[0].url).pathname.endsWith('/instances/vm1/stop')).toBe(true);
    expect(new URL(requests[1].url).pathname.endsWith('/instances/vm1/reset')).toBe(true);
  });
});

describe('Cloud SQL + GKE node + Secret version', () => {
  it('Restart Cloud SQL posts the restart verb on sqladmin', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    await exec.execute('gcp', PROJECT, 'gcp_sql_restart', { instanceName: 'db1' }, true);
    const u = new URL(requests[0].url);
    expect(u.hostname).toBe('sqladmin.googleapis.com');
    expect(u.pathname).toBe(`/v1/projects/${PROJECT}/instances/db1/restart`);
  });
  it('Restart GKE node resets the node instance via compute', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('gcp', PROJECT, 'gcp_gke_node_reset', { zone: 'us-central1-a', instanceName: 'gke-c-pool-abc' }, true);
    expect(res.ok).toBe(true);
    expect(new URL(requests[0].url).pathname).toBe(`/compute/v1/projects/${PROJECT}/zones/us-central1-a/instances/gke-c-pool-abc/reset`);
  });
  it('Rotate Secret disables the given version', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('gcp', PROJECT, 'gcp_secret_disable_version', { secretName: 'db-pass', version: '3' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Disabled version 3 of secret db-pass');
    const u = new URL(requests[0].url);
    expect(u.hostname).toBe('secretmanager.googleapis.com');
    expect(u.pathname).toBe(`/v1/projects/${PROJECT}/secrets/db-pass/versions/3:disable`);
  });
});

describe('param SSRF guards + audit + classification', () => {
  it('rejects a crafted project id (from accountId) before any request', async () => {
    const { exec, requests, events } = harness(() => ({ text: '' }));
    const res = await exec.execute('gcp', 'p@evil.com', 'gcp_vm_start', { zone: 'us-central1-a', instanceName: 'vm1' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid GCP project id');
    expect(requests).toHaveLength(0);
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });
  it('rejects a crafted zone and a crafted secret version', async () => {
    const bad = harness(() => ({ text: '' }));
    const zoneRes = await bad.exec.execute('gcp', PROJECT, 'gcp_vm_start', { zone: 'a/../b', instanceName: 'vm1' }, true);
    expect(zoneRes.message).toContain('Invalid zone');
    const verRes = await bad.exec.execute('gcp', PROJECT, 'gcp_secret_disable_version', { secretName: 'db-pass', version: 'DROP' }, true);
    expect(verRes.message).toContain('Invalid secret version');
    expect(bad.requests).toHaveLength(0);
  });
  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('PERMISSION_DENIED', 403) }));
    const res = await exec.execute('gcp', PROJECT, 'gcp_vm_stop', { zone: 'us-central1-a', instanceName: 'vm1' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });
  it('lists exactly the six high-privilege GCP actions', () => {
    const { exec } = harness(() => ({ text: '' }));
    const cat = exec.list('gcp');
    expect(cat.map((a) => a.id).sort()).toEqual(['gcp_gke_node_reset', 'gcp_secret_disable_version', 'gcp_sql_restart', 'gcp_vm_reset', 'gcp_vm_start', 'gcp_vm_stop'].sort());
    expect(cat.every((a) => a.mutates && a.risk === 'high' && a.platformId === 'gcp')).toBe(true);
  });
});
