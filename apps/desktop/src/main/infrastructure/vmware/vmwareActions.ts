/**
 * P6.6 — VMware vSphere automation actions (HIGH PRIVILEGE).
 *
 * Confirmation-gated mutations against vCenter over the SAME session transport discovery uses: power a VM on /
 * off / restart (reset) / suspend, clone a VM, and move (relocate) a VM to another host / resource pool /
 * datastore. Every one is `mutates: true` + `risk: 'high'`, so the shared `InfraActionExecutor` refuses it
 * without an explicit human confirmation and AI can never reach it. Discovery runs read-only; these actions are
 * the only writes, and vCenter's own role-based authorization governs whether the credential may run them.
 *
 * The vCenter IS the account: the transport (`ctx.http`) is already pinned + session-bound to the account's
 * vCenter, so an action only builds RELATIVE paths — the vCenter is never interpolated. Every managed-object id
 * (VM / host / pool / datastore / folder) is validated against a path-safe MOID charset before use
 * (defense-in-depth with the server pin).
 *
 * REST scope: the vSphere Automation REST API covers power + clone + relocate. Snapshot create/delete is NOT in
 * the Automation REST API (VI-JSON / SOAP only) — see the Known Limitations in the report — so no snapshot action
 * is offered here rather than shipping one that always 404s.
 */
import { vmwarePost } from './vmwareClient';
import { HttpError } from '../../unified/sync/http';
import { optStr, reqStr, InfraActionInputError, type InfraAction, type InfraActionContext, type InfraActionResultRaw } from '../actionSdk';

type Rec = Record<string, unknown>;
const enc = encodeURIComponent;

/* ── strict validators (fail closed BEFORE any request) ──────────────────────────────────────────── */

/** A vSphere managed-object id (`vm-42`, `host-12`, `domain-c7`, `resgroup-9`) — path-safe. */
const MOID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
function moid(v: string, what: string): string {
  if (!MOID_RE.test(v) || v.includes('..')) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return v;
}
/** A VM display name (goes in the JSON body, not a path): alphanumerics + space / dot / underscore / hyphen. */
const VM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
function vmName(v: string): string {
  if (!VM_NAME_RE.test(v)) throw new InfraActionInputError(`Invalid VM name "${v}"`);
  return v;
}

/** Parse a bare-string result body (`/api` returns the new VM's MOID as a quoted string). */
function parseIdResult(text: string): string | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as unknown;
    if (typeof j === 'string') return j.trim() || null;
    if (j && typeof j === 'object') {
      const v = (j as { value?: unknown }).value;
      if (typeof v === 'string') return v.trim() || null;
    }
    return null;
  } catch {
    return text.replace(/^"|"$/g, '').trim() || null;
  }
}

/** Shared power transition. A 400 "already in the desired state" is a benign no-op, surfaced as success. */
async function power(ctx: InfraActionContext, vmId: string, action: 'start' | 'stop' | 'reset' | 'suspend', verb: string): Promise<InfraActionResultRaw> {
  const id = moid(vmId, 'vm id');
  try {
    await vmwarePost(ctx.http, `/api/vcenter/vm/${enc(id)}/power?action=${action}`);
    return { ok: true, summary: `${verb} VM ${id}`, data: { vcenter: ctx.accountId, vm: id, action } };
  } catch (err) {
    if (err instanceof HttpError && err.status === 400 && /already_in_desired_state|already in the/i.test(err.message)) {
      return { ok: true, summary: `VM ${id} is already in the desired power state`, data: { vcenter: ctx.accountId, vm: id, action } };
    }
    throw err;
  }
}

