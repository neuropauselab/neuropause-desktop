/**
 * AI Sandbox — AI QA Agent (S4): the agent contract.
 *
 * Turns the scripted Scenario Runner (S3) into an AI-driven QA platform. The AI REASONS
 * (plans goals, decides next actions, reflects on outcomes, writes bug reports); it never
 * executes platform operations itself — it submits scenario specs to the EXISTING S1/S2/S3
 * executors. These types + the pure helpers are the shared, validated shape the agent
 * runtime and the SDK/portal author against. No runtime here — just the contract + its
 * deterministic helpers (the S4 analog of S3's `parseEnterpriseScenario`).
 */
import type { ScenarioSpec } from './sandbox';
import type { EnterpriseAssertion } from './enterpriseScenario';

/* ─────────────────────────────── agents + goals ─────────────────────────────── */

export type QaAgentCategory =
  | 'regression'
  | 'erp'
  | 'crm'
  | 'manufacturing'
  | 'inventory'
  | 'planning'
  | 'finance'
  | 'developer-portal'
  | 'plugin'
  | 'connector'
  | 'automation'
  | 'security'
  | 'executive'
  | 'knowledge-graph'
  | 'timeline';

export const QA_AGENT_CATEGORIES: readonly QaAgentCategory[] = [
  'regression', 'erp', 'crm', 'manufacturing', 'inventory', 'planning', 'finance',
  'developer-portal', 'plugin', 'connector', 'automation', 'security', 'executive',
  'knowledge-graph', 'timeline',
];

export type QaPriority = 'p0' | 'p1' | 'p2' | 'p3';
export type QaSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type QaGoalKind = 'natural' | 'structured';

export interface QaGoal {
  id: string;
  kind: QaGoalKind;
  /** The natural-language ask, or a structured description. */
  text: string;
  agent: QaAgentCategory;
  /** Modules / domains the goal targets. */
  targets: string[];
  priority: QaPriority;
  /** Whether the goal's destructive tasks need approval before running. */
  requireApproval: boolean;
  metadata: Record<string, unknown>;
}

/* ─────────────────────────────── plan + tasks ─────────────────────────────── */

/** What "correct" means for a task — mirrors an S3 assertion (evaluated by the executor). */
export interface QaExpectation {
  description: string;
  assertion?: EnterpriseAssertion;
}

export interface QaTask {
  id: string;
  name: string;
  goalId: string;
  /** The S1/S2/S3 scenario the executor runs (enterprise or desktop). The AI never runs it directly. */
  spec: ScenarioSpec;
  expectations: QaExpectation[];
  dependsOn: string[];
  priority: QaPriority;
  /** A task that deletes/mutates production data — gated behind approval unless the agent allows it. */
  destructive: boolean;
  retry: { maxAttempts: number; backoffMs: number };
}

export interface QaPlan {
  goalId: string;
  agent: QaAgentCategory;
  tasks: QaTask[];
  /** Topologically-sorted task ids (deterministic execution order). */
  order: string[];
}

/* ─────────────────────────────── observation ─────────────────────────────── */

export type QaRunOutcome = 'pass' | 'fail' | 'error' | null;

export interface QaArtifactRef {
  name: string;
  kind: string;
  ref: string | null;
}

/** What the agent OBSERVES from a run — read only through the existing executor's outcome. */
export interface QaObservation {
  taskId: string;
  executionId: string | null;
  status: string;
  outcome: QaRunOutcome;
  assertions: { total: number; passed: number; failed: number };
  metrics: Record<string, number>;
  artifacts: QaArtifactRef[];
  timelinePhases: string[];
  knowledgeGraphRefs: string[];
  error: string | null;
}

/* ─────────────────────────────── reflection ─────────────────────────────── */

export type QaFailureClass =
  | 'none'
  | 'regression'
  | 'assertion'
  | 'timeout'
  | 'crash'
  | 'permission'
  | 'data'
  | 'flaky'
  | 'environment'
  | 'unknown';

export interface QaHypothesis {
  cause: string;
  confidence: number;
  evidence: string[];
}

