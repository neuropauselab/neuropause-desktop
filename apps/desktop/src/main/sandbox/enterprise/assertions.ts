/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the assertion engine.
 *
 * Every assertion type (Step 6) is evaluated against REAL platform state read through
 * the {@link EnterprisePlatform} port — a record's persisted fields, a timeline event,
 * a knowledge-graph node, an executive KPI delta, an automation run, a connector's sync
 * state, REST/SDK/CLI results, desktop UI, a latency budget, and RBAC permission gates.
 * Each returns a pass/fail verdict; the executor decides stop-on-failure. Never a mock.
 */
import type { EnterpriseAssertion } from '@neuropause/shared';
import type { EnterprisePlatform } from './platform';
import type { VariableScope } from './vars';

export interface AssertionContext {
  platform: EnterprisePlatform;
  vars: VariableScope;
  now: () => number;
  /** KPI values captured at run start, keyed by KPI key (for executiveKpiChanged). */
  baselineKpis: Map<string, number | null>;
  /** Latency (ms) of the step this assertion follows (for performanceThreshold). */
  lastStepMs: number;
}

export interface AssertionVerdict {
  ok: boolean;
  message: string;
}

export type AssertionEvaluator = (a: EnterpriseAssertion, ctx: AssertionContext) => Promise<AssertionVerdict>;

const EVALUATORS: Record<EnterpriseAssertion['type'], AssertionEvaluator> = {
  recordExists: async (a, ctx) => {
    const id = idOf(a, ctx);
    if (!a.moduleId || !id) return fail('recordExists needs moduleId + target');
    const rec = await ctx.platform.module.get(a.moduleId, id);
    const exists = !!rec && rec.status !== 'deleted';
    return verdict(exists, `record ${a.moduleId}/${id} ${exists ? 'exists' : 'missing'}`, a);
  },

  recordUpdated: async (a, ctx) => {
    const id = idOf(a, ctx);
    if (!a.moduleId || !id) return fail('recordUpdated needs moduleId + target');
    const rec = await ctx.platform.module.get(a.moduleId, id);
    if (!rec) return fail(`record ${a.moduleId}/${id} not found`);
    const actual = a.field ? rec.fields[a.field] ?? (a.field === 'status' ? rec.status : undefined) : rec.status;
    const ok = compare(actual, ctx.vars.resolve(a.expected), a.operator ?? 'eq');
    return verdict(ok, `${a.moduleId}/${id}.${a.field ?? 'status'} = ${fmt(actual)} ${a.operator ?? 'eq'} ${fmt(a.expected)}`, a);
  },

  timelineEventExists: async (a, ctx) => {
    const ref = idOf(a, ctx);
    const entries = await ctx.platform.timeline.query(ref);
    const match = a.expected ? entries.filter((e) => e.kind === String(a.expected)) : entries;
    return verdict(match.length > 0, `timeline for ${ref}: ${match.length} matching event(s)`, a);
  },

  knowledgeGraphUpdated: async (a, ctx) => {
    await ctx.platform.graph.rebuild();
    const ref = idOf(a, ctx);
    const nodeId = ref.startsWith('erp:') ? ref : `erp:${ref}`;
    const node = await ctx.platform.graph.getNode(nodeId);
    return verdict(!!node, `graph node ${nodeId} ${node ? 'present' : 'absent'}`, a);
  },

  memoryUpdated: async (a, ctx) => {
    const ref = idOf(a, ctx);
    const ok = await ctx.platform.memory.references(ref);
    return verdict(ok, `memory ${ok ? 'references' : 'does not reference'} ${ref}`, a);
  },

  automationExecuted: async (a, ctx) => {
    // Prefer a saved run result; fall back to the monitor rollup.
    const saved = a.target ? ctx.vars.get(a.target) : undefined;
    if (saved && typeof saved === 'object') {
      const ok = (saved as { ok?: boolean }).ok === true;
      return verdict(ok, `automation run ok=${ok}`, a);
    }
    const monitor = await ctx.platform.automation.monitor();
    const want = typeof a.expected === 'number' ? a.expected : 1;
    return verdict(monitor.completed >= want, `automation completed=${monitor.completed} (>= ${want})`, a);
  },

  connectorSynced: async (a, ctx) => {
    const id = idOf(a, ctx);
    const state = await ctx.platform.connectors.state(id);
    const ok = !!state && state.status === 'success' && state.consecutiveFailures === 0;
    return verdict(ok, `connector ${id} state=${state?.status ?? 'none'}`, a);
  },

  executiveKpiChanged: async (a, ctx) => {
    const key = a.target ?? '';
    const kpis = await ctx.platform.executive.snapshotKpis();
    const kpi = kpis.find((k) => k.key === key);
    if (!kpi) return fail(`KPI "${key}" not found`);
    if (a.expected !== undefined) {
      const ok = compare(kpi.value, ctx.vars.resolve(a.expected), a.operator ?? 'eq');
      return verdict(ok, `KPI ${key}=${fmt(kpi.value)} ${a.operator ?? 'eq'} ${fmt(a.expected)}`, a);
    }
    const before = ctx.baselineKpis.get(key);
    const ok = (before ?? null) !== (kpi.value ?? null);
    return verdict(ok, `KPI ${key}: ${fmt(before)} → ${fmt(kpi.value)}`, a);
  },

  restResponse: (a, ctx) => Promise.resolve(evalSavedResult(a, ctx, 'status')),
  sdkResult: (a, ctx) => Promise.resolve(evalSavedResult(a, ctx, 'ok')),
  cliResult: (a, ctx) => Promise.resolve(evalSavedResult(a, ctx, 'code')),

  desktopUi: (a, ctx) => {
    const saved = a.target ? ctx.vars.get(a.target) : undefined;
    const ok = !!saved && typeof saved === 'object' && (saved as { ok?: boolean }).ok === true;
    return Promise.resolve(verdict(ok, `desktop assertion ok=${ok}`, a));
  },

  performanceThreshold: (a, ctx) => {
    const budget = a.maxMs ?? (typeof a.expected === 'number' ? a.expected : 0);
    const ok = ctx.lastStepMs <= budget;
    return Promise.resolve(verdict(ok, `step ${ctx.lastStepMs}ms <= ${budget}ms`, a));
  },

  securityPermission: async (a, ctx) => {
    const perm = a.permission ?? a.target ?? '';
    const allowed = await ctx.platform.security.can(perm);
    const want = a.allowed ?? true;
    return verdict(allowed === want, `permission ${perm}: allowed=${allowed} (want ${want})`, a);
  },

  rbacValidation: async (a, ctx) => {
    const perm = a.permission ?? a.target ?? '';
    const allowed = await ctx.platform.security.can(perm);
    const want = a.allowed ?? true;
    return verdict(allowed === want, `RBAC ${perm}: allowed=${allowed} (want ${want})`, a);
  },

  webhookDelivered: async (a, ctx) => {
    const ref = idOf(a, ctx);
    const ok = await ctx.platform.webhook.delivered(ref);
    return verdict(ok, `webhook ${ref} ${ok ? 'delivered' : 'not delivered'}`, a);
  },

  pluginRegistered: async (a, ctx) => {
    const id = idOf(a, ctx);
    const ok = await ctx.platform.plugin.isRegistered(id);
    return verdict(ok, `plugin ${id} ${ok ? 'registered' : 'not registered'}`, a);
  },
};

