/**
 * P6.10 — the IaC DomainCollectors: flavor self-gating (a Pulumi-only collector no-ops on a Terraform backend and
 * vice versa), Terraform Cloud workspace/project discovery, the core state flow (download → parse → managed
 * resources + provider + output + state nodes with type-precise member_of / uses / depends_on edges), drift
 * enrichment onto the state node from a plan's resource_drift, Pulumi stack + state discovery, the Resource Graph
 * projection, and the single-domain span. Pure-node; the transport is faked.
 */
import { describe, expect, it } from 'vitest';
import { buildResourceGraph, makeResourceId, type DiscoveryContext, type DiscoveryHttp } from '@neuropause/shared';
import { AuthError, HttpError } from '../../unified/sync/http';
import { IAC_COLLECTORS } from './iacCollectors';
import type { IacFlavor } from './iacState';

const NOW = '2026-07-14T00:00:00.000Z';
const collector = (id: string) => IAC_COLLECTORS.find((c) => c.id === id)!;

type Rec = Record<string, unknown>;
interface FakeOpts { send?: (url: string) => Rec; sendThrows?: (url: string) => Error | null; artifact?: (url: string) => string; location?: (path: string) => { location: string | null; text: string | null } }
function fakeIac(flavor: IacFlavor, opts: FakeOpts): DiscoveryHttp {
  return {
    flavor,
    organization: 'acme',
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => { const e = opts.sendThrows?.(req.url); if (e) throw e; return { status: 200, headers: {}, text: JSON.stringify(opts.send ? opts.send(req.url) : {}) }; },
    getArtifact: async (url: string) => (opts.artifact ? opts.artifact(url) : '{}'),
    getLocation: async (path: string) => (opts.location ? opts.location(path) : { location: null, text: null }),
  } as unknown as DiscoveryHttp;
}
const ctx = (http: DiscoveryHttp): DiscoveryContext => ({ platformId: 'iac', accountId: (http as unknown as { flavor: string }).flavor, region: null, cursor: null, now: NOW, http });

const TF_STATE = {
  version: 4, terraform_version: '1.9.5', serial: 3, lineage: 'lin',
  outputs: { ip: { value: '1.2.3.4', type: 'string' } },
  resources: [
    { mode: 'managed', type: 'aws_instance', name: 'web', provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [{ attributes: { id: 'i-1' }, dependencies: ['aws_security_group.web'] }] },
    { mode: 'managed', type: 'aws_security_group', name: 'web', provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [{ attributes: { id: 'sg-1' } }] },
  ],
};
const tfWorkspaces = { data: [{ id: 'ws-1', type: 'workspaces', attributes: { name: 'prod', 'terraform-version': '1.9.5', 'resource-count': 2, locked: false }, relationships: { project: { data: { id: 'prj-1' } } } }], links: {} };
const tfStateVersion = { data: { id: 'sv-1', type: 'state-versions', attributes: { 'hosted-state-download-url': 'https://archivist.terraform.io/state.json', serial: 3 } } };

function tfcRouter(withPlan: boolean): (url: string) => Rec {
  return (url) => {
    if (url.startsWith('/api/v2/organizations/acme/workspaces')) return tfWorkspaces;
    if (url.startsWith('/api/v2/organizations/acme/projects')) return { data: [{ id: 'prj-1', type: 'projects', attributes: { name: 'core', 'workspace-count': 1 } }], links: {} };
    if (url.includes('/current-state-version')) return tfStateVersion;
    if (url.includes('/runs')) return withPlan ? { data: [{ id: 'run-1', type: 'runs', attributes: { status: 'planned_and_finished' }, relationships: { plan: { data: { id: 'plan-1' } } } }], links: {} } : { data: [], links: {} };
    if (url.includes('/plans/plan-1')) return { data: { id: 'plan-1', attributes: { 'resource-additions': 0, 'resource-changes': 1, 'resource-destructions': 0 } } };
    return {};
  };
}
const TF_PLAN_DRIFT = { format_version: '1.2', resource_changes: [], resource_drift: [{ address: 'aws_security_group.web', type: 'aws_security_group', provider_name: 'registry.terraform.io/hashicorp/aws', change: { actions: ['update'], before: { desc: 'a' }, after: { desc: 'b' } } }] };