export interface QaReflection {
  taskId: string;
  matchedExpectations: number;
  totalExpectations: number;
  regressionDetected: boolean;
  failureClass: QaFailureClass;
  confidence: number;
  hypotheses: QaHypothesis[];
  recommendations: string[];
}

/* ─────────────────────────────── decision ─────────────────────────────── */

export type QaDecisionKind = 'proceed' | 'retry' | 'alternative' | 'abort' | 'escalate' | 'approve';

export interface QaDecision {
  kind: QaDecisionKind;
  reason: string;
  taskId?: string;
}

/* ─────────────────────────────── bug report ─────────────────────────────── */

export interface QaBugReport {
  id: string;
  title: string;
  summary: string;
  severity: QaSeverity;
  priority: QaPriority;
  agent: QaAgentCategory;
  taskId: string;
  stepsToReproduce: string[];
  failureClass: QaFailureClass;
  confidence: number;
  artifacts: QaArtifactRef[];
  timelinePhases: string[];
  knowledgeGraphRefs: string[];
  memoryRefs: string[];
  performance: Record<string, number>;
  suggestedFixes: string[];
  hypotheses: QaHypothesis[];
  createdAt: string;
}

/* ─────────────────────────────── session ─────────────────────────────── */

export interface QaSessionResult {
  sessionId: string;
  agent: QaAgentCategory;
  goalId: string;
  goalText: string;
  planned: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  bugs: QaBugReport[];
  learnings: number;
  metrics: Record<string, number>;
  outcome: 'pass' | 'fail' | 'error';
  summary: string;
  startedAt: string;
}

/* ─────────────────────────────── agent definition ─────────────────────────────── */

export interface QaCapability {
  id: string;
  description: string;
}

export interface QaAgentConstraints {
  /** Enterprise channels the agent may use (module/rest/sdk/cli/desktop/…). */
  allowedChannels: string[];
  /** RBAC permissions the agent's scenarios require (enforced by the executors, not the agent). */
  requiredPermissions: string[];
  /** May the agent run destructive (delete) tasks without explicit approval? */
  allowDestructive: boolean;
  maxTasks: number;
}

export interface QaAgentDefinition {
  id: string;
  category: QaAgentCategory;
  name: string;
  description: string;
  /** Default goal texts the agent knows how to pursue. */
  goals: string[];
  capabilities: QaCapability[];
  constraints: QaAgentConstraints;
}

export const QA_METRIC_KEYS = [
  'planningMs',
  'reasoningMs',
  'observationMs',
  'recoveryMs',
  'reportMs',
  'sessionMs',
  'tasksPlanned',
  'tasksExecuted',
  'tasksPassed',
  'tasksFailed',
  'tasksSkipped',
  'recoveries',
  'bugsFiled',
  'learningsStored',
  'llmCalls',
  'llmTokens',
  'rssBytes',
  'qaEfficiency',
] as const;

/* ─────────────────────────── pure helpers ─────────────────────────── */

const CATEGORY_SET: ReadonlySet<string> = new Set(QA_AGENT_CATEGORIES);
const PRIORITY_SET: ReadonlySet<string> = new Set(['p0', 'p1', 'p2', 'p3']);

/** Normalize a raw goal (NL string or structured object) into a {@link QaGoal}. Pure. */
export function parseQaGoal(input: unknown, fallbackAgent: QaAgentCategory = 'regression'): QaGoal {
  if (typeof input === 'string') {
    return { id: goalId(input), kind: 'natural', text: input, agent: inferAgent(input, fallbackAgent), targets: inferTargets(input), priority: 'p1', requireApproval: false, metadata: {} };
  }
  const o = (input ?? {}) as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text : '';
  const agent = CATEGORY_SET.has(o.agent as string) ? (o.agent as QaAgentCategory) : inferAgent(text, fallbackAgent);
  return {
    id: typeof o.id === 'string' && o.id ? o.id : goalId(text || agent),
    kind: 'structured',
    text,
    agent,
    targets: Array.isArray(o.targets) ? o.targets.filter((x): x is string => typeof x === 'string') : inferTargets(text),
    priority: PRIORITY_SET.has(o.priority as string) ? (o.priority as QaPriority) : 'p1',
    requireApproval: o.requireApproval === true,
    metadata: isRecord(o.metadata) ? o.metadata : {},
  };
}

