/**
 * P6.2 — Azure automation actions (HIGH PRIVILEGE).
 *
 * Six confirmation-gated mutations against the Azure Cloud Platform, each a single bearer request over the SAME
 * transport discovery uses: Start / Stop (deallocate) / Restart a VM, Restart an AKS node (a scale-set instance
 * restart — AKS nodes ARE VMSS instances), Failover an Azure SQL database (the restart-equivalent), and Rotate a
 * Key Vault secret (data-plane). Every one is `mutates: true` + `risk: 'high'`, so the shared `InfraActionExecutor`
 * refuses it without an explicit human confirmation and AI can never reach it. Discovery runs read-only; these
 * actions are the only writes, and Azure RBAC enforces whether the service principal is actually permitted to run
 * them (least privilege, provider-side). These `InfraAction`s are simply appended to the executor's action list —
 * the executor, IPC channel, and confirmation gate are all reused unchanged from P6.1.
 */
import { azurePost } from './azureClient';
import { reqStr, InfraActionInputError, type InfraAction, type InfraActionContext } from '../actionSdk';

const ARM = 'https://management.azure.com';
const COMPUTE_V = '2023-07-01';

/**
 * Validate an Azure ARM resource id BEFORE it is interpolated into `https://management.azure.com{resourceId}` —
 * an absolute `/subscriptions/…` path of safe characters can never inject a host or userinfo (`@`) and redirect a
 * bearer-token request off-Azure. Defense-in-depth with the transport-layer `isAzureHost` guard.
 */
function armResourceId(resourceId: string): string {
  if (!/^\/subscriptions\/[A-Za-z0-9._()-]+(\/[A-Za-z0-9._()-]+)+$/.test(resourceId)) {
    throw new InfraActionInputError(`Invalid Azure resource ID "${resourceId}"`);
  }
  return resourceId;
}
/** A Key Vault name is 3–24 chars of letters/digits/hyphens — reject anything that could break out of the host. */
function vaultName(name: string): string {
  if (!/^[A-Za-z0-9-]{3,24}$/.test(name)) throw new InfraActionInputError(`Invalid Key Vault name "${name}"`);
  return name;
}
/** A secret name is 1–127 chars of letters/digits/hyphens (Key Vault object-name rules). */
function secretName(name: string): string {
  if (!/^[A-Za-z0-9-]{1,127}$/.test(name)) throw new InfraActionInputError(`Invalid secret name "${name}"`);
  return name;
}
/** A scale-set instance id is numeric. */
function instanceId(id: string): string {
  if (!/^[0-9]+$/.test(id)) throw new InfraActionInputError(`Invalid scale-set instance id "${id}"`);
  return id;
}
const lastSegment = (id: string): string => id.split('/').filter(Boolean).pop() ?? id;

/** POST an ARM action verb on a resource id and report an accepted summary (VM ops are async 202s). */
async function armAction(ctx: InfraActionContext, resourceId: string, verb: string, apiVersion: string): Promise<Record<string, unknown>> {
  return azurePost(ctx.http, `${ARM}${armResourceId(resourceId)}/${verb}?api-version=${apiVersion}`);
}

