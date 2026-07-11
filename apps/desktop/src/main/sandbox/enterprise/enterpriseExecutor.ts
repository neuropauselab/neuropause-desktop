/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the executor.
 *
 * A `SandboxExecutor` (registered on the S1 engine through the executor router) that runs
 * a complete enterprise workflow end-to-end: parse → check preconditions + approval →
 * materialize the dataset → run each step through the correct channel (module/REST/SDK/
 * CLI/desktop/automation/plugin/connector/planning) with per-step retry + recovery →
 * evaluate assertions against REAL platform state → run cleanup / best-effort rollback →
 * emit JSON/HTML/JUnit reports as S1 artifacts → return a structured result with
 * performance metrics. It REUSES the S1 pipeline entirely (timeline/log/artifact hooks,
 * result, report) and the S2 desktop machinery; there is no second engine, queue,
 * artifact store, dataset store, or report generator here.
 */
import {
  parseEnterpriseScenario,
  resolveStepChannel,
  type EnterpriseAssertion,
  type EnterprisePrecondition,
  type EnterpriseScenarioSpec,
  type EnterpriseStep,
  type RunAssertions,
  type RunOutcome,
} from '@neuropause/shared';
import type { SandboxExecutor, SandboxRunContext, SandboxRunOutcome } from '../executionEngine';
import type { EnterprisePlatform } from './platform';
import { ENTERPRISE_ACTIONS, type ActionContext, type ActionOutcome } from './actions';
import { evaluateAssertion, type AssertionContext } from './assertions';
import { materializeDataset } from './datasets';
import { EnterprisePerfCollector } from './metrics';
import { VariableScope } from './vars';
import { classifyEnterpriseFailure, buildDiagnostics } from './recovery';
import { reportToHtml, reportToJUnitXml, reportToJson, type EnterpriseRunReport, type EnterpriseStepReport } from './report';

