/**
 * P6.6 — VMware automation actions through the SHARED confirmation-gated executor (the same `InfraActionExecutor`
 * P6.1 built for AWS, extended by Azure/GCP/Kubernetes/Docker). Proves: the gate refuses a mutation without
 * `confirmed` (and never touches vCenter), each action builds the correct relative path / verb / body (power
 * `?action=`, clone body, relocate body), a benign "already in the desired state" is surfaced as success, the
 * path-safe MOID + name validators fail closed BEFORE any request, the started→completed|failed audit fan-out,
 * and 403 classification. Pure-node; the session transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError, HttpError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { VMWARE_ACTIONS } from './vmwareActions';

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
      return { status: r.status ?? 200, headers: {}, text: r.text ?? '' };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, now: () => NOW },
    VMWARE_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER calls vCenter', async () => {
    const { exec, events, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('vmware', 'vc1', 'vmware_vm_power_off', { vmId: 'vm-42' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('power actions', () => {
  it('Power On / Off / Restart / Suspend POST the right ?action= path and audit started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ status: 204, text: '' }));
    await exec.execute('vmware', 'vc1', 'vmware_vm_power_on', { vmId: 'vm-42' }, true);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/api/vcenter/vm/vm-42/power?action=start' });
    await exec.execute('vmware', 'vc1', 'vmware_vm_power_off', { vmId: 'vm-42' }, true);
    expect(requests[1].url).toBe('/api/vcenter/vm/vm-42/power?action=stop');
    await exec.execute('vmware', 'vc1', 'vmware_vm_restart', { vmId: 'vm-42' }, true);
    expect(requests[2].url).toBe('/api/vcenter/vm/vm-42/power?action=reset');
    await exec.execute('vmware', 'vc1', 'vmware_vm_suspend', { vmId: 'vm-42' }, true);
    expect(requests[3].url).toBe('/api/vcenter/vm/vm-42/power?action=suspend');
    expect(types(events).slice(0, 2)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('a benign "already in the desired state" 400 (the real error_type-prefixed message) is surfaced as success', async () => {
    // This is the message errorFor/vmwareErrorMessage actually produces for vCenter's ALREADY_IN_DESIRED_STATE.
    const { exec } = harness(() => ({ error: new HttpError(400, 'ALREADY_IN_DESIRED_STATE: Virtual machine is already powered on.', false) }));
    const res = await exec.execute('vmware', 'vc1', 'vmware_vm_power_on', { vmId: 'vm-42' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('already in the desired');
  });

  it('a DIFFERENT 400 (not already-in-state) still fails — the catch does not mask real errors', async () => {
    const { exec } = harness(() => ({ error: new HttpError(400, 'INVALID_ARGUMENT: bad power request', false) }));
    const res = await exec.execute('vmware', 'vc1', 'vmware_vm_power_on', { vmId: 'vm-42' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('bad power request');
  });
});

describe('clone + move', () => {
  it('Clone POSTs the clone spec (source + name + placement) and returns the new VM id', async () => {
    const { exec, requests } = harness(() => ({ text: '"vm-99"' }));
    const res = await exec.execute('vmware', 'vc1', 'vmware_vm_clone', { vmId: 'vm-42', name: 'web01-clone', folder: 'group-v3' }, true);
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ newVm: 'vm-99' });
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/api/vcenter/vm?action=clone' });
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ source: 'vm-42', name: 'web01-clone', placement: { folder: 'group-v3' } });
  });

  it('Move POSTs a relocate placement to the target host', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    await exec.execute('vmware', 'vc1', 'vmware_vm_move', { vmId: 'vm-42', host: 'host-12' }, true);
    expect(requests[0].url).toBe('/api/vcenter/vm/vm-42?action=relocate');
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ placement: { host: 'host-12' } });
  });

  it('Move refuses when no target is given (no request issued)', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('vmware', 'vc1', 'vmware_vm_move', { vmId: 'vm-42' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('requires a target');
    expect(requests).toHaveLength(0);
  });
});

describe('validators + classification', () => {
  it('rejects a path-unsafe MOID and a bad VM name BEFORE any request', async () => {
    const { exec, requests, events } = harness(() => ({ text: '' }));
    const badId = await exec.execute('vmware', 'vc1', 'vmware_vm_power_on', { vmId: 'vm-42/../host-1' }, true);
    expect(badId.message).toContain('Invalid vm id');
    const badName = await exec.execute('vmware', 'vc1', 'vmware_vm_clone', { vmId: 'vm-42', name: 'bad/name' }, true);
    expect(badName.message).toContain('Invalid VM name');
    expect(requests).toHaveLength(0);
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed', 'infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('Forbidden', 403) }));
    const res = await exec.execute('vmware', 'vc1', 'vmware_vm_power_off', { vmId: 'vm-42' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('lists exactly the six high-privilege VMware actions', () => {
    const { exec } = harness(() => ({ text: '' }));
    const cat = exec.list('vmware');
    expect(cat.map((a) => a.id).sort()).toEqual([
      'vmware_vm_clone', 'vmware_vm_move', 'vmware_vm_power_off', 'vmware_vm_power_on', 'vmware_vm_restart', 'vmware_vm_suspend',
    ].sort());
    expect(cat.every((a) => a.mutates && a.risk === 'high' && a.platformId === 'vmware')).toBe(true);
  });
});