export const AZURE_ACTIONS: InfraAction[] = [
  {
    id: 'azure_vm_start', label: 'Start Virtual Machine', platformId: 'azure', domain: 'compute',
    description: 'Starts a stopped/deallocated Azure VM.', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'resourceId', label: 'VM Resource ID', required: true, hint: '/subscriptions/…/virtualMachines/vm1' }],
    run: async (ctx, p) => {
      const resourceId = reqStr(p, 'resourceId');
      await armAction(ctx, resourceId, 'start', COMPUTE_V);
      return { ok: true, summary: `Start requested for VM ${lastSegment(resourceId)}`, data: { resourceId, operation: 'start' } };
    },
  },
  {
    id: 'azure_vm_deallocate', label: 'Stop (Deallocate) Virtual Machine', platformId: 'azure', domain: 'compute',
    description: 'Stops and deallocates an Azure VM (releases compute billing).', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'resourceId', label: 'VM Resource ID', required: true, hint: '/subscriptions/…/virtualMachines/vm1' }],
    run: async (ctx, p) => {
      const resourceId = reqStr(p, 'resourceId');
      await armAction(ctx, resourceId, 'deallocate', COMPUTE_V);
      return { ok: true, summary: `Deallocate requested for VM ${lastSegment(resourceId)}`, data: { resourceId, operation: 'deallocate' } };
    },
  },
  {
    id: 'azure_vm_restart', label: 'Restart Virtual Machine', platformId: 'azure', domain: 'compute',
    description: 'Restarts an Azure VM.', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'resourceId', label: 'VM Resource ID', required: true, hint: '/subscriptions/…/virtualMachines/vm1' }],
    run: async (ctx, p) => {
      const resourceId = reqStr(p, 'resourceId');
      await armAction(ctx, resourceId, 'restart', COMPUTE_V);
      return { ok: true, summary: `Restart requested for VM ${lastSegment(resourceId)}`, data: { resourceId, operation: 'restart' } };
    },
  },
  {
    id: 'azure_aks_node_restart', label: 'Restart AKS Node (Scale Set Instance)', platformId: 'azure', domain: 'compute',
    description: 'Restarts a single scale-set instance — an AKS node is a VMSS instance.', mutates: true, risk: 'high', targetResourceType: 'vm_scale_set',
    params: [
      { key: 'resourceId', label: 'Scale Set Resource ID', required: true, hint: '/subscriptions/…/virtualMachineScaleSets/aks-vmss' },
      { key: 'instanceId', label: 'Instance ID', required: true, hint: 'numeric, e.g. 3' },
    ],
    run: async (ctx, p) => {
      const resourceId = reqStr(p, 'resourceId');
      const inst = instanceId(reqStr(p, 'instanceId'));
      await azurePost(ctx.http, `${ARM}${armResourceId(resourceId)}/virtualmachines/${inst}/restart?api-version=${COMPUTE_V}`);
      return { ok: true, summary: `Restart requested for ${lastSegment(resourceId)} instance ${inst}`, data: { resourceId, instanceId: inst } };
    },
  },
  {
    id: 'azure_sql_failover', label: 'Failover Azure SQL Database (Restart)', platformId: 'azure', domain: 'databases',
    description: 'Forces a failover of an Azure SQL database — the restart-equivalent for a PaaS database.', mutates: true, risk: 'high', targetResourceType: 'sql_database',
    params: [{ key: 'resourceId', label: 'SQL Database Resource ID', required: true, hint: '/subscriptions/…/databases/db1' }],
    run: async (ctx, p) => {
      const resourceId = reqStr(p, 'resourceId');
      await armAction(ctx, resourceId, 'failover', '2021-11-01');
      return { ok: true, summary: `Failover requested for SQL database ${lastSegment(resourceId)}`, data: { resourceId, operation: 'failover' } };
    },
  },
  {
    id: 'azure_keyvault_rotate_secret', label: 'Rotate Key Vault Secret', platformId: 'azure', domain: 'secrets',
    description: 'Triggers rotation of a Key Vault secret (requires a rotation policy on the secret).', mutates: true, risk: 'high', targetResourceType: 'key_vault',
    params: [
      { key: 'vaultName', label: 'Key Vault Name', required: true, hint: 'my-vault' },
      { key: 'secretName', label: 'Secret Name', required: true, hint: 'db-password' },
    ],
    run: async (ctx, p) => {
      const vault = vaultName(reqStr(p, 'vaultName'));
      const secret = secretName(reqStr(p, 'secretName'));
      // Key Vault data plane (its own audience — the transport derives it from the *.vault.azure.net host).
      const res = await azurePost(ctx.http, `https://${vault}.vault.azure.net/secrets/${secret}/rotate?api-version=7.4`);
      const version = lastSegment(String(res.id ?? '')) || null;
      return { ok: true, summary: `Rotation triggered for secret ${secret} in ${vault}`, data: { vaultName: vault, secretName: secret, version } };
    },
  },
];

/** Bind the Azure actions (used by the executor registration in the runtime composition root). */
export function azureActions(): InfraAction[] {
  return AZURE_ACTIONS;
}