describe('flavor self-gating', () => {
  it('a Pulumi-only collector no-ops on a Terraform backend and vice versa', async () => {
    const tf = fakeIac('terraform', { send: tfcRouter(false) });
    const pu = fakeIac('pulumi', { send: () => ({ stacks: [] }) });
    expect((await collector('iac_stacks').collect(ctx(tf))).resources).toHaveLength(0);
    expect((await collector('iac_workspaces').collect(ctx(pu))).resources).toHaveLength(0);
    expect((await collector('iac_modules').collect(ctx(pu))).resources).toHaveLength(0);
  });
});

describe('Terraform Cloud discovery', () => {
  it('maps workspaces with member_of project + backed_by backend', async () => {
    const http = fakeIac('terraform', { send: tfcRouter(false) });
    const p = await collector('iac_workspaces').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('ws-1');
    expect(p.resources[0].attributes).toMatchObject({ terraformVersion: '1.9.5', resourceCount: 2 });
    const rels = p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`);
    expect(rels).toContain(`member_of:${makeResourceId('iac', 'terraform', 'iac_project', 'prj-1')}`);
    expect(rels).toContain(`backed_by:${makeResourceId('iac', 'terraform', 'iac_backend', 'backend::remote')}`);
  });

  it('parses state into managed resources + provider + output + state, with type-precise edges', async () => {
    const http = fakeIac('terraform', { send: tfcRouter(false), artifact: () => JSON.stringify(TF_STATE) });
    const p = await collector('iac_state').collect(ctx(http));
    const byNative = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    const web = byNative['ws-1::aws_instance.web'];
    expect(web.resourceType).toBe('iac_resource');
    const rels = web.relationships.map((r) => `${r.type}:${r.targetId}`);
    expect(rels).toContain(`member_of:${makeResourceId('iac', 'terraform', 'iac_workspace', 'ws-1')}`);
    expect(rels).toContain(`uses:${makeResourceId('iac', 'terraform', 'iac_provider', 'provider::aws')}`);
    expect(rels).toContain(`depends_on:${makeResourceId('iac', 'terraform', 'iac_resource', 'ws-1::aws_security_group.web')}`);
    expect(byNative['provider::aws'].resourceType).toBe('iac_provider');
    expect(byNative['ws-1::output::ip'].resourceType).toBe('iac_output');
    expect(byNative['ws-1::state'].attributes).toMatchObject({ serial: 3, resources: 2 });
  });

  it('tolerates a fresh workspace with no state yet (404) — skips it, domain stays healthy', async () => {
    const http = fakeIac('terraform', { send: tfcRouter(false), sendThrows: (url) => url.includes('current-state-version') ? new HttpError(404, 'no state', false) : null });
    const p = await collector('iac_state').collect(ctx(http)); // must NOT throw
    expect(p.resources.some((r) => r.resourceType === 'iac_backend')).toBe(true);
    expect(p.resources.some((r) => r.resourceType === 'iac_resource')).toBe(false);
  });

  it('DEGRADES the domain on a systemic auth failure (our API token rejected)', async () => {
    const http = fakeIac('terraform', { send: tfcRouter(false), sendThrows: (url) => url.includes('current-state-version') ? new AuthError('denied', 403) : null });
    await expect(collector('iac_state').collect(ctx(http))).rejects.toBeInstanceOf(AuthError);
  });

  it('enriches the state node with drift from a plan resource_drift', async () => {
    const http = fakeIac('terraform', { send: tfcRouter(true), artifact: () => JSON.stringify(TF_STATE), location: (path) => path.includes('plan-1/json-output') ? { location: null, text: JSON.stringify(TF_PLAN_DRIFT) } : { location: null, text: null } });
    const p = await collector('iac_state').collect(ctx(http));
    const state = p.resources.find((r) => r.resourceType === 'iac_state')!;
    expect(state.attributes.drifted).toBe(1);
    expect(Number(state.attributes.driftScore)).toBeLessThan(100);
    const sg = p.resources.find((r) => r.nativeId === 'ws-1::aws_security_group.web')!;
    expect(sg.attributes.driftedOutOfBand).toBe(true);
  });
});

describe('Pulumi discovery', () => {
  const PULUMI_DEPLOYMENT = {
    version: 3,
    deployment: { manifest: { version: 'v3' }, resources: [
      { urn: 'urn:pulumi:prod::web::pulumi:pulumi:Stack::web-prod', custom: false, type: 'pulumi:pulumi:Stack', outputs: { url: 'x' } },
      { urn: 'urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets', custom: true, id: 'b1', type: 'aws:s3/bucket:Bucket', outputs: { arn: 'a' }, parent: 'urn:pulumi:prod::web::pulumi:pulumi:Stack::web-prod', provider: 'urn:pulumi:prod::web::pulumi:providers:aws::default::uuid' },
    ] },
  };
  const puRouter = (url: string): Rec => {
    if (url.startsWith('/api/user/stacks')) return { stacks: [{ orgName: 'acme', projectName: 'web', stackName: 'prod', resourceCount: 2 }] };
    if (url.includes('/export')) return PULUMI_DEPLOYMENT;
    return {};
  };

  it('maps stacks with member_of project + backed_by backend', async () => {
    const http = fakeIac('pulumi', { send: puRouter });
    const p = await collector('iac_stacks').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('web/prod');
    expect(p.resources[0].relationships.map((r) => r.type)).toEqual(expect.arrayContaining(['member_of', 'backed_by']));
  });

  it('exports + parses stack state into managed resources under the stack', async () => {
    const http = fakeIac('pulumi', { send: puRouter });
    const p = await collector('iac_state').collect(ctx(http));
    const bucket = p.resources.find((r) => r.nativeId === 'web/prod::urn:pulumi:prod::web::aws:s3/bucket:Bucket::assets')!;
    expect(bucket.resourceType).toBe('iac_resource');
    expect(bucket.relationships.map((r) => `${r.type}:${r.targetId}`)).toContain(`member_of:${makeResourceId('iac', 'pulumi', 'iac_stack', 'web/prod')}`);
    expect(p.resources.some((r) => r.nativeId === 'web/prod::state')).toBe(true);
  });
});

describe('Resource Graph projection', () => {
  it('resolves workspace + state edges into the graph', async () => {
    const http = fakeIac('terraform', { send: tfcRouter(false), artifact: () => JSON.stringify(TF_STATE) });
    const resources = [
      ...(await collector('iac_workspaces').collect(ctx(http))).resources,
      ...(await collector('iac_projects').collect(ctx(http))).resources,
      ...(await collector('iac_state').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    // resource → workspace (member_of), resource → provider (uses), resource → resource (depends_on) all resolve.
    expect(model.edges.some((e) => e.type === 'member_of' && e.to === makeResourceId('iac', 'terraform', 'iac_workspace', 'ws-1'))).toBe(true);
    expect(model.edges.some((e) => e.type === 'depends_on')).toBe(true);
    expect(model.edges.some((e) => e.type === 'uses' && e.to === makeResourceId('iac', 'terraform', 'iac_provider', 'provider::aws'))).toBe(true);
  });
});

describe('IaC platform — one domain, eight collectors', () => {
  it('every collector is in the provisioning domain', () => {
    expect(IAC_COLLECTORS).toHaveLength(8);
    expect(new Set(IAC_COLLECTORS.map((c) => c.domain))).toEqual(new Set(['provisioning']));
  });
});