export async function evaluateAssertion(a: EnterpriseAssertion, ctx: AssertionContext): Promise<AssertionVerdict> {
  const evaluator = EVALUATORS[a.type];
  if (!evaluator) return fail(`unknown assertion "${a.type}"`);
  try {
    return await evaluator(a, ctx);
  } catch (err) {
    return fail(`${a.type} error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ── helpers ── */
function evalSavedResult(a: EnterpriseAssertion, ctx: AssertionContext, defaultField: string): AssertionVerdict {
  const saved = a.target ? ctx.vars.get(a.target) : undefined;
  if (saved === undefined) return fail(`${a.type}: variable "${a.target}" not set`);
  const container = saved as Record<string, unknown>;
  const field = a.field ?? defaultField;
  const actual = field in container ? container[field] : saved;
  const ok = a.expected === undefined ? truthy(actual) : compare(actual, ctx.vars.resolve(a.expected), a.operator ?? 'eq');
  return verdict(ok, `${a.type} ${field}=${fmt(actual)}${a.expected === undefined ? '' : ` ${a.operator ?? 'eq'} ${fmt(a.expected)}`}`, a);
}

function idOf(a: EnterpriseAssertion, ctx: AssertionContext): string {
  const resolved = ctx.vars.resolve(a.target ?? '');
  return typeof resolved === 'string' ? resolved : String(resolved ?? '');
}

function compare(actual: unknown, expected: unknown, op: string): boolean {
  switch (op) {
    case 'eq': return eq(actual, expected);
    case 'neq': return !eq(actual, expected);
    case 'contains':
      if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
      return String(actual ?? '').includes(String(expected ?? ''));
    case 'gt': return toNum(actual) > toNum(expected);
    case 'gte': return toNum(actual) >= toNum(expected);
    case 'lt': return toNum(actual) < toNum(expected);
    case 'lte': return toNum(actual) <= toNum(expected);
    case 'exists': return actual !== undefined && actual !== null;
    case 'changed': return true; // handled by KPI baseline path
    default: return eq(actual, expected);
  }
}
function eq(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return toNum(a) === toNum(b);
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}
function toNum(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}
function truthy(v: unknown): boolean {
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== '';
}
function verdict(ok: boolean, detail: string, a: EnterpriseAssertion): AssertionVerdict {
  return { ok, message: a.message ? `${a.message} (${detail})` : `${a.type}: ${detail}` };
}
function fail(message: string): AssertionVerdict {
  return { ok: false, message };
}
function fmt(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
