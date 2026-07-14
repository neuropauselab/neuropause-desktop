/**
 * P6.3 — Google Cloud automation actions (HIGH PRIVILEGE).
 *
 * Six confirmation-gated mutations against the GCP Cloud Platform, each a single bearer POST over the SAME
 * transport discovery uses: Start / Stop / Reset (Restart) a Compute Engine VM, Restart a Cloud SQL instance,
 * Restart a GKE node (a GKE node IS a Compute Engine instance — this resets that instance), and Disable a Secret
 * Manager secret version (GCP has no atomic "rotate"; disabling the superseded version is the safe, reversible
 * rotation-completion step). Every one is `mutates: true` + `risk: 'high'`, so the shared `InfraActionExecutor`
 * refuses it without an explicit human confirmation and AI can never reach it. Discovery runs read-only; these
 * actions are the only writes, and GCP IAM enforces whether the service account may run them (least privilege).
 *
 * The GCP project is the account: `ctx.accountId` IS the project id. Every path segment is validated against a
 * strict charset before interpolation (defense-in-depth with the transport-layer `isGcpHost` guard).
 */
import { gcpPost } from './gcpClient';
import { reqStr, InfraActionInputError, type InfraAction, type InfraActionContext } from '../actionSdk';

const COMPUTE = 'https://compute.googleapis.com/compute/v1';
const SQL = 'https://sqladmin.googleapis.com/v1';
const SECRETMANAGER = 'https://secretmanager.googleapis.com/v1';

/* ── strict path-segment validators (no `.`, `/`, `@`, `:` → nothing can alter the fixed host/path) ── */
function project(p: string): string {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p)) throw new InfraActionInputError(`Invalid GCP project id "${p}" (set the action's account to the project id)`);
  return p;
}
function zone(z: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(z)) throw new InfraActionInputError(`Invalid zone "${z}"`);
  return z;
}
function resourceName(n: string): string {
  if (!/^[a-z0-9-]{1,63}$/.test(n)) throw new InfraActionInputError(`Invalid resource name "${n}"`);
  return n;
}
function secretId(n: string): string {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(n)) throw new InfraActionInputError(`Invalid secret name "${n}"`);
  return n;
}
function version(v: string): string {
  if (!/^([0-9]+|latest)$/.test(v)) throw new InfraActionInputError(`Invalid secret version "${v}"`);
  return v;
}

/** POST a Compute instance verb (start/stop/reset) and report an accepted summary (these are async Operations). */
async function computeInstanceVerb(ctx: InfraActionContext, z: string, name: string, verb: string): Promise<Record<string, unknown>> {
  return gcpPost(ctx.http, `${COMPUTE}/projects/${project(ctx.accountId)}/zones/${zone(z)}/instances/${resourceName(name)}/${verb}`);
}

