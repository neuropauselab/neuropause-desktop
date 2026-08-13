/**
 * P6.2 — Azure automation actions through the SHARED confirmation-gated executor (the same `InfraActionExecutor`
 * P6.1 built for AWS). Proves: the confirmation gate refuses a mutation without `confirmed` (and never touches
 * the provider), each action builds the correct ARM/data-plane request (host / path / verb), the crafted-id and
 * crafted-vault SSRF guards fail closed BEFORE any request, the started→completed|failed audit fan-out, and 403
 * classification. Pure-node; the bearer transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { AZURE_ACTIONS } from './azureActions';

const NOW = '2026-07-13T00:00:00.000Z';
const SUB = '/subscriptions/s/resourceGroups/rg/providers';

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
    AZURE_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER calls the provider', async () => {
    const { exec, events, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('azure', 'sub-1', 'azure_vm_restart', { resourceId: `${SUB}/Microsoft.Compute/virtualMachines/vm1` }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('VM lifecycle actions (ARM)', () => {
  const vmId = `${SUB}/Microsoft.Compute/virtualMachines/vm1`;
  it('Start posts the start verb on management.azure.com and audits started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('azure', 'sub-1', 'azure_vm_start', { resourceId: vmId }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Start requested for VM vm1');
    const u = new URL(requests[0].url);
    expect(u.hostname).toBe('management.azure.com');
    expect(u.pathname).toBe(`${vmId}/start`);
    expect(requests[0].method).toBe('POST');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });
  it('Stop uses deallocate; Restart uses restart', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    await exec.execute('azure', 'sub-1', 'azure_vm_deallocate', { resourceId: vmId }, true);
    await exec.execute('azure', 'sub-1', 'azure_vm_restart', { resourceId: vmId }, true);
    expect(new URL(requests[0].url).pathname).toBe(`${vmId}/deallocate`);
    expect(new URL(requests[1].url).pathname).toBe(`${vmId}/restart`);
  });
});

describe('AKS node + SQL failover + Key Vault rotate', () => {
  it('Restart AKS node targets the scale-set instance restart', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const vmssId = `${SUB}/Microsoft.Compute/virtualMachineScaleSets/aksvmss`;
    const res = await exec.execute('azure', 'sub-1', 'azure_aks_node_restart', { resourceId: vmssId, instanceId: '3' }, true);
    expect(res.ok).toBe(true);
    expect(new URL(requests[0].url).pathname).toBe(`${vmssId}/virtualmachines/3/restart`);
  });
  it('rejects a non-numeric scale-set instance id', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const res = await exec.execute('azure', 'sub-1', 'azure_aks_node_restart', { resourceId: `${SUB}/Microsoft.Compute/virtualMachineScaleSets/aksvmss`, instanceId: '3/../evil' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid scale-set instance id');
    expect(requests).toHaveLength(0);
  });
  it('SQL failover posts the failover verb', async () => {
    const { exec, requests } = harness(() => ({ text: '' }));
    const dbId = `${SUB}/Microsoft.Sql/servers/srv/databases/db1`;
    await exec.execute('azure', 'sub-1', 'azure_sql_failover', { resourceId: dbId }, true);
    expect(new URL(requests[0].url).pathname).toBe(`${dbId}/failover`);
  });
  it('Rotate Key Vault secret hits the vault data plane and maps the new version', async () => {
    const { exec, requests } = harness(() => ({ text: JSON.stringify({ id: 'https://my-vault.vault.azure.net/secrets/db-pass/abc123' }) }));
    const res = await exec.execute('azure', 'sub-1', 'azure_keyvault_rotate_secret', { vaultName: 'my-vault', secretName: 'db-pass' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Rotation triggered for secret db-pass');
    expect(res.data).toMatchObject({ vaultName: 'my-vault', secretName: 'db-pass', version: 'abc123' });
    const u = new URL(requests[0].url);
    expect(u.hostname).toBe('my-vault.vault.azure.net'); // data-plane host (its own token audience)
    expect(u.pathname).toBe('/secrets/db-pass/rotate');
  });
});

describe('SSRF guards + audit + classification', () => {
  it('rejects a crafted resource ID before any request (userinfo-injection defense)', async () => {
    const { exec, requests, events } = harness(() => ({ text: '' }));
    const res = await exec.execute('azure', 'sub-1', 'azure_vm_start', { resourceId: '/subscriptions/s@evil.com/x' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid Azure resource ID');
    expect(requests).toHaveLength(0); // provider never called
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });
  it('rejects a crafted Key Vault name (host-breakout defense)', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('azure', 'sub-1', 'azure_keyvault_rotate_secret', { vaultName: 'evil.com/x', secretName: 's' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid Key Vault name');
    expect(requests).toHaveLength(0);
  });
  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('AuthorizationFailed', 403) }));
    const res = await exec.execute('azure', 'sub-1', 'azure_vm_deallocate', { resourceId: `${SUB}/Microsoft.Compute/virtualMachines/vm1` }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });
  it('lists exactly the six high-privilege Azure actions', () => {
    const { exec } = harness(() => ({ text: '' }));
    const cat = exec.list('azure');
    expect(cat.map((a) => a.id).sort()).toEqual(['azure_aks_node_restart', 'azure_keyvault_rotate_secret', 'azure_sql_failover', 'azure_vm_deallocate', 'azure_vm_restart', 'azure_vm_start'].sort());
    expect(cat.every((a) => a.mutates && a.risk === 'high' && a.platformId === 'azure')).toBe(true);
  });
});
