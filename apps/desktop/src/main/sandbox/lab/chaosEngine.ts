/**
 * AI Sandbox — Performance & Security Lab (S5): the chaos engine.
 *
 * Injects CONTROLLED, CONTAINED faults (Step 5). Inducible faults run a fault-triggering
 * scenario THROUGH the sandbox executor (a missing connector → connector timeout, a bad
 * REST path → rest timeout, a missing record → error) — the fault is real but confined to
 * the sandbox run; the host process and production data are never touched (Safety). Faults
 * that cannot be safely induced in-process (disk full, real OS crash, network loss) run in
 * `probe` mode: the lab reads the EXISTING diagnostics to confirm the platform's resilience
 * posture without causing harm. Recovery is judged with S4's failure classifier + the
 * NeuroCore health level — never a new diagnostics system.
 */
import { classify } from '../agent/reflection';
import type { ChaosExperiment, ChaosFaultKind, ChaosMode, ChaosResult, QaObservation, ScenarioSpec } from '@neuropause/shared';
import { connectorCheck, pluginCheck } from '../agent/scenarioTemplates';
import type { LabDeps, QaRunResult } from './ports';

const RESILIENT_LEVELS: ReadonlySet<string> = new Set(['healthy', 'degraded']);

interface CatalogEntry {
  mode: ChaosMode;
  spec?: ScenarioSpec;
}

function ent(kind: 'enterprise' | 'desktop', body: Record<string, unknown>): ScenarioSpec {
  return { kind, ...body };
}

/** Each fault → how it is exercised. Inducible faults carry a contained scenario. */
export const CHAOS_CATALOG: Record<ChaosFaultKind, CatalogEntry> = {
  'connector-timeout': { mode: 'induce', spec: connectorCheck('nonexistent-connector') },
  'automation-failure': { mode: 'induce', spec: ent('enterprise', { category: 'automation', metadata: { title: 'chaos automation' }, steps: [{ id: 's', action: 'triggerAutomation', input: { ruleId: 'nonexistent-rule' }, assert: [{ type: 'automationExecuted', expected: 1 }] }] }) },
  'permission-failure': { mode: 'induce', spec: ent('enterprise', { category: 'security', metadata: { title: 'chaos permission' }, steps: [{ id: 's', action: 'moduleAction', input: { moduleId: 'crm-customers', id: 'nonexistent', action: 'approve' } }] }) },
  'plugin-failure': { mode: 'induce', spec: pluginCheck('nonexistent-plugin') },
  'rest-timeout': { mode: 'induce', spec: ent('enterprise', { category: 'api', metadata: { title: 'chaos rest' }, steps: [{ id: 's', action: 'executeRestCall', input: { method: 'GET', path: '/nonexistent' }, assert: [{ type: 'restResponse', target: 's', field: 'status', expected: 200 }] }] }) },
  'sdk-failure': { mode: 'induce', spec: ent('enterprise', { category: 'sdk', metadata: { title: 'chaos sdk' }, steps: [{ id: 's', action: 'executeSdkCall', input: { method: 'bogusMethod' }, saveAs: 'r', assert: [{ type: 'sdkResult', target: 'r', field: 'ok', expected: true }] }] }) },
  'cli-failure': { mode: 'induce', spec: ent('enterprise', { category: 'cli', metadata: { title: 'chaos cli' }, steps: [{ id: 's', action: 'executeCliCommand', input: { argv: ['bogus'] }, saveAs: 'r', assert: [{ type: 'cliResult', target: 'r', field: 'code', expected: 0 }] }] }) },
  'desktop-crash': { mode: 'induce', spec: ent('desktop', { launch: { profile: 'temporary' }, actions: [{ type: 'waitFor', selector: '#app' }] }) },
  'renderer-crash': { mode: 'induce', spec: ent('desktop', { launch: { profile: 'temporary' }, actions: [{ type: 'click', selector: '#crash-me' }] }) },
  'worker-crash': { mode: 'probe' },
  'webhook-failure': { mode: 'probe' },
  'queue-failure': { mode: 'probe' },
  'memory-pressure': { mode: 'probe' },
  'disk-full': { mode: 'probe' },
  'network-loss': { mode: 'probe' },
  'oauth-expiry': { mode: 'probe' },
  'auth-failure': { mode: 'probe' },
};

export const CHAOS_FAULT_KINDS = Object.keys(CHAOS_CATALOG) as ChaosFaultKind[];

export async function runChaos(exp: ChaosExperiment, deps: LabDeps): Promise<ChaosResult> {
  const entry = CHAOS_CATALOG[exp.fault];
  const mode: ChaosMode = exp.mode ?? entry?.mode ?? 'probe';

  if (mode === 'probe' || !entry?.spec) {
    const level = await readHealthLevel(deps);
    return { id: exp.id, fault: exp.fault, mode: 'probe', induced: false, recovered: RESILIENT_LEVELS.has(level), recoveryMs: 0, failureClass: 'none', healthLevelAfter: level };
  }

  const t0 = deps.now();
  const result = await deps.executor.run({ id: exp.id, name: exp.fault, spec: entry.spec });
  const recoveryMs = deps.now() - t0;
  const failureClass = classify(toObservation(exp.id, result));
  const level = await readHealthLevel(deps);
  // Recovered = the fault was CONTAINED: the run reached a terminal status and the platform stayed resilient.
  const terminal = result.status !== 'queued' && result.status !== 'running';
  const recovered = terminal && (level === 'unknown' ? true : RESILIENT_LEVELS.has(level));
  return { id: exp.id, fault: exp.fault, mode: 'induce', induced: true, recovered, recoveryMs, failureClass, healthLevelAfter: level };
}

export async function runChaosSuite(experiments: ChaosExperiment[], deps: LabDeps): Promise<ChaosResult[]> {
  const out: ChaosResult[] = [];
  for (const exp of experiments) out.push(await runChaos(exp, deps));
  return out;
}

/** A default chaos experiment per fault (using the catalog's mode). */
export function defaultChaosExperiments(): ChaosExperiment[] {
  return CHAOS_FAULT_KINDS.map((fault) => ({ id: `chaos-${fault}`, fault, mode: CHAOS_CATALOG[fault].mode }));
}

async function readHealthLevel(deps: LabDeps): Promise<string> {
  const h = await deps.observers?.health?.().catch(() => null);
  return h?.level ?? 'unknown';
}

function toObservation(id: string, r: QaRunResult): QaObservation {
  return {
    taskId: id,
    executionId: r.executionId,
    status: r.status,
    outcome: r.outcome,
    assertions: r.assertions,
    metrics: r.metrics,
    artifacts: r.artifacts,
    timelinePhases: r.timelinePhases,
    knowledgeGraphRefs: r.knowledgeGraphRefs,
    error: r.error,
  };
}
