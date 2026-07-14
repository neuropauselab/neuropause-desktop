/**
 * IaC automation actions (P6.10 — HIGH PRIVILEGE, never an apply).
 *
 * Confirmation-gated operations against the SAME host-pinned transport discovery uses: queue a speculative
 * plan-only run, queue a refresh-only run, and lock / unlock a workspace — plus two READ-ONLY actions (validate =
 * report the latest run's plan status; generate documentation = summarize the current state inventory). The
 * mutating actions are `mutates: true`, so the shared `InfraActionExecutor` refuses them without explicit human
 * confirmation and AI can never reach them; NONE of them applies or destroys real infrastructure — the strongest
 * effect is queueing a plan/refresh run or toggling a workspace lock, all reversible and infra-neutral. `terraform
 * apply` / `pulumi up` / `destroy` are deliberately NOT offered (see the report).
 *
 * The transport is host-pinned per backend and the workspace id (interpolated into the lock/unlock PATH) is strict
 * -charset validated (`ws-…`) + `encodeURIComponent`-escaped. Terraform-Cloud-only actions return a clear, non
 * -mutating message on a Pulumi backend rather than issuing an unsupported request.
 */
import { asIac, fetchArtifactJson, iacGet, iacPost } from './iacClient';
import { parsePulumiState, parseTerraformState } from './iacState';
import { reqStr, optStr, InfraActionInputError, type InfraAction, type InfraActionContext } from '../actionSdk';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const jattrs = (r: Rec): Rec => (isRec(r.attributes) ? r.attributes : {});
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/* ── strict validators (fail closed BEFORE any request) ──────────────────────────────────────────── */

/** A Terraform Cloud workspace id (`ws-` + base62) — the only value interpolated into a request path. */
const WS_ID_RE = /^ws-[A-Za-z0-9]{6,40}$/;
function workspaceId(v: string): string {
  if (!WS_ID_RE.test(v)) throw new InfraActionInputError(`Invalid workspace id "${v}" (expected a ws-… id)`);
  return v;
}
/** A short, bounded, non-sensitive run/lock message (JSON-body only). */
function message(v: string | undefined, fallback: string): string {
  return (v ?? fallback).slice(0, 200);
}
/** Guard a Terraform-Cloud-only action: return a non-mutating notice on a Pulumi backend. */
function tfcOnly(ctx: InfraActionContext): { ok: false; summary: string } | null {
  return asIac(ctx.http).flavor === 'pulumi' ? { ok: false, summary: 'This action targets Terraform Cloud / OpenTofu backends; it is not available for a Pulumi backend over REST.' } : null;
}

