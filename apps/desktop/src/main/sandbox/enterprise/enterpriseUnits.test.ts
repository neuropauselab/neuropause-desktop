/** AI Sandbox S3 — enterprise unit tests (actions, assertions, datasets, report, recovery, vars). */
import { describe, expect, it } from 'vitest';
import { FakeEnterprisePlatform } from './fakePlatform';
import { ENTERPRISE_ACTIONS, type ActionContext, type ArtifactInput } from './actions';
import { evaluateAssertion, type AssertionContext } from './assertions';
import { materializeDataset } from './datasets';
import { reportToHtml, reportToJUnitXml, reportToJson, type EnterpriseRunReport } from './report';
import { classifyEnterpriseFailure } from './recovery';
import { EnterprisePerfCollector } from './metrics';
import { VariableScope } from './vars';
import { EnterprisePlatformError } from './platform';

function actionCtx(platform: FakeEnterprisePlatform, vars = new VariableScope()): { ctx: ActionContext; artifacts: ArtifactInput[] } {
  const artifacts: ArtifactInput[] = [];
  const ctx: ActionContext = {
    platform,
    vars,
    perf: new EnterprisePerfCollector(),
    emitLog: () => undefined,
    emitStep: () => undefined,
    attachArtifact: (a) => artifacts.push(a),
    sleep: () => Promise.resolve(),
    now: () => 1,
    track: () => undefined,
  };
  return { ctx, artifacts };
}
function assertCtx(platform: FakeEnterprisePlatform, vars = new VariableScope()): AssertionContext {
  return { platform, vars, now: () => 1, baselineKpis: new Map(), lastStepMs: 0 };
}

describe('enterprise actions (real platform port)', () => {
  it('creates records across ERP/CRM and runs a module action', async () => {
    const platform = new FakeEnterprisePlatform();
    const { ctx } = actionCtx(platform);
    const cust = await ENTERPRISE_ACTIONS.createCustomer({ name: 'Acme', customerTier: 'gold' }, ctx);
    expect(cust.recordId).toBeTruthy();
    const po = await ENTERPRISE_ACTIONS.createPurchaseOrder({ poNumber: 'PO-1', total: 500 }, ctx);
    const approved = await ENTERPRISE_ACTIONS.approvePurchaseOrder({ id: po.recordId }, ctx);
    expect(approved.record?.status).toBe('approved');
    expect(platform.records.size).toBe(2);
  });

  it('drives the REST / SDK / CLI developer channels through the port', async () => {
    const platform = new FakeEnterprisePlatform();
    const { ctx } = actionCtx(platform);
    const rest = await ENTERPRISE_ACTIONS.executeRestCall({ method: 'POST', path: '/modules/crm-customers/records', body: { fields: { name: 'Via REST' } } }, ctx);
    expect((rest.value as { status: number }).status).toBe(201);
    expect(ctx.perf.metrics().restCalls).toBe(1);
    const sdk = await ENTERPRISE_ACTIONS.executeSdkCall({ method: 'getModules' }, ctx);
    expect((sdk.value as { ok: boolean; data: unknown }).ok).toBe(true);
    expect(Array.isArray((sdk.value as { data: unknown }).data)).toBe(true);
    const cli = await ENTERPRISE_ACTIONS.executeCliCommand({ argv: ['modules'] }, ctx);
    expect((cli.value as { code: number }).code).toBe(0);
  });

  it('runs planning, automation, connector, and desktop channels', async () => {
    const platform = new FakeEnterprisePlatform({ automationRules: ['rule-1'], connectors: ['github'], desktopElements: [{ selector: '#home', visible: true }] });
    const { ctx, artifacts } = actionCtx(platform);
    expect((await ENTERPRISE_ACTIONS.runMrp({}, ctx)).value).toBeTruthy();
    expect((await ENTERPRISE_ACTIONS.triggerAutomation({ ruleId: 'rule-1' }, ctx)).value).toMatchObject({ ok: true });
    expect((await ENTERPRISE_ACTIONS.syncConnector({ connectorId: 'github' }, ctx)).value).toMatchObject({ ok: true });
    await ENTERPRISE_ACTIONS.openDesktop({}, ctx);
    await ENTERPRISE_ACTIONS.clickUi({ selector: '#home' }, ctx);
    await ENTERPRISE_ACTIONS.takeScreenshot({ name: 'home' }, ctx);
    expect(artifacts.some((a) => a.kind === 'screenshot')).toBe(true);
  });

  it('throws a real platform error for an unregistered module', async () => {
    const platform = new FakeEnterprisePlatform({ modules: ['crm-customers'] });
    const { ctx } = actionCtx(platform);
    await expect(ENTERPRISE_ACTIONS.createProduct({ sku: 'X' }, ctx)).rejects.toBeInstanceOf(EnterprisePlatformError);
  });
});