export const VMWARE_ACTIONS: InfraAction[] = [
  {
    id: 'vmware_vm_power_on', label: 'Power On VM', platformId: 'vmware', domain: 'compute',
    description: 'Powers on a virtual machine.', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'vmId', label: 'Virtual Machine', required: true, hint: 'vm-42' }],
    run: (ctx, p) => power(ctx, reqStr(p, 'vmId'), 'start', 'Powered on'),
  },
  {
    id: 'vmware_vm_power_off', label: 'Power Off VM', platformId: 'vmware', domain: 'compute',
    description: 'Powers off a virtual machine (hard power off).', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'vmId', label: 'Virtual Machine', required: true, hint: 'vm-42' }],
    run: (ctx, p) => power(ctx, reqStr(p, 'vmId'), 'stop', 'Powered off'),
  },
  {
    id: 'vmware_vm_restart', label: 'Restart VM', platformId: 'vmware', domain: 'compute',
    description: 'Resets (restarts) a virtual machine.', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'vmId', label: 'Virtual Machine', required: true, hint: 'vm-42' }],
    run: (ctx, p) => power(ctx, reqStr(p, 'vmId'), 'reset', 'Restarted'),
  },
  {
    id: 'vmware_vm_suspend', label: 'Suspend VM', platformId: 'vmware', domain: 'compute',
    description: 'Suspends a virtual machine.', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [{ key: 'vmId', label: 'Virtual Machine', required: true, hint: 'vm-42' }],
    run: (ctx, p) => power(ctx, reqStr(p, 'vmId'), 'suspend', 'Suspended'),
  },
  {
    id: 'vmware_vm_clone', label: 'Clone VM', platformId: 'vmware', domain: 'compute',
    description: 'Clones a virtual machine (optionally into a target folder).', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [
      { key: 'vmId', label: 'Source VM', required: true, hint: 'vm-42' },
      { key: 'name', label: 'New VM Name', required: true, hint: 'web01-clone' },
      { key: 'folder', label: 'Target Folder (optional)', required: false, hint: 'group-v3' },
    ],
    run: async (ctx, p) => {
      const source = moid(reqStr(p, 'vmId'), 'vm id');
      const name = vmName(reqStr(p, 'name'));
      const folder = optStr(p, 'folder');
      const spec: Rec = { source, name };
      if (folder) spec.placement = { folder: moid(folder, 'folder id') };
      const { text } = await vmwarePost(ctx.http, `/api/vcenter/vm?action=clone`, spec);
      const newVm = parseIdResult(text);
      return { ok: true, summary: `Cloned VM ${source} to ${name}${newVm ? ` (${newVm})` : ''}`, data: { vcenter: ctx.accountId, source, name, newVm } };
    },
  },
  {
    id: 'vmware_vm_move', label: 'Move VM', platformId: 'vmware', domain: 'compute',
    description: 'Relocates a virtual machine to another host, resource pool, datastore, or folder.', mutates: true, risk: 'high', targetResourceType: 'virtual_machine',
    params: [
      { key: 'vmId', label: 'Virtual Machine', required: true, hint: 'vm-42' },
      { key: 'host', label: 'Target Host (optional)', required: false, hint: 'host-12' },
      { key: 'resourcePool', label: 'Target Resource Pool (optional)', required: false, hint: 'resgroup-9' },
      { key: 'datastore', label: 'Target Datastore (optional)', required: false, hint: 'datastore-15' },
    ],
    run: async (ctx, p) => {
      const vm = moid(reqStr(p, 'vmId'), 'vm id');
      const host = optStr(p, 'host');
      const rp = optStr(p, 'resourcePool');
      const ds = optStr(p, 'datastore');
      const placement: Rec = {};
      if (host) placement.host = moid(host, 'host id');
      if (rp) placement.resource_pool = moid(rp, 'resource pool id');
      if (ds) placement.datastore = moid(ds, 'datastore id');
      if (Object.keys(placement).length === 0) {
        throw new InfraActionInputError('Move requires a target host, resource pool, or datastore');
      }
      await vmwarePost(ctx.http, `/api/vcenter/vm/${enc(vm)}?action=relocate`, { placement });
      return { ok: true, summary: `Moved VM ${vm}`, data: { vcenter: ctx.accountId, vm, host: host ?? null, resourcePool: rp ?? null, datastore: ds ?? null } };
    },
  },
];

/** Bind the VMware actions (used by the executor registration in the runtime composition root). */
export function vmwareActions(): InfraAction[] {
  return VMWARE_ACTIONS;
}
