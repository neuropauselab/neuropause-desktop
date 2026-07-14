/**
 * The IaC DomainCollectors (P6.10). Each discovers ONE IaC object type via the P6.0 `DomainCollector` contract and
 * maps it into a `CloudResource` with typed relationships, under the single `provisioning` domain. ONE set of
 * collectors serves all three flavors: each `collect()` narrows `ctx.http` to the `IacTransport`, reads its flavor
 * (the account = the backend), and self-gates — a Terraform-Cloud collector no-ops on a Pulumi account and vice
 * versa — so Terraform + OpenTofu + Pulumi stay ONE platform, never three.
 *
 * The headline flow is `iac_state`: it downloads each workspace/stack state (credential-free artifact fetch),
 * parses it with the pure `iacState` parser into the managed-resource inventory + provider/output/backend nodes +
 * the dependency graph, then — when a plan/preview is reachable — runs the pure `analyzePlan` + `computeDrift`
 * engines and stamps the drift signal onto the state node. Relationships map IaC verbs onto the EXISTING nine graph
 * types (defines/creates → member_of, depends_on → depends_on, provider/module → uses, backend → backed_by, policy
 * → protected_by) — no new relationship type. Bounded for large estates (`MAX_WORKSPACES`, `MAX_STATE_SCAN`); a per
 * source failure is tolerated but a systemic (auth/offline) failure degrades the domain.
 */