/** Deterministically pick the agent that best matches a natural-language goal. Pure. */
export function inferAgent(text: string, fallback: QaAgentCategory = 'regression'): QaAgentCategory {
  const t = text.toLowerCase();
  const rules: [QaAgentCategory, string[]][] = [
    ['security', ['security', 'rbac', 'permission', 'auth', 'access control']],
    ['manufacturing', ['manufactur', 'production order', 'bom', 'work order', 'shop floor']],
    ['inventory', ['inventory', 'stock', 'warehouse', 'movement']],
    ['planning', ['planning', 'mrp', 'aps', 'capacity', 'schedule']],
    ['finance', ['finance', 'invoice', 'payment', 'billing']],
    ['crm', ['crm', 'customer', 'lead', 'contact']],
    ['connector', ['connector', 'sync', 'integration']],
    ['automation', ['automation', 'rule', 'trigger']],
    ['plugin', ['plugin', 'extension']],
    ['developer-portal', ['developer', 'sdk', 'cli', 'rest', 'api']],
    ['executive', ['executive', 'kpi', 'dashboard']],
    ['knowledge-graph', ['graph', 'relationship', 'node', 'edge']],
    ['timeline', ['timeline', 'event history', 'audit trail']],
    ['erp', ['erp', 'order to cash', 'procure to pay', 'end to end', 'procure', 'purchase order', 'supplier', 'goods receipt']],
    ['regression', ['regression', 'smoke', 'full suite']],
  ];
  for (const [agent, keys] of rules) {
    if (keys.some((k) => t.includes(k)) && CATEGORY_SET.has(agent)) return agent;
  }
  return fallback;
}

function inferTargets(text: string): string[] {
  const t = text.toLowerCase();
  const targets: string[] = [];
  const map: [string, string][] = [
    ['crm-customers', 'customer'], ['crm-leads', 'lead'], ['procurement-orders', 'purchase order'],
    ['inventory-products', 'product'], ['manufacturing-orders', 'production'], ['sales-orders', 'sales order'],
    ['finance', 'invoice'], ['finance-payments', 'payment'],
  ];
  for (const [mod, kw] of map) if (t.includes(kw)) targets.push(mod);
  return targets;
}

/** Topologically sort tasks by their `dependsOn` edges; cycle-safe (stable append). Pure. */
export function topoSortTasks(tasks: QaTask[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string, stack: Set<string>): void => {
    if (visited.has(id) || stack.has(id)) return;
    stack.add(id);
    const task = byId.get(id);
    for (const dep of task?.dependsOn ?? []) if (byId.has(dep)) visit(dep, stack);
    stack.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const t of tasks) visit(t.id, new Set());
  return order;
}

/** Deterministic severity from an observation + reflection. Pure. */
export function severityFor(outcome: QaRunOutcome, failureClass: QaFailureClass, priority: QaPriority): QaSeverity {
  if (outcome === 'pass' || failureClass === 'none') return 'info';
  if (failureClass === 'crash' || failureClass === 'regression') return priority === 'p0' ? 'critical' : 'high';
  if (failureClass === 'permission') return 'high';
  if (failureClass === 'assertion' || failureClass === 'data') return priority === 'p0' ? 'high' : 'medium';
  if (failureClass === 'flaky' || failureClass === 'environment') return 'low';
  return 'medium';
}

export function priorityFromSeverity(sev: QaSeverity): QaPriority {
  switch (sev) {
    case 'critical': return 'p0';
    case 'high': return 'p1';
    case 'medium': return 'p2';
    default: return 'p3';
  }
}

/** Whether a scenario spec contains destructive (delete) actions — pure structural check. */
export function isDestructiveSpec(spec: ScenarioSpec): boolean {
  const steps = (spec as { steps?: { action?: string }[] }).steps;
  if (!Array.isArray(steps)) return false;
  return steps.some((s) => typeof s.action === 'string' && /delete|remove|drop|purge/i.test(s.action));
}

function goalId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return `goal-${(h >>> 0).toString(36)}`;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