export const IAC_ACTIONS: InfraAction[] = [
  {
    id: 'iac_run_plan', label: 'Run Plan', platformId: 'iac', domain: 'provisioning',
    description: 'Queues a speculative PLAN-ONLY run for a workspace (never applies).', mutates: true, risk: 'medium', targetResourceType: 'iac_workspace',
    params: [
      { key: 'workspaceId', label: 'Workspace', required: true, hint: 'ws-XXXXXXXXXXXXXXXX' },
      { key: 'message', label: 'Message (optional)', required: false, hint: 'Plan from Neuropause' },
    ],
    run: async (ctx, p) => {
      const notice = tfcOnly(ctx); if (notice) return notice;
      const ws = workspaceId(reqStr(p, 'workspaceId'));
      const body = { data: { type: 'runs', attributes: { 'plan-only': true, message: message(optStr(p, 'message'), 'Plan from Neuropause') }, relationships: { workspace: { data: { type: 'workspaces', id: ws } } } } };
      const res = await iacPost(ctx.http, '/api/v2/runs', body);
      const runId = asStr(isRec(res.data) ? (res.data as Rec).id : null);
      return { ok: true, summary: `Queued plan-only run for ${ws}${runId ? ` (${runId})` : ''}`, data: { workspaceId: ws, runId } };
    },
  },
  {
    id: 'iac_refresh_state', label: 'Refresh State', platformId: 'iac', domain: 'provisioning',
    description: 'Queues a REFRESH-ONLY run to reconcile state with real resources (no infrastructure change).', mutates: true, risk: 'medium', targetResourceType: 'iac_workspace',
    params: [
      { key: 'workspaceId', label: 'Workspace', required: true, hint: 'ws-XXXXXXXXXXXXXXXX' },
      { key: 'message', label: 'Message (optional)', required: false, hint: 'Refresh from Neuropause' },
    ],
    run: async (ctx, p) => {
      const notice = tfcOnly(ctx); if (notice) return notice;
      const ws = workspaceId(reqStr(p, 'workspaceId'));
      const body = { data: { type: 'runs', attributes: { 'refresh-only': true, message: message(optStr(p, 'message'), 'Refresh from Neuropause') }, relationships: { workspace: { data: { type: 'workspaces', id: ws } } } } };
      const res = await iacPost(ctx.http, '/api/v2/runs', body);
      const runId = asStr(isRec(res.data) ? (res.data as Rec).id : null);
      return { ok: true, summary: `Queued refresh-only run for ${ws}${runId ? ` (${runId})` : ''}`, data: { workspaceId: ws, runId } };
    },
  },
  {
    id: 'iac_lock_workspace', label: 'Lock Workspace', platformId: 'iac', domain: 'provisioning',
    description: 'Locks a workspace so no run can start (reversible; no infrastructure change).', mutates: true, risk: 'medium', targetResourceType: 'iac_workspace',
    params: [
      { key: 'workspaceId', label: 'Workspace', required: true, hint: 'ws-XXXXXXXXXXXXXXXX' },
      { key: 'reason', label: 'Reason (optional)', required: false, hint: 'Locked from Neuropause' },
    ],
    run: async (ctx, p) => {
      const notice = tfcOnly(ctx); if (notice) return notice;
      const ws = workspaceId(reqStr(p, 'workspaceId'));
      await iacPost(ctx.http, `/api/v2/workspaces/${encodeURIComponent(ws)}/actions/lock`, { reason: message(optStr(p, 'reason'), 'Locked from Neuropause') });
      return { ok: true, summary: `Locked workspace ${ws}`, data: { workspaceId: ws } };
    },
  },
  {
    id: 'iac_unlock_workspace', label: 'Unlock Workspace', platformId: 'iac', domain: 'provisioning',
    description: 'Unlocks a previously locked workspace (reversible; no infrastructure change).', mutates: true, risk: 'medium', targetResourceType: 'iac_workspace',
    params: [{ key: 'workspaceId', label: 'Workspace', required: true, hint: 'ws-XXXXXXXXXXXXXXXX' }],
    run: async (ctx, p) => {
      const notice = tfcOnly(ctx); if (notice) return notice;
      const ws = workspaceId(reqStr(p, 'workspaceId'));
      await iacPost(ctx.http, `/api/v2/workspaces/${encodeURIComponent(ws)}/actions/unlock`);
      return { ok: true, summary: `Unlocked workspace ${ws}`, data: { workspaceId: ws } };
    },
  },
  {
    id: 'iac_validate', label: 'Validate Configuration', platformId: 'iac', domain: 'provisioning',
    description: "Reports the latest run's plan status for a workspace (read-only).", mutates: false, risk: 'low', targetResourceType: 'iac_workspace',
    params: [{ key: 'workspaceId', label: 'Workspace', required: true, hint: 'ws-XXXXXXXXXXXXXXXX' }],
    run: async (ctx, p) => {
      const notice = tfcOnly(ctx); if (notice) return notice;
      const ws = workspaceId(reqStr(p, 'workspaceId'));
      const runsBody = await iacGet(ctx.http, `/api/v2/workspaces/${encodeURIComponent(ws)}/runs?page[size]=1`);
      const runs = Array.isArray(runsBody.data) ? (runsBody.data as Rec[]) : [];
      if (!runs.length) return { ok: true, summary: `No runs found for ${ws}`, data: { workspaceId: ws, status: null } };
      const status = asStr(jattrs(runs[0]).status);
      const clean = status !== 'errored';
      return { ok: clean, summary: `Latest run for ${ws} is ${status ?? 'unknown'}`, data: { workspaceId: ws, status } };
    },
  },
  {
    id: 'iac_generate_docs', label: 'Generate Documentation', platformId: 'iac', domain: 'provisioning',
    description: 'Summarizes a workspace/stack current-state inventory (resources, providers, outputs) — read-only.', mutates: false, risk: 'low', targetResourceType: 'iac_state',
    params: [
      { key: 'workspaceId', label: 'Workspace (Terraform)', required: false, hint: 'ws-XXXXXXXXXXXXXXXX' },
      { key: 'project', label: 'Project (Pulumi)', required: false, hint: 'my-project' },
      { key: 'stack', label: 'Stack (Pulumi)', required: false, hint: 'prod' },
    ],
    run: async (ctx, p) => {
      const http = asIac(ctx.http);
      if (http.flavor === 'pulumi') {
        const project = reqStr(p, 'project');
        const stack = reqStr(p, 'stack');
        const exported = await iacGet(ctx.http, `/api/stacks/${encodeURIComponent(http.organization)}/${encodeURIComponent(project)}/${encodeURIComponent(stack)}/export`);
        const model = parsePulumiState(exported);
        return { ok: true, summary: `${project}/${stack}: ${model.resources.length} resources, ${model.providers.length} providers, ${model.outputs.length} outputs`, data: { scope: `${project}/${stack}`, resources: model.resources.length, providers: model.providers.length, outputs: model.outputs.length } };
      }
      const ws = workspaceId(reqStr(p, 'workspaceId'));
      const sv = await iacGet(ctx.http, `/api/v2/workspaces/${encodeURIComponent(ws)}/current-state-version`);
      const url = asStr(jattrs(isRec(sv.data) ? (sv.data as Rec) : sv)['hosted-state-download-url']);
      if (!url) return { ok: true, summary: `No current state for ${ws}`, data: { scope: ws, resources: 0, providers: 0, outputs: 0 } };
      const model = parseTerraformState(await fetchArtifactJson(http, url), http.flavor);
      return { ok: true, summary: `${ws}: ${model.resources.length} resources, ${model.providers.length} providers, ${model.outputs.length} outputs`, data: { scope: ws, resources: model.resources.length, providers: model.providers.length, outputs: model.outputs.length } };
    },
  },
];

/** Bind the IaC actions (used by the executor registration in the runtime composition root). */
export function iacActions(): InfraAction[] {
  return IAC_ACTIONS;
}