export interface EnterpriseExecutorDeps {
  platform: EnterprisePlatform;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface StepRunResult {
  status: EnterpriseStepReport['status'];
  attempts: number;
  durationMs: number;
  message?: string;
  assertions: { type: string; ok: boolean; message: string }[];
  fatal: boolean;
}

export function createEnterpriseExecutor(deps: EnterpriseExecutorDeps): SandboxExecutor {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const platform = deps.platform;

  return async (ctx: SandboxRunContext): Promise<SandboxRunOutcome> => {
    const parsed = parseEnterpriseScenario(ctx.version.spec);
    if (!parsed.ok) return { outcome: 'error', summary: `Invalid enterprise scenario: ${parsed.error}` };
    const scenario = parsed.value;

    const perf = new EnterprisePerfCollector();
    const t0 = now();
    const vars = new VariableScope({ ...scenario.variables });
    const created: { moduleId: string; id: string }[] = [];
    const stepReports: EnterpriseStepReport[] = [];
    const state = { desktopUsed: false, fatalError: null as string | null };

    const actionCtx: ActionContext = {
      platform,
      vars,
      perf,
      emitLog: (m, level) => ctx.log(m, level),
      emitStep: (name) => ctx.step(name),
      attachArtifact: (input) => void ctx.attachArtifact(input),
      sleep,
      now,
      track: (moduleId, id) => created.push({ moduleId, id }),
    };

    // Baseline KPIs for executiveKpiChanged assertions.
    const baselineKpis = new Map<string, number | null>();
    try {
      for (const k of await platform.executive.snapshotKpis()) baselineKpis.set(k.key, k.value);
    } catch {
      /* KPIs are best-effort */
    }

    const finish = (outcome: RunOutcome, summary: string): SandboxRunOutcome => {
      perf.scenarioMs = now() - t0;
      const assertions: RunAssertions = { total: perf.assertionsTotal, passed: perf.assertionsPassed, failed: perf.assertionsFailed };
      attachReports(ctx, scenario, outcome, new Date(t0).toISOString(), perf, stepReports, created.length);
      return { outcome, summary, assertions, metrics: perf.metrics() };
    };

    // ── Preconditions ──
    for (const pc of scenario.preconditions) {
      const ok = await checkPrecondition(pc, platform);
      if (!ok) {
        ctx.log(`precondition failed: ${describePrecondition(pc)}`, 'error');
        attachDiagnostics(ctx, classifyEnterpriseFailure(new Error(`precondition ${pc.type}`)), 'precondition', pc.type, 'module', 1, vars, created.length);
        return finish('error', `Precondition failed: ${describePrecondition(pc)}`);
      }
    }

    // ── Approval (respects real RBAC) ──
    if (scenario.approval.required) {
      const perm = scenario.approval.permission ?? 'sandbox:manage';
      const allowed = await platform.security.can(perm).catch(() => false);
      if (!allowed) {
        ctx.log(`approval required but actor lacks "${perm}"`, 'error');
        return finish('error', `Approval required: actor lacks "${perm}".`);
      }
      ctx.log(`approval satisfied (${perm})`);
    }

    // ── Dataset ──
    if (scenario.dataset) {
      try {
        const materialized = await materializeDataset(scenario.dataset, platform);
        vars.set('dataset', materialized.rows);
        vars.set('datasetRow', materialized.rows[0] ?? {});
        ctx.attachArtifact({ kind: 'log', name: 'dataset.json', mimeType: 'application/json', inline: JSON.stringify({ source: materialized.source, schema: materialized.schema, rows: materialized.rows.length, valid: materialized.valid, errors: materialized.errors }, null, 2), metadata: { rows: materialized.rows.length, valid: materialized.valid } });
        if (!materialized.valid) ctx.log(`dataset validation: ${materialized.errors.slice(0, 5).join('; ')}`, 'warn');
      } catch (err) {
        ctx.log(`dataset materialization failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
      }
    }

    // ── Steps ──
    const doneStatus = new Map<string, EnterpriseStepReport['status']>();
    let aborted = false;
    for (const step of scenario.steps) {
      if (ctx.signal.cancelled) { aborted = true; break; }
      if (dependencyBlocked(step, doneStatus)) {
        const report = skipReport(step, scenario, 'dependency not satisfied');
        stepReports.push(report);
        doneStatus.set(step.id, 'skipped');
        perf.stepsSkipped += 1;
        ctx.log(`step "${step.id}" skipped — dependency not satisfied`, 'warn');
        continue;
      }

      const result = await runStep(step, scenario, actionCtx, { platform, vars, now, baselineKpis }, perf, sleep, now, () => { state.desktopUsed = true; });
      const report: EnterpriseStepReport = {
        id: step.id,
        name: step.name ?? step.id,
        action: step.action,
        channel: resolveStepChannel(step, scenario.defaultChannel),
        status: result.status,
        attempts: result.attempts,
        durationMs: result.durationMs,
        assertions: result.assertions,
      };
      if (result.message) report.message = result.message;
      stepReports.push(report);
      doneStatus.set(step.id, result.status);

      if (result.status === 'passed') perf.stepsRun += 1;
      else if (result.status === 'skipped') perf.stepsSkipped += 1;
      else perf.stepsFailed += 1;

      if (result.fatal && !step.optional) {
        if (result.status === 'error') state.fatalError = result.message ?? 'step error';
        aborted = true;
        ctx.log(`aborting after step "${step.id}"`, 'error');
        attachDiagnostics(ctx, classifyEnterpriseFailure(new Error(result.message ?? 'step failed')), step.id, step.action, report.channel, result.attempts, vars, created.length);
        break;
      }
    }

    // ── Scenario-level assertions ──
    if (!aborted) {
      const assertCtx: AssertionContext = { platform, vars, now, baselineKpis, lastStepMs: 0 };
      for (const a of scenario.assertions) {
        const verdict = await evaluateAssertion(a, assertCtx);
        perf.assertionsTotal += 1;
        if (verdict.ok) perf.assertionsPassed += 1;
        else perf.assertionsFailed += 1;
        ctx.log(verdict.message, verdict.ok ? 'info' : 'error');
      }
    }

    // ── Cleanup + best-effort rollback ──
    await runCleanup(scenario, actionCtx, created, state.fatalError !== null || perf.assertionsFailed > 0, ctx, platform, vars);

    // Close desktop session if the run opened one.
    if (platform.desktop.isOpen()) await platform.desktop.close().catch(() => undefined);

    // ── Outcome ──
    const outcome: RunOutcome = state.fatalError ? 'error' : perf.assertionsFailed > 0 || perf.stepsFailed > 0 || aborted ? 'fail' : 'pass';
    const summary =
      outcome === 'pass'
        ? `Enterprise scenario passed — ${perf.stepsRun} step(s), ${perf.assertionsPassed}/${perf.assertionsTotal} assertion(s).`
        : outcome === 'fail'
          ? `Enterprise scenario failed — ${perf.stepsFailed} step failure(s), ${perf.assertionsFailed} assertion failure(s).`
          : `Enterprise scenario errored — ${state.fatalError}.`;
    return finish(outcome, summary);
  };
}

/* ── step execution with retry + recovery ── */
async function runStep(
  step: EnterpriseStep,
  scenario: EnterpriseScenarioSpec,
  actionCtx: ActionContext,
  assertDeps: { platform: EnterprisePlatform; vars: VariableScope; now: () => number; baselineKpis: Map<string, number | null> },
  perf: EnterprisePerfCollector,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  markDesktop: () => void,
): Promise<StepRunResult> {
  const retry = step.retry ?? scenario.retry;
  const maxAttempts = Math.max(1, retry.maxAttempts);
  const started = now();
  let attempts = 0;
  let lastError = '';

  actionCtx.emitStep(step.name ?? `${step.action} (${step.id})`);
  const channel = resolveStepChannel(step, scenario.defaultChannel);
  if (channel === 'desktop') markDesktop();

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const input = actionCtx.vars.resolve(step.input ?? {});
      let outcome: ActionOutcome = {};
      if (step.action === 'exportReport') {
        // handled by the executor at run end; the mid-run marker just logs.
        actionCtx.emitLog('exportReport requested — reports are emitted as artifacts at run end');
      } else {
        // auto-open a desktop session for desktop steps
        if (channel === 'desktop' && step.action !== 'openDesktop' && !actionCtx.platform.desktop.isOpen()) {
          await actionCtx.platform.desktop.open({ profile: 'temporary' });
        }
        const handler = ENTERPRISE_ACTIONS[step.action];
        outcome = await handler(input as Record<string, unknown>, actionCtx);
      }
      if (step.saveAs) actionCtx.vars.set(step.saveAs, outcome.value ?? outcome.record ?? null);

      const durationMs = now() - started;
      perf.step(durationMs);

      // per-step assertions
      const verdicts = await runAssertions(step.assert ?? [], { ...assertDeps, lastStepMs: durationMs }, perf);
      const failed = verdicts.filter((v) => !v.ok);
      if (failed.length) {
        for (const f of failed) actionCtx.emitLog(f.message, 'error');
        return { status: 'failed', attempts, durationMs, message: failed[0].message, assertions: verdicts, fatal: !step.optional };
      }
      return { status: 'passed', attempts, durationMs, assertions: verdicts, fatal: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const failure = classifyEnterpriseFailure(err);
      actionCtx.emitLog(`step "${step.id}" attempt ${attempts} failed [${failure.kind}]: ${lastError}`, 'warn');
      if (failure.recoverable && attempts < maxAttempts) {
        perf.recoveries += 1;
        await sleep(retry.backoffMs ?? 0);
        continue;
      }
      const durationMs = now() - started;
      perf.step(durationMs);
      const skip = step.optional || retry.onExhausted === 'skip';
      return {
        status: skip ? 'skipped' : 'error',
        attempts,
        durationMs,
        message: lastError,
        assertions: [],
        fatal: !skip,
      };
    }
  }
  return { status: 'error', attempts, durationMs: now() - started, message: lastError, assertions: [], fatal: !step.optional };
}

async function runAssertions(
  list: EnterpriseAssertion[],
  ctx: AssertionContext,
  perf: EnterprisePerfCollector,
): Promise<{ type: string; ok: boolean; message: string }[]> {
  const out: { type: string; ok: boolean; message: string }[] = [];
  for (const a of list) {
    const verdict = await evaluateAssertion(a, ctx);
    perf.assertionsTotal += 1;
    if (verdict.ok) perf.assertionsPassed += 1;
    else perf.assertionsFailed += 1;
    out.push({ type: a.type, ok: verdict.ok, message: verdict.message });
  }
  return out;
}

async function runCleanup(
  scenario: EnterpriseScenarioSpec,
  actionCtx: ActionContext,
  created: { moduleId: string; id: string }[],
  runFailed: boolean,
  ctx: SandboxRunContext,
  platform: EnterprisePlatform,
  vars: VariableScope,
): Promise<void> {
  // Explicit teardown steps always run (best-effort).
  for (const step of scenario.cleanup) {
    try {
      const input = vars.resolve(step.input ?? {}) as Record<string, unknown>;
      if (step.action !== 'exportReport') await ENTERPRISE_ACTIONS[step.action](input, actionCtx);
    } catch (err) {
      ctx.log(`cleanup step "${step.id}" failed (ignored): ${err instanceof Error ? err.message : String(err)}`, 'warn');
    }
  }
  // Auto-rollback tracked records only when the run failed AND no explicit cleanup was defined.
  if (runFailed && scenario.cleanup.length === 0 && created.length > 0) {
    let rolled = 0;
    for (const rec of [...created].reverse()) {
      const ok = await platform.module.delete(rec.moduleId, rec.id).catch(() => false);
      if (ok) rolled += 1;
    }
    if (rolled) ctx.log(`rolled back ${rolled} record(s) created during the failed run`, 'warn');
  }
}

/* ── preconditions ── */
async function checkPrecondition(pc: EnterprisePrecondition, platform: EnterprisePlatform): Promise<boolean> {
  switch (pc.type) {
    case 'permission':
      return platform.security.can(pc.permission ?? pc.target ?? '').catch(() => false);
    case 'moduleRegistered':
      return platform.module.isRegistered(pc.target ?? '');
    case 'recordExists': {
      const [moduleId, id] = (pc.target ?? '').split(':');
      if (!moduleId || !id) return false;
      return !!(await platform.module.get(moduleId, id).catch(() => null));
    }
    case 'connectorConnected': {
      const state = await platform.connectors.state(pc.target ?? '').catch(() => null);
      return !!state;
    }
    case 'custom':
    default:
      return true;
  }
}
function describePrecondition(pc: EnterprisePrecondition): string {
  return pc.message ?? `${pc.type}${pc.target ? ` ${pc.target}` : ''}${pc.permission ? ` ${pc.permission}` : ''}`;
}

/* ── reporting ── */
function buildRunReport(
  scenario: EnterpriseScenarioSpec,
  outcome: RunOutcome,
  startedAt: string,
  perf: EnterprisePerfCollector,
  steps: EnterpriseStepReport[],
  recordsCreated: number,
): EnterpriseRunReport {
  const m = perf.metrics();
  return {
    title: scenario.metadata.title,
    category: scenario.category,
    scenario: scenario.metadata.title,
    outcome,
    startedAt,
    durationMs: m.scenarioMs,
    steps,
    assertions: { total: m.assertionsTotal, passed: m.assertionsPassed, failed: m.assertionsFailed },
    metrics: m,
    changes: { recordsCreated, timelineEvents: 0, connectorSyncs: m.connectorSyncs },
    summary:
      outcome === 'pass'
        ? `${scenario.metadata.title} passed across ${steps.filter((s) => s.status === 'passed').length} step(s).`
        : `${scenario.metadata.title} ${outcome === 'fail' ? 'failed' : 'errored'} — see step detail.`,
  };
}

function attachReports(
  ctx: SandboxRunContext,
  scenario: EnterpriseScenarioSpec,
  outcome: RunOutcome,
  startedAt: string,
  perf: EnterprisePerfCollector,
  steps: EnterpriseStepReport[],
  recordsCreated: number,
): void {
  const report = buildRunReport(scenario, outcome, startedAt, perf, steps, recordsCreated);
  ctx.attachArtifact({ kind: 'report', name: 'report.json', mimeType: 'application/json', inline: reportToJson(report), metadata: { outcome } });
  ctx.attachArtifact({ kind: 'report', name: 'report.html', mimeType: 'text/html', inline: reportToHtml(report), metadata: { outcome } });
  ctx.attachArtifact({ kind: 'report', name: 'report.junit.xml', mimeType: 'application/xml', inline: reportToJUnitXml(report), metadata: { outcome } });
}

function attachDiagnostics(
  ctx: SandboxRunContext,
  failure: ReturnType<typeof classifyEnterpriseFailure>,
  stepId: string,
  action: string,
  channel: string,
  attempts: number,
  vars: VariableScope,
  recordsToRollback: number,
): void {
  const diag = buildDiagnostics(failure, stepId, action, channel, attempts, Object.keys(vars.all()), recordsToRollback);
  ctx.attachArtifact({ kind: 'log', name: 'diagnostics.json', mimeType: 'application/json', inline: JSON.stringify(diag, null, 2), metadata: { failure: failure.kind } });
}

function dependencyBlocked(step: EnterpriseStep, done: Map<string, EnterpriseStepReport['status']>): boolean {
  for (const dep of step.dependsOn ?? []) {
    const status = done.get(dep);
    if (status !== 'passed') return true;
  }
  return false;
}

function skipReport(step: EnterpriseStep, scenario: EnterpriseScenarioSpec, reason: string): EnterpriseStepReport {
  return {
    id: step.id,
    name: step.name ?? step.id,
    action: step.action,
    channel: resolveStepChannel(step, scenario.defaultChannel),
    status: 'skipped',
    attempts: 0,
    durationMs: 0,
    message: reason,
    assertions: [],
  };
}
