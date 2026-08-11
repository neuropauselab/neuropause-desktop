/**
 * P6.10 — IaC automation actions through the SHARED confirmation-gated executor: the gate refuses a mutation
 * without confirmation (and issues NO request), the run/refresh/lock/unlock requests build the right path + body,
 * the strict `ws-…` id validator fails closed (incl. the path-interpolated lock/unlock), a Pulumi backend gets a
 * clear non-mutating notice for Terraform-only actions, and the read-only validate/docs actions run without a gate.
 * Pure-node; the transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { InfraActionExecutor } from '../executor';
import { IAC_ACTIONS } from './iacActions';
import type { IacFlavor } from './iacState';

const NOW = '2026-07-14T00:00:00.000Z';
const WS = 'ws-ABC123DEF456';

interface RouteResult { status?: number; text?: string; error?: Error }
function harness(flavor: IacFlavor, router: (req: { method: string; url: string; body?: string }) => RouteResult) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http = {
    flavor,
    organization: 'acme',
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req: DiscoveryRequest) => { requests.push(req); const r = router(req); if (r.error) throw r.error; return { status: r.status ?? 200, headers: {}, text: r.text ?? '{}' }; },
    getArtifact: async (url: string) => router({ method: 'ARTIFACT', url }).text ?? '{}',
    getLocation: async (path: string) => ({ location: null, text: router({ method: 'LOCATION', url: path }).text ?? null }),
  };
  const exec = new InfraActionExecutor({ makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, ownsAccount: () => true, /* P13C R7 — these suites act AS the owning tenant; cross-tenant refusal is asserted in infrastructureTenancy.test.ts */ now: () => NOW }, IAC_ACTIONS);
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);
const bodyOf = (req: DiscoveryRequest): Record<string, unknown> => JSON.parse(req.body ?? '{}') as Record<string, unknown>;

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER issues a request', async () => {
    const { exec, events, requests } = harness('terraform', () => ({ text: '{}' }));
    const res = await exec.execute('iac', 'terraform', 'iac_run_plan', { workspaceId: WS }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('Terraform Cloud run / lock requests', () => {
  it('run plan POSTs a plan-only run for the workspace', async () => {
    const { exec, requests, events } = harness('terraform', () => ({ text: JSON.stringify({ data: { id: 'run-9' } }) }));
    const res = await exec.execute('iac', 'terraform', 'iac_run_plan', { workspaceId: WS }, true);
    expect(requests[0].url).toBe('/api/v2/runs');
    const body = bodyOf(requests[0]) as { data: { attributes: Record<string, unknown>; relationships: { workspace: { data: { id: string } } } } };
    expect(body.data.attributes['plan-only']).toBe(true);
    expect(body.data.relationships.workspace.data.id).toBe(WS);
    expect(res.data).toMatchObject({ workspaceId: WS, runId: 'run-9' });
    expect(types(events).slice(0, 2)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('refresh state POSTs a refresh-only run', async () => {
    const { exec, requests } = harness('terraform', () => ({ text: '{}' }));
    await exec.execute('iac', 'terraform', 'iac_refresh_state', { workspaceId: WS }, true);
    expect((bodyOf(requests[0]) as { data: { attributes: Record<string, unknown> } }).data.attributes['refresh-only']).toBe(true);
  });

  it('lock / unlock hit the workspace actions path (id encoded into the path)', async () => {
    const { exec, requests } = harness('terraform', () => ({ text: '{}' }));
    await exec.execute('iac', 'terraform', 'iac_lock_workspace', { workspaceId: WS }, true);
    expect(requests[0].url).toBe(`/api/v2/workspaces/${WS}/actions/lock`);
    await exec.execute('iac', 'terraform', 'iac_unlock_workspace', { workspaceId: WS }, true);
    expect(requests[1].url).toBe(`/api/v2/workspaces/${WS}/actions/unlock`);
  });
});

describe('validation + flavor guard + reads', () => {
  it('rejects a bad workspace id BEFORE any request (path-injection safe)', async () => {
    const { exec, requests } = harness('terraform', () => ({ text: '{}' }));
    const res = await exec.execute('iac', 'terraform', 'iac_lock_workspace', { workspaceId: 'ws-../secret' }, true);
    expect(res.message).toContain('Invalid workspace id');
    expect(requests).toHaveLength(0);
  });

  it('returns a non-mutating notice for a Terraform-only action on a Pulumi backend (no request)', async () => {
    const { exec, requests } = harness('pulumi', () => ({ text: '{}' }));
    const res = await exec.execute('iac', 'pulumi', 'iac_run_plan', { workspaceId: WS }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('not available for a Pulumi backend');
    expect(requests).toHaveLength(0);
  });

  it('validate (read-only) runs WITHOUT confirmation and reports the latest run status', async () => {
    const { exec, requests } = harness('terraform', (req) => req.url.includes('/runs') ? { text: JSON.stringify({ data: [{ attributes: { status: 'planned_and_finished' } }] }) } : { text: '{}' });
    const res = await exec.execute('iac', 'terraform', 'iac_validate', { workspaceId: WS }, false); // not confirmed — but mutates:false
    expect(res.ok).toBe(true);
    expect(res.message).toContain('planned_and_finished');
    expect(requests).toHaveLength(1);
  });

  it('generate docs (read-only) summarizes the current state inventory', async () => {
    const tfState = JSON.stringify({ version: 4, resources: [{ mode: 'managed', type: 'aws_s3_bucket', name: 'b', provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [{ attributes: { id: 'b1' } }] }] });
    const { exec } = harness('terraform', (req) => {
      if (req.method === 'ARTIFACT') return { text: tfState };
      if (req.url.includes('current-state-version')) return { text: JSON.stringify({ data: { attributes: { 'hosted-state-download-url': 'https://archivist.terraform.io/s.json' } } }) };
      return { text: '{}' };
    });
    const res = await exec.execute('iac', 'terraform', 'iac_generate_docs', { workspaceId: WS }, false);
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ resources: 1, providers: 1 });
  });

  it('lists the six IaC actions with the mutating ones gated', () => {
    const { exec } = harness('terraform', () => ({ text: '{}' }));
    const cat = exec.list('iac');
    expect(cat.map((a) => a.id).sort()).toEqual(['iac_generate_docs', 'iac_lock_workspace', 'iac_refresh_state', 'iac_run_plan', 'iac_unlock_workspace', 'iac_validate'].sort());
    expect(cat.filter((a) => a.mutates).map((a) => a.id).sort()).toEqual(['iac_lock_workspace', 'iac_refresh_state', 'iac_run_plan', 'iac_unlock_workspace'].sort());
    expect(cat.every((a) => a.platformId === 'iac')).toBe(true);
  });
});