export const GCP_ACTIONS: InfraAction[] = [
  {
    id: 'gcp_vm_start', label: 'Start Compute Engine VM', platformId: 'gcp', domain: 'compute',
    description: 'Starts a stopped Compute Engine instance.', mutates: true, risk: 'high', targetResourceType: 'compute_instance',
    params: [
      { key: 'zone', label: 'Zone', required: true, hint: 'us-central1-a' },
      { key: 'instanceName', label: 'Instance Name', required: true, hint: 'my-vm' },
    ],
    run: async (ctx, p) => {
      const z = reqStr(p, 'zone');
      const name = reqStr(p, 'instanceName');
      const op = await computeInstanceVerb(ctx, z, name, 'start');
      return { ok: true, summary: `Start requested for VM ${name} (${z})`, data: { project: ctx.accountId, zone: z, instance: name, operation: opName(op) } };
    },
  },
  {
    id: 'gcp_vm_stop', label: 'Stop Compute Engine VM', platformId: 'gcp', domain: 'compute',
    description: 'Stops a running Compute Engine instance.', mutates: true, risk: 'high', targetResourceType: 'compute_instance',
    params: [
      { key: 'zone', label: 'Zone', required: true, hint: 'us-central1-a' },
      { key: 'instanceName', label: 'Instance Name', required: true, hint: 'my-vm' },
    ],
    run: async (ctx, p) => {
      const z = reqStr(p, 'zone');
      const name = reqStr(p, 'instanceName');
      const op = await computeInstanceVerb(ctx, z, name, 'stop');
      return { ok: true, summary: `Stop requested for VM ${name} (${z})`, data: { project: ctx.accountId, zone: z, instance: name, operation: opName(op) } };
    },
  },
  {
    id: 'gcp_vm_reset', label: 'Restart (Reset) Compute Engine VM', platformId: 'gcp', domain: 'compute',
    description: 'Performs a hard reset (restart) of a Compute Engine instance.', mutates: true, risk: 'high', targetResourceType: 'compute_instance',
    params: [
      { key: 'zone', label: 'Zone', required: true, hint: 'us-central1-a' },
      { key: 'instanceName', label: 'Instance Name', required: true, hint: 'my-vm' },
    ],
    run: async (ctx, p) => {
      const z = reqStr(p, 'zone');
      const name = reqStr(p, 'instanceName');
      const op = await computeInstanceVerb(ctx, z, name, 'reset');
      return { ok: true, summary: `Reset requested for VM ${name} (${z})`, data: { project: ctx.accountId, zone: z, instance: name, operation: opName(op) } };
    },
  },
  {
    id: 'gcp_sql_restart', label: 'Restart Cloud SQL Instance', platformId: 'gcp', domain: 'databases',
    description: 'Restarts a Cloud SQL instance.', mutates: true, risk: 'high', targetResourceType: 'cloudsql_instance',
    params: [{ key: 'instanceName', label: 'Instance Name', required: true, hint: 'my-database' }],
    run: async (ctx, p) => {
      const name = resourceName(reqStr(p, 'instanceName'));
      const op = await gcpPost(ctx.http, `${SQL}/projects/${project(ctx.accountId)}/instances/${name}/restart`);
      return { ok: true, summary: `Restart requested for Cloud SQL ${name}`, data: { project: ctx.accountId, instance: name, operation: opName(op) } };
    },
  },
  {
    id: 'gcp_gke_node_reset', label: 'Restart GKE Node', platformId: 'gcp', domain: 'compute',
    description: 'Restarts a GKE node by resetting its underlying Compute Engine instance.', mutates: true, risk: 'high', targetResourceType: 'compute_instance',
    params: [
      { key: 'zone', label: 'Node Zone', required: true, hint: 'us-central1-a' },
      { key: 'instanceName', label: 'Node Instance Name', required: true, hint: 'gke-cluster-pool-abc123' },
    ],
    run: async (ctx, p) => {
      const z = reqStr(p, 'zone');
      const name = reqStr(p, 'instanceName');
      const op = await computeInstanceVerb(ctx, z, name, 'reset');
      return { ok: true, summary: `Restart requested for GKE node ${name} (${z})`, data: { project: ctx.accountId, zone: z, node: name, operation: opName(op) } };
    },
  },
  {
    id: 'gcp_secret_disable_version', label: 'Rotate Secret (Disable Version)', platformId: 'gcp', domain: 'secrets',
    description: 'Disables a Secret Manager secret version — the safe, reversible step that completes a rotation.', mutates: true, risk: 'high', targetResourceType: 'secret',
    params: [
      { key: 'secretName', label: 'Secret Name', required: true, hint: 'db-password' },
      { key: 'version', label: 'Version', required: true, hint: 'a number, or "latest"' },
    ],
    run: async (ctx, p) => {
      const secret = secretId(reqStr(p, 'secretName'));
      const ver = version(reqStr(p, 'version'));
      await gcpPost(ctx.http, `${SECRETMANAGER}/projects/${project(ctx.accountId)}/secrets/${secret}/versions/${ver}:disable`);
      return { ok: true, summary: `Disabled version ${ver} of secret ${secret}`, data: { project: ctx.accountId, secret, version: ver } };
    },
  },
];

/** The Operation resource name from a GCP mutation response (non-sensitive), or null. */
function opName(op: Record<string, unknown>): string | null {
  const n = op.name;
  return typeof n === 'string' ? n : null;
}

/** Bind the GCP actions (used by the executor registration in the runtime composition root). */
export function gcpActions(): InfraAction[] {
  return GCP_ACTIONS;
}