import {
  makeResource,
  makeResourceId,
  type CloudResource,
  type DiscoveryContext,
  type DomainCollector,
  type DiscoveryPage,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { AuthError, HttpError, NetworkError } from '../../unified/sync/http';
import { asIac, iacGet, tfcList, pulumiList, fetchArtifactJson, fetchPlanJson } from './iacClient';
import { parseTerraformState, parsePulumiState, type IacFlavor, type IacStateModel } from './iacState';
import { analyzePlan, type ChangeSet } from './iacPlan';
import { computeDrift } from './iacDrift';

/** Cap the workspaces/stacks enumerated per account. */
export const MAX_WORKSPACES = 500;
/** Cap the workspaces whose (expensive) state is downloaded + parsed per discovery. */
export const MAX_STATE_SCAN = 100;
/** Cap the workspaces whose variables are enumerated. */
export const MAX_VAR_SCAN = 200;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : v == null ? null : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const asBool = (v: unknown): boolean => v === true || String(v).trim().toLowerCase() === 'true';

const isTfc = (flavor: IacFlavor): boolean => flavor !== 'pulumi';
const flavorOf = (ctx: DiscoveryContext): IacFlavor => asIac(ctx.http).flavor;
const orgOf = (ctx: DiscoveryContext): string => asIac(ctx.http).organization;

/* ── JSON:API accessors ────────────────────────────────────────────────────────── */
const jattrs = (r: Rec): Rec => (isRec(r.attributes) ? r.attributes : {});
const jrelId = (r: Rec, name: string): string | null => {
  const rels = isRec(r.relationships) ? r.relationships : {};
  const rel = isRec(rels[name]) ? (rels[name] as Rec) : {};
  const data = isRec(rel.data) ? (rel.data as Rec) : {};
  return asStr(data.id);
};

/* ── shared emit helpers ───────────────────────────────────────────────────────── */

interface Mapped {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
}
function build(ctx: DiscoveryContext, resourceType: string, m: Mapped): CloudResource {
  return makeResource({
    platformId: ctx.platformId,
    provider: 'iac',
    accountId: ctx.accountId,
    domain: 'provisioning',
    resourceType,
    region: null,
    now: ctx.now,
    nativeId: m.nativeId,
    name: m.name,
    status: m.status,
    health: m.health ?? 'healthy',
    attributes: m.attributes,
    relationships: m.relationships,
  });
}
const rel = (type: ResourceRelationship['type'], targetId: string | null): ResourceRelationship[] => (targetId ? [{ type, targetId }] : []);
/** A type-precise relationship target (the target's full resource id) so a known-type edge binds exactly. */
const ref = (ctx: DiscoveryContext, type: string, nativeId: string | null): string | null => (nativeId ? makeResourceId(ctx.platformId, ctx.accountId, type, nativeId) : null);
const page = (resources: CloudResource[]): DiscoveryPage => ({ resources, cursor: null, hasMore: false });
const empty = (): DiscoveryPage => page([]);
const isSystemic = (err: unknown): boolean => err instanceof AuthError || err instanceof NetworkError;

/** Run an async fn per source, tolerating a per-source non-systemic failure but degrading on systemic OR all-fail. */
async function forEachSource<T>(sources: T[], fn: (src: T) => Promise<void>): Promise<void> {
  let lastErr: unknown = null;
  let errored = 0;
  for (const src of sources) {
    try {
      await fn(src);
    } catch (err) {
      if (isSystemic(err)) throw err;
      lastErr = err;
      errored += 1;
    }
  }
  if (errored > 0 && errored === sources.length && lastErr) throw lastErr;
}

/* ── TFC listing helpers ───────────────────────────────────────────────────────── */

async function listWorkspaces(ctx: DiscoveryContext): Promise<Rec[]> {
  const org = orgOf(ctx);
  const all = await tfcList(ctx.http, `/api/v2/organizations/${encodeURIComponent(org)}/workspaces`);
  return all.slice(0, MAX_WORKSPACES);
}
async function listStacks(ctx: DiscoveryContext): Promise<Rec[]> {
  const org = orgOf(ctx);
  const all = await pulumiList(ctx.http, `/api/user/stacks?organization=${encodeURIComponent(org)}`, 'stacks');
  return all.slice(0, MAX_WORKSPACES);
}

/* ── Projects ──────────────────────────────────────────────────────────────────── */

const projectsCollector: DomainCollector = {
  id: 'iac_projects', domain: 'provisioning', label: 'Projects', resourceTypes: ['iac_project'],
  collect: async (ctx) => {
    const flavor = flavorOf(ctx);
    const org = orgOf(ctx);
    if (isTfc(flavor)) {
      const rows = await tfcList(ctx.http, `/api/v2/organizations/${encodeURIComponent(org)}/projects`);
      return page(rows.map((p) => {
        const a = jattrs(p);
        return build(ctx, 'iac_project', { nativeId: asStr(p.id) ?? '', name: asStr(a.name) || 'project', attributes: { flavor, workspaceCount: asNum(a['workspace-count']), description: asStr(a.description) } });
      }).filter((r) => r.nativeId));
    }
    // Pulumi: derive projects by grouping stacks.
    const stacks = await listStacks(ctx);
    const projects = new Map<string, number>();
    for (const s of stacks) { const p = asStr(s.projectName); if (p) projects.set(p, (projects.get(p) ?? 0) + 1); }
    return page([...projects].map(([name, count]) => build(ctx, 'iac_project', { nativeId: name, name, attributes: { flavor, stackCount: count } })));
  },
};

/* ── Workspaces (TFC) ──────────────────────────────────────────────────────────── */

function workspaceHealth(a: Rec): ResourceHealth {
  if (asBool(a.locked)) return 'degraded';
  return 'healthy';
}
const workspacesCollector: DomainCollector = {
  id: 'iac_workspaces', domain: 'provisioning', label: 'Workspaces', resourceTypes: ['iac_workspace'],
  collect: async (ctx) => {
    if (!isTfc(flavorOf(ctx))) return empty();
    const rows = await listWorkspaces(ctx);
    return page(rows.map((w) => {
      const a = jattrs(w);
      const projectId = jrelId(w, 'project');
      return build(ctx, 'iac_workspace', {
        nativeId: asStr(w.id) ?? '',
        name: asStr(a.name) || 'workspace',
        status: asStr(a['execution-mode']),
        health: workspaceHealth(a),
        attributes: { flavor: flavorOf(ctx), terraformVersion: asStr(a['terraform-version']), resourceCount: asNum(a['resource-count']), locked: asBool(a.locked), autoApply: asBool(a['auto-apply']), updatedAt: asStr(a['updated-at']) },
        relationships: [...rel('member_of', ref(ctx, 'iac_project', projectId)), ...rel('backed_by', ref(ctx, 'iac_backend', 'backend::remote'))],
      });
    }).filter((r) => r.nativeId));
  },
};

/* ── Stacks (Pulumi) ───────────────────────────────────────────────────────────── */

const stacksCollector: DomainCollector = {
  id: 'iac_stacks', domain: 'provisioning', label: 'Stacks', resourceTypes: ['iac_stack'],
  collect: async (ctx) => {
    if (isTfc(flavorOf(ctx))) return empty();
    const rows = await listStacks(ctx);
    return page(rows.map((s) => {
      const project = asStr(s.projectName);
      const stack = asStr(s.stackName);
      const nativeId = `${project ?? ''}/${stack ?? ''}`;
      return build(ctx, 'iac_stack', {
        nativeId,
        name: stack || nativeId,
        attributes: { flavor: 'pulumi', project, resourceCount: asNum(s.resourceCount), lastUpdate: asNum(s.lastUpdate) },
        relationships: [...rel('member_of', ref(ctx, 'iac_project', project)), ...rel('backed_by', ref(ctx, 'iac_backend', 'backend::pulumi'))],
      });
    }).filter((r) => r.nativeId !== '/'));
  },
};

/* ── Variables (TFC, per-workspace fan-out) ─────────────────────────────────────── */

const variablesCollector: DomainCollector = {
  id: 'iac_variables', domain: 'provisioning', label: 'Variables', resourceTypes: ['iac_variable'],
  collect: async (ctx) => {
    if (!isTfc(flavorOf(ctx))) return empty();
    const workspaces = (await listWorkspaces(ctx)).slice(0, MAX_VAR_SCAN);
    const out: CloudResource[] = [];
    await forEachSource(workspaces, async (w) => {
      const wsId = asStr(w.id);
      if (!wsId) return;
      const vars = await tfcList(ctx.http, `/api/v2/workspaces/${encodeURIComponent(wsId)}/vars`);
      for (const v of vars) {
        const a = jattrs(v);
        const key = asStr(a.key);
        if (!key) continue;
        // NEVER surface a variable value — TFC already nulls sensitive ones; we carry only the key + metadata.
        out.push(build(ctx, 'iac_variable', {
          nativeId: `${wsId}::${key}`,
          name: key,
          attributes: { flavor: flavorOf(ctx), category: asStr(a.category), sensitive: asBool(a.sensitive), hcl: asBool(a.hcl) },
          relationships: rel('member_of', ref(ctx, 'iac_workspace', wsId)),
        }));
      }
    });
    return page(out);
  },
};

/* ── Modules (TFC registry) ─────────────────────────────────────────────────────── */

const modulesCollector: DomainCollector = {
  id: 'iac_modules', domain: 'provisioning', label: 'Modules', resourceTypes: ['iac_module'],
  collect: async (ctx) => {
    if (!isTfc(flavorOf(ctx))) return empty();
    const org = orgOf(ctx);
    const rows = await tfcList(ctx.http, `/api/v2/organizations/${encodeURIComponent(org)}/registry-modules`);
    return page(rows.map((m) => {
      const a = jattrs(m);
      const name = asStr(a.name) || 'module';
      const provider = asStr(a.provider) || '';
      return build(ctx, 'iac_module', {
        nativeId: asStr(m.id) || `${name}/${provider}`,
        name,
        status: asStr(a.status),
        attributes: { flavor: flavorOf(ctx), namespace: asStr(a.namespace), provider, registry: asStr(a['registry-name']) },
      });
    }).filter((r) => r.nativeId));
  },
};

/* ── Policy sets (TFC) ─────────────────────────────────────────────────────────── */

const policiesCollector: DomainCollector = {
  id: 'iac_policies', domain: 'provisioning', label: 'Policies', resourceTypes: ['iac_policy_set'],
  collect: async (ctx) => {
    if (!isTfc(flavorOf(ctx))) return empty();
    const org = orgOf(ctx);
    const rows = await tfcList(ctx.http, `/api/v2/organizations/${encodeURIComponent(org)}/policy-sets`);
    return page(rows.map((p) => {
      const a = jattrs(p);
      return build(ctx, 'iac_policy_set', {
        nativeId: asStr(p.id) ?? '',
        name: asStr(a.name) || 'policy-set',
        attributes: { flavor: flavorOf(ctx), kind: asStr(a.kind), global: asBool(a.global), policyCount: asNum(a['policy-count']), workspaceCount: asNum(a['workspace-count']) },
      });
    }).filter((r) => r.nativeId));
  },
};

/* ── State + Resources + Providers + Outputs + Backend + Drift (the core) ───────── */

/** Emit the parsed state's managed resources + providers + outputs, scoped to one workspace/stack. */
function emitStateResources(ctx: DiscoveryContext, scopeId: string, scopeType: 'iac_workspace' | 'iac_stack', model: IacStateModel, changes: ChangeSet | null): CloudResource[] {
  const flavor = flavorOf(ctx);
  const out: CloudResource[] = [];
  const changeByAddress = new Map((changes?.changes ?? []).map((c) => [c.address, c] as const));
  const providersSeen = new Map<string, string | null>(); // providerName → fqn

  for (const r of model.resources) {
    if (r.mode === 'provider' || r.mode === 'stack') continue; // pseudo-resources become provider/backend nodes below
    const provKey = r.providerName ?? r.providerFqn;
    if (provKey) providersSeen.set(provKey, r.providerFqn);
    const change = changeByAddress.get(r.address);
    const relationships: ResourceRelationship[] = [
      ...rel('member_of', ref(ctx, scopeType, scopeId)),
      ...rel('uses', provKey ? ref(ctx, 'iac_provider', `provider::${provKey}`) : null),
      ...(r.parentAddress ? rel('member_of', ref(ctx, 'iac_resource', `${scopeId}::${r.parentAddress}`)) : []),
      ...r.dependencies.map((d) => ({ type: 'depends_on' as const, targetId: ref(ctx, 'iac_resource', `${scopeId}::${d}`)! })).filter((e) => e.targetId),
    ];
    out.push(build(ctx, 'iac_resource', {
      nativeId: `${scopeId}::${r.address}`,
      name: r.address,
      status: change ? change.action : r.status,
      health: r.status === 'tainted' ? 'degraded' : 'healthy',
      attributes: { flavor, iacType: r.type, mode: r.mode, provider: r.providerName, module: r.moduleAddress, pendingChange: change?.action ?? null, driftedOutOfBand: change?.fromDrift ?? false, ...r.attributes },
      relationships,
    }));
  }

  for (const [name, fqn] of providersSeen) {
    out.push(build(ctx, 'iac_provider', { nativeId: `provider::${name}`, name, attributes: { flavor, fqn } }));
  }
  for (const o of model.outputs) {
    out.push(build(ctx, 'iac_output', { nativeId: `${scopeId}::output::${o.name}`, name: o.name, attributes: { flavor, sensitive: o.sensitive, type: o.type }, relationships: rel('member_of', ref(ctx, scopeType, scopeId)) }));
  }
  return out;
}

/** Best-effort drift signal for a scope: analyze its latest plan/preview and reconcile desired vs actual. */
function driftAttributes(ctx: DiscoveryContext, scopeId: string, actual: CloudResource[], changes: ChangeSet | null): ResourceAttributes {
  if (!changes) return {};
  const actualResources = actual.filter((r) => r.resourceType === 'iac_resource');
  const actualByAddr = new Set(actualResources.map((r) => r.nativeId)); // workspace-prefixed nativeIds
  // Re-key the plan's bare addresses onto the same workspace-scoped ids the resources use, so computeDrift matches.
  const scopedChanges: ChangeSet = { ...changes, changes: changes.changes.map((c) => ({ ...c, address: `${scopeId}::${c.address}` })) };
  // desired = actual ∪ synthetic nodes for plan-only (create) addresses, so `missing` resources are scored.
  const desired: CloudResource[] = [...actualResources];
  for (const c of scopedChanges.changes) {
    if (!actualByAddr.has(c.address)) desired.push(build(ctx, 'iac_resource', { nativeId: c.address, name: c.address, attributes: { iacType: c.type, provider: c.provider } }));
  }
  const report = computeDrift({ desired, actual: actualResources, changes: scopedChanges }, Date.parse(ctx.now));
  return {
    driftScore: report.driftScore,
    drifted: report.counts.drifted,
    changed: report.counts.changed,
    missing: report.counts.missing,
    unmanaged: report.counts.unmanaged,
    criticalRisk: report.counts.byRisk.critical,
    highRisk: report.counts.byRisk.high,
    planCreate: changes.counts.create,
    planUpdate: changes.counts.update,
    planDelete: changes.counts.delete,
    planReplace: changes.counts.replace,
  };
}

/** Fetch + analyze the latest plan JSON for a TFC workspace (best-effort; null when unreachable). */
async function latestTfcPlan(ctx: DiscoveryContext, wsId: string, flavor: IacFlavor): Promise<ChangeSet | null> {
  try {
    const runs = await tfcList(ctx.http, `/api/v2/workspaces/${encodeURIComponent(wsId)}/runs?page[size]=1`);
    const planId = runs.length ? jrelId(runs[0], 'plan') : null;
    if (!planId) return null;
    const planJson = await fetchPlanJson(asIac(ctx.http), `/api/v2/plans/${encodeURIComponent(planId)}/json-output`);
    return planJson ? analyzePlan(planJson, flavor) : null;
  } catch (err) {
    if (isSystemic(err)) throw err;
    return null; // a plan we can't read is simply not analyzed
  }
}

const stateCollector: DomainCollector = {
  id: 'iac_state', domain: 'provisioning', label: 'State & Resources', resourceTypes: ['iac_resource', 'iac_provider', 'iac_output', 'iac_state', 'iac_backend'],
  collect: async (ctx) => {
    const flavor = flavorOf(ctx);
    const out: CloudResource[] = [];
    const http = asIac(ctx.http);

    if (isTfc(flavor)) {
      const allWorkspaces = await listWorkspaces(ctx);
      const workspaces = allWorkspaces.slice(0, MAX_STATE_SCAN);
      out.push(build(ctx, 'iac_backend', { nativeId: 'backend::remote', name: 'Terraform remote backend', attributes: { flavor, kind: 'remote', workspaces: allWorkspaces.length, stateScanned: workspaces.length, scanTruncated: allWorkspaces.length > workspaces.length } }));
      await forEachSource(workspaces, async (w) => {
        const wsId = asStr(w.id);
        if (!wsId) return;
        let model: IacStateModel;
        try {
          const sv = await iacGet(ctx.http, `/api/v2/workspaces/${encodeURIComponent(wsId)}/current-state-version`);
          const downloadUrl = asStr(jattrs(isRec(sv.data) ? (sv.data as Rec) : sv)['hosted-state-download-url']);
          if (!downloadUrl) return; // workspace has no current state version yet
          model = parseTerraformState(await fetchArtifactJson(http, downloadUrl), flavor);
        } catch (err) {
          if (err instanceof NetworkError || err instanceof AuthError) throw err; // offline / our-token rejection → degrade
          if (err instanceof HttpError && err.status === 404) return; // no state yet → skip, not a domain failure
          throw err; // a stale artifact / transient error → forEachSource tolerates one, degrades only if ALL fail
        }
        const changes = await latestTfcPlan(ctx, wsId, flavor);
        const resources = emitStateResources(ctx, wsId, 'iac_workspace', model, changes);
        out.push(...resources);
        out.push(build(ctx, 'iac_state', {
          nativeId: `${wsId}::state`,
          name: `${asStr(jattrs(w).name) ?? wsId} state`,
          attributes: { flavor, serial: model.serial, lineage: model.lineage, resources: model.resources.length, truncated: model.truncated, ...driftAttributes(ctx, wsId, resources, changes) },
          relationships: [...rel('member_of', ref(ctx, 'iac_workspace', wsId)), ...rel('backed_by', ref(ctx, 'iac_backend', 'backend::remote'))],
        }));
      });
      return page(out);
    }

    // Pulumi: export each stack's deployment (same-origin) and parse.
    out.push(build(ctx, 'iac_backend', { nativeId: 'backend::pulumi', name: 'Pulumi Cloud state backend', attributes: { flavor, kind: 'pulumi.com' } }));
    const org = orgOf(ctx);
    const stacks = (await listStacks(ctx)).slice(0, MAX_STATE_SCAN);
    await forEachSource(stacks, async (s) => {
      const project = asStr(s.projectName);
      const stack = asStr(s.stackName);
      if (!project || !stack) return;
      const scopeId = `${project}/${stack}`;
      let model: IacStateModel;
      try {
        model = parsePulumiState(await iacGet(ctx.http, `/api/stacks/${encodeURIComponent(org)}/${encodeURIComponent(project)}/${encodeURIComponent(stack)}/export`));
      } catch (err) {
        if (err instanceof NetworkError || err instanceof AuthError) throw err;
        if (err instanceof HttpError && err.status === 404) return; // stack has no state yet → skip
        throw err;
      }
      const scoped = emitStateResources(ctx, scopeId, 'iac_stack', model, null);
      out.push(...scoped);
      out.push(build(ctx, 'iac_state', {
        nativeId: `${scopeId}::state`,
        name: `${stack} state`,
        attributes: { flavor, version: model.serial, resources: model.resources.length, truncated: model.truncated },
        relationships: [...rel('member_of', ref(ctx, 'iac_stack', scopeId)), ...rel('backed_by', ref(ctx, 'iac_backend', 'backend::pulumi'))],
      }));
    });
    return page(out);
  },
};

/* ── Plans / Previews ──────────────────────────────────────────────────────────── */

function runHealth(status: string | null): ResourceHealth {
  switch (status) {
    case 'errored': case 'canceled': case 'force_canceled': return 'critical';
    case 'planned_and_finished': case 'applied': case 'policy_checked': return 'healthy';
    case 'discarded': return 'degraded';
    default: return 'unknown';
  }
}
const plansCollector: DomainCollector = {
  id: 'iac_plans', domain: 'provisioning', label: 'Plans', resourceTypes: ['iac_plan'],
  collect: async (ctx) => {
    const flavor = flavorOf(ctx);
    const out: CloudResource[] = [];
    if (isTfc(flavor)) {
      const workspaces = (await listWorkspaces(ctx)).slice(0, MAX_STATE_SCAN);
      await forEachSource(workspaces, async (w) => {
        const wsId = asStr(w.id);
        if (!wsId) return;
        const runs = await tfcList(ctx.http, `/api/v2/workspaces/${encodeURIComponent(wsId)}/runs?page[size]=1`);
        if (!runs.length) return;
        const run = runs[0];
        const a = jattrs(run);
        const planId = jrelId(run, 'plan');
        let planAttrs: Rec = {};
        if (planId) {
          try { const p = await iacGet(ctx.http, `/api/v2/plans/${encodeURIComponent(planId)}`); planAttrs = jattrs(isRec(p.data) ? (p.data as Rec) : p); }
          catch (err) { if (isSystemic(err)) throw err; }
        }
        out.push(build(ctx, 'iac_plan', {
          nativeId: asStr(run.id) ?? `${wsId}::run`,
          name: asStr(a.message) || `run ${asStr(run.id) ?? ''}`,
          status: asStr(a.status),
          health: runHealth(asStr(a.status)),
          attributes: { flavor, hasChanges: asBool(a['has-changes']), isDestroy: asBool(a['is-destroy']), createdAt: asStr(a['created-at']), additions: asNum(planAttrs['resource-additions']), changes: asNum(planAttrs['resource-changes']), destructions: asNum(planAttrs['resource-destructions']) },
          relationships: rel('member_of', ref(ctx, 'iac_workspace', wsId)),
        }));
      });
      return page(out);
    }
    // Pulumi: latest update per stack becomes a preview/plan record.
    const org = orgOf(ctx);
    const stacks = (await listStacks(ctx)).slice(0, MAX_STATE_SCAN);
    await forEachSource(stacks, async (s) => {
      const project = asStr(s.projectName);
      const stack = asStr(s.stackName);
      if (!project || !stack) return;
      const scopeId = `${project}/${stack}`;
      let hist: Rec;
      try {
        hist = await iacGet(ctx.http, `/api/stacks/${encodeURIComponent(org)}/${encodeURIComponent(project)}/${encodeURIComponent(stack)}/updates/latest`);
      } catch (err) {
        if (err instanceof NetworkError || err instanceof AuthError) throw err;
        if (err instanceof HttpError && err.status === 404) return; // stack has no updates yet → skip
        throw err;
      }
      const info = isRec(hist.info) ? (hist.info as Rec) : hist;
      const kind = asStr(info.kind);
      if (!kind && !asStr(info.result)) return;
      const rc = isRec(info.resourceChanges) ? (info.resourceChanges as Rec) : {};
      out.push(build(ctx, 'iac_plan', {
        nativeId: `${scopeId}::update::${asStr(info.version) ?? 'latest'}`,
        name: `${kind ?? 'update'} ${asStr(info.version) ?? ''}`.trim(),
        status: asStr(info.result),
        health: asStr(info.result) === 'succeeded' ? 'healthy' : asStr(info.result) === 'failed' ? 'critical' : 'unknown',
        attributes: { flavor, kind, create: asNum(rc.create), update: asNum(rc.update), delete: asNum(rc.delete), same: asNum(rc.same) },
        relationships: rel('member_of', ref(ctx, 'iac_stack', scopeId)),
      }));
    });
    return page(out);
  },
};

/** Every IaC collector (all under the `provisioning` domain; each self-gates by flavor). */
export const IAC_COLLECTORS: DomainCollector[] = [
  projectsCollector,
  workspacesCollector,
  stacksCollector,
  variablesCollector,
  modulesCollector,
  policiesCollector,
  stateCollector,
  plansCollector,
];