describe('assertion engine (reads real platform state)', () => {
  it('evaluates record, timeline, graph and kpi assertions', async () => {
    const platform = new FakeEnterprisePlatform();
    const { ctx } = actionCtx(platform);
    const cust = await ENTERPRISE_ACTIONS.createCustomer({ name: 'Acme', status: 'active' }, ctx);
    const vars = new VariableScope({ custId: cust.recordId });
    const ac = assertCtx(platform, vars);

    expect((await evaluateAssertion({ type: 'recordExists', moduleId: 'crm-customers', target: '${custId}' }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'recordUpdated', moduleId: 'crm-customers', target: '${custId}', field: 'status', expected: 'active' }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'recordUpdated', moduleId: 'crm-customers', target: '${custId}', field: 'status', expected: 'nope' }, ac)).ok).toBe(false);
    expect((await evaluateAssertion({ type: 'timelineEventExists', target: '${custId}' }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'knowledgeGraphUpdated', target: '${custId}' }, ac)).ok).toBe(true);
  });

  it('evaluates security / rbac permission assertions against the real gate', async () => {
    const platform = new FakeEnterprisePlatform({ permissions: ['crm:read'], deny: ['finance:manage'] });
    const ac = assertCtx(platform);
    expect((await evaluateAssertion({ type: 'securityPermission', permission: 'crm:read', allowed: true }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'rbacValidation', permission: 'finance:manage', allowed: false }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'rbacValidation', permission: 'finance:manage', allowed: true }, ac)).ok).toBe(false);
  });

  it('evaluates performance, connector, plugin and webhook assertions', async () => {
    const platform = new FakeEnterprisePlatform({ connectors: ['github'], plugins: ['p1'], webhooks: ['wh1'] });
    const { ctx } = actionCtx(platform);
    await ENTERPRISE_ACTIONS.syncConnector({ connectorId: 'github' }, ctx);
    const ac = { ...assertCtx(platform), lastStepMs: 40 };
    expect((await evaluateAssertion({ type: 'performanceThreshold', maxMs: 100 }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'performanceThreshold', maxMs: 10 }, ac)).ok).toBe(false);
    expect((await evaluateAssertion({ type: 'connectorSynced', target: 'github' }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'pluginRegistered', target: 'p1' }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'webhookDelivered', target: 'wh1' }, ac)).ok).toBe(true);
    expect((await evaluateAssertion({ type: 'webhookDelivered', target: 'missing' }, ac)).ok).toBe(false);
  });
});

describe('dataset materialization', () => {
  it('parses CSV + JSON, generates deterministic rows, and validates', async () => {
    const platform = new FakeEnterprisePlatform();
    const csv = await materializeDataset({ source: 'csv', raw: 'name,amount\nAcme,100\nGlobex,250', validate: ['name'] }, platform);
    expect(csv.rows).toHaveLength(2);
    expect(csv.rows[0]).toMatchObject({ name: 'Acme', amount: 100 });
    expect(csv.valid).toBe(true);

    const gen1 = await materializeDataset({ source: 'generated', generate: { count: 3, seed: 7, template: { name: 'Cust {{index1}}', code: '{{pick:A|B|C}}' } } }, platform);
    const gen2 = await materializeDataset({ source: 'generated', generate: { count: 3, seed: 7, template: { name: 'Cust {{index1}}', code: '{{pick:A|B|C}}' } } }, platform);
    expect(gen1.rows).toHaveLength(3);
    expect(gen1.rows).toEqual(gen2.rows); // deterministic (seeded)

    const invalid = await materializeDataset({ source: 'inline', rows: [{ amount: 5 }], validate: ['name'] }, platform);
    expect(invalid.valid).toBe(false);
  });

  it('references existing platform records', async () => {
    const platform = new FakeEnterprisePlatform();
    const { ctx } = actionCtx(platform);
    await ENTERPRISE_ACTIONS.createCustomer({ name: 'Ref' }, ctx);
    const ds = await materializeDataset({ source: 'reference', reference: { moduleId: 'crm-customers' } }, platform);
    expect(ds.rows.length).toBe(1);
    expect(ds.rows[0].name).toBe('Ref');
  });
});

describe('report exporters', () => {
  const report: EnterpriseRunReport = {
    title: 'P2P', category: 'procurement', scenario: 'P2P', outcome: 'fail',
    startedAt: '2026-01-01T00:00:00.000Z', durationMs: 1200,
    steps: [
      { id: 's1', name: 'create', action: 'createCustomer', channel: 'module', status: 'passed', attempts: 1, durationMs: 5, assertions: [{ type: 'recordExists', ok: true, message: 'ok' }] },
      { id: 's2', name: 'approve', action: 'approvePurchaseOrder', channel: 'module', status: 'failed', attempts: 1, durationMs: 8, message: 'bad', assertions: [{ type: 'recordUpdated', ok: false, message: 'status mismatch' }] },
    ],
    assertions: { total: 2, passed: 1, failed: 1 }, metrics: { scenarioMs: 1200 },
    changes: { recordsCreated: 1, timelineEvents: 2, connectorSyncs: 0 }, summary: 'failed',
  };

  it('emits valid JSON, HTML and JUnit XML', () => {
    expect(JSON.parse(reportToJson(report)).outcome).toBe('fail');
    const html = reportToHtml(report);
    expect(html).toContain('<table');
    expect(html).toContain('P2P');
    const xml = reportToJUnitXml(report);
    expect(xml).toContain('<testsuite');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('<failure');
  });
});

describe('failure classification + variable scope', () => {
  it('classifies recoverable vs terminal failures', () => {
    expect(classifyEnterpriseFailure(new EnterprisePlatformError('module "x" not registered', 'module_not_found'))).toMatchObject({ kind: 'not_found', recoverable: false });
    expect(classifyEnterpriseFailure(new Error('request timed out'))).toMatchObject({ kind: 'timeout', recoverable: true });
    expect(classifyEnterpriseFailure(new Error('missing permission crm:manage'))).toMatchObject({ kind: 'authorization', recoverable: false });
    expect(classifyEnterpriseFailure(new EnterprisePlatformError('requires playwright', 'desktop_unavailable'))).toMatchObject({ kind: 'platform_unavailable', recoverable: false });
  });

  it('interpolates ${var} tokens (whole-token preserves type)', () => {
    const vars = new VariableScope({ id: 'rec_9', row: { name: 'Acme', amt: 100 } });
    expect(vars.resolve('${id}')).toBe('rec_9');
    expect(vars.resolve('PO for ${row.name}')).toBe('PO for Acme');
    expect(vars.resolve({ customer: '${id}', total: '${row.amt}' })).toEqual({ customer: 'rec_9', total: 100 });
  });
});
