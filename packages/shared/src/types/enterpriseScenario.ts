/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the scenario contract.
 *
 * An enterprise scenario's opaque S1 `spec` gets meaning here: a complete, real-world
 * enterprise workflow — `{ kind: 'enterprise', category, metadata, steps[], assertions[],
 * … }` — that the S3 executor runs across the live NeuroPause platform (ERP/CRM/
 * manufacturing/planning/automation/connectors) through the REST/SDK/CLI/desktop/module
 * channels. These types + the pure `parseEnterpriseScenario` are the shared, validated
 * shape the executor interprets and the SDK / portal author against. No runtime here —
 * just the contract + its validator (the S3 analog of S2's `parseDesktopSpec`).
 */
import type { ScenarioSpec } from './sandbox';

/* ─────────────────────────────── categories (Step 2) ─────────────────────────────── */

export type EnterpriseScenarioCategory =
  | 'crm'
  | 'erp'
  | 'manufacturing'
  | 'inventory'
  | 'planning'
  | 'scheduling'
  | 'procurement'
  | 'finance'
  | 'hr'
  | 'automation'
  | 'developer'
  | 'plugins'
  | 'connectors'
  | 'api'
  | 'sdk'
  | 'cli'
  | 'executive'
  | 'knowledge-graph'
  | 'timeline'
  | 'security'
  | 'performance';

export const ENTERPRISE_SCENARIO_CATEGORIES: readonly EnterpriseScenarioCategory[] = [
  'crm', 'erp', 'manufacturing', 'inventory', 'planning', 'scheduling', 'procurement',
  'finance', 'hr', 'automation', 'developer', 'plugins', 'connectors', 'api', 'sdk',
  'cli', 'executive', 'knowledge-graph', 'timeline', 'security', 'performance',
];

/* ─────────────────────────────── channels (Step 4) ─────────────────────────────── */

/** How a step reaches the platform. `auto` lets the runner choose from the action. */
export type EnterpriseChannel =
  | 'auto'
  | 'module'
  | 'rest'
  | 'sdk'
  | 'cli'
  | 'desktop'
  | 'automation'
  | 'plugin'
  | 'connector'
  | 'planning';

export const ENTERPRISE_CHANNELS: readonly EnterpriseChannel[] = [
  'auto', 'module', 'rest', 'sdk', 'cli', 'desktop', 'automation', 'plugin', 'connector', 'planning',
];

/* ─────────────────────────────── actions (Step 5) ─────────────────────────────── */

export type EnterpriseActionType =
  // CRM
  | 'createCustomer' | 'updateCustomer' | 'deleteCustomer'
  // Procurement + inventory
  | 'createSupplier' | 'createProduct' | 'createPurchaseOrder' | 'approvePurchaseOrder'
  | 'receiveGoods' | 'issueInventory'
  // Manufacturing
  | 'createProductionOrder' | 'scheduleProduction' | 'completeProduction'
  // Sales + finance
  | 'createSalesOrder' | 'createInvoice' | 'receivePayment'
  // Planning
  | 'runMrp' | 'runAps'
  // Automation + plugins
  | 'triggerAutomation' | 'runPlugin'
  // Developer channels
  | 'executeRestCall' | 'executeSdkCall' | 'executeCliCommand'
  // Desktop (reuses S2)
  | 'openDesktop' | 'clickUi' | 'typeUi' | 'takeScreenshot'
  // Reporting
  | 'exportReport'
  // Generic module + connector + control
  | 'moduleCreate' | 'moduleUpdate' | 'moduleDelete' | 'moduleAction' | 'syncConnector' | 'wait';

export const ENTERPRISE_ACTION_TYPES: readonly EnterpriseActionType[] = [
  'createCustomer', 'updateCustomer', 'deleteCustomer', 'createSupplier', 'createProduct',
  'createPurchaseOrder', 'approvePurchaseOrder', 'receiveGoods', 'issueInventory',
  'createProductionOrder', 'scheduleProduction', 'completeProduction', 'createSalesOrder',
  'createInvoice', 'receivePayment', 'runMrp', 'runAps', 'triggerAutomation', 'runPlugin',
  'executeRestCall', 'executeSdkCall', 'executeCliCommand', 'openDesktop', 'clickUi', 'typeUi',
  'takeScreenshot', 'exportReport', 'moduleCreate', 'moduleUpdate', 'moduleDelete',
  'moduleAction', 'syncConnector', 'wait',
];

/** Which channel a high-level action naturally runs on (used when `channel: 'auto'`). */
export const ACTION_DEFAULT_CHANNEL: Readonly<Record<EnterpriseActionType, EnterpriseChannel>> = {
  createCustomer: 'module', updateCustomer: 'module', deleteCustomer: 'module',
  createSupplier: 'module', createProduct: 'module', createPurchaseOrder: 'module',
  approvePurchaseOrder: 'module', receiveGoods: 'module', issueInventory: 'module',
  createProductionOrder: 'module', scheduleProduction: 'module', completeProduction: 'module',
  createSalesOrder: 'module', createInvoice: 'module', receivePayment: 'module',
  runMrp: 'planning', runAps: 'planning', triggerAutomation: 'automation', runPlugin: 'plugin',
  executeRestCall: 'rest', executeSdkCall: 'sdk', executeCliCommand: 'cli',
  openDesktop: 'desktop', clickUi: 'desktop', typeUi: 'desktop', takeScreenshot: 'desktop',
  exportReport: 'module', moduleCreate: 'module', moduleUpdate: 'module', moduleDelete: 'module',
  moduleAction: 'module', syncConnector: 'connector', wait: 'module',
};

/* ─────────────────────────────── assertions (Step 6) ─────────────────────────────── */

export type EnterpriseAssertionType =
  | 'recordExists'
  | 'recordUpdated'
  | 'timelineEventExists'
  | 'knowledgeGraphUpdated'
  | 'memoryUpdated'
  | 'automationExecuted'
  | 'connectorSynced'
  | 'executiveKpiChanged'
  | 'restResponse'
  | 'sdkResult'
  | 'cliResult'
  | 'desktopUi'
  | 'performanceThreshold'
  | 'securityPermission'
  | 'rbacValidation'
  | 'webhookDelivered'
  | 'pluginRegistered';

export const ENTERPRISE_ASSERTION_TYPES: readonly EnterpriseAssertionType[] = [
  'recordExists', 'recordUpdated', 'timelineEventExists', 'knowledgeGraphUpdated', 'memoryUpdated',
  'automationExecuted', 'connectorSynced', 'executiveKpiChanged', 'restResponse', 'sdkResult',
  'cliResult', 'desktopUi', 'performanceThreshold', 'securityPermission', 'rbacValidation',
  'webhookDelivered', 'pluginRegistered',
];

export type AssertionOperator =
  | 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'changed';

/** A single assertion — evaluated against REAL platform state (never a mock). */
export interface EnterpriseAssertion {
  type: EnterpriseAssertionType;
  /** Variable ref / record id / module id / kpi key / rule id / connector id / permission. */
  target?: string;
  moduleId?: string;
  field?: string;
  expected?: unknown;
  operator?: AssertionOperator;
  /** Permission string for securityPermission / rbacValidation. */
  permission?: string;
  /** Whether an RBAC check is expected to be allowed (rbacValidation / securityPermission). */
  allowed?: boolean;
  /** Latency ceiling (ms) for performanceThreshold. */
  maxMs?: number;
  message?: string;
}

/* ─────────────────────────────── steps (Steps 3 + 5) ─────────────────────────────── */

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs?: number;
  /** What to do once attempts are exhausted. */
  onExhausted?: 'skip' | 'abort';
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 1, backoffMs: 0, onExhausted: 'abort' };

export interface EnterpriseStep {
  id: string;
  name?: string;
  action: EnterpriseActionType;
  /** Channel override; defaults to the action's natural channel (or scenario default). */
  channel?: EnterpriseChannel;
  /** Action parameters: module fields, `{ moduleId, recordRef, action }`, REST `{ method, path, body }`,
   *  CLI `{ argv }`, a desktop action, etc. Opaque + variable-interpolated at run time. */
  input?: Record<string, unknown>;
  /** Capture the step's primary result (e.g. a created record id) into this variable. */
  saveAs?: string;
  /** Per-step assertions, evaluated right after the step. */
  assert?: EnterpriseAssertion[];
  /** Step ids that must succeed before this one runs. */
  dependsOn?: string[];
  retry?: RetryPolicy;
  /** A failure of an optional step is recorded + skipped, not fatal. */
  optional?: boolean;
  timeoutMs?: number;
}

/* ─────────────────────────────── scenario model (Step 3) ─────────────────────────────── */

export interface EnterprisePrecondition {
  type: 'permission' | 'moduleRegistered' | 'recordExists' | 'connectorConnected' | 'custom';
  target?: string;
  permission?: string;
  message?: string;
}

export type EnterpriseDatasetSource = 'inline' | 'csv' | 'json' | 'generated' | 'reference';

export interface EnterpriseDatasetRef {
  /** An existing S1 dataset to materialize from, when set. */
  datasetId?: string | null;
  source: EnterpriseDatasetSource;
  /** Inline rows (source `inline`). */
  rows?: Record<string, unknown>[];
  /** Raw text for `csv` / `json` sources. */
  raw?: string;
  /** Generation spec (source `generated`) — count + field templates + deterministic seed. */
  generate?: { count: number; template?: Record<string, unknown>; seed?: number };
  /** Parameters merged into every row (parameterized data). */
  parameters?: Record<string, unknown>;
  /** Existing records to reference (source `reference`): moduleId + a query. */
  reference?: { moduleId: string; query?: Record<string, unknown> };
  /** Required columns for dataset validation. */
  validate?: string[];
}

export interface EnterpriseExpectedResult {
  description: string;
  assertion?: EnterpriseAssertion;
}

export interface EnterpriseArtifactSpec {
  name: string;
  kind: 'screenshot' | 'log' | 'report' | 'result';
  /** Variable / step id the artifact derives from. */
  from?: string;
}

export interface ApprovalRequirement {
  required: boolean;
  approvers?: string[];
  /** Permission an approver must hold. */
  permission?: string;
}

export const DEFAULT_APPROVAL: ApprovalRequirement = { required: false };

export interface EnterpriseScenarioMetadata {
  title: string;
  description?: string;
  owner?: string;
  /** Author-supplied semantic version of the scenario content. */
  version?: string;
}

export interface EnterpriseScenarioSpec {
  kind: 'enterprise';
  category: EnterpriseScenarioCategory;
  metadata: EnterpriseScenarioMetadata;
  tags: string[];
  preconditions: EnterprisePrecondition[];
  variables: Record<string, unknown>;
  dataset: EnterpriseDatasetRef | null;
  steps: EnterpriseStep[];
  /** Scenario-level assertions, evaluated after all steps. */
  assertions: EnterpriseAssertion[];
  expected: EnterpriseExpectedResult[];
  artifacts: EnterpriseArtifactSpec[];
  /** Teardown steps, always attempted (best-effort) after the run. */
  cleanup: EnterpriseStep[];
  /** Metric keys to surface into the S1 result. */
  metrics: string[];
  /** Other scenario keys this one depends on (informational ordering hint). */
  dependsOn: string[];
  defaultChannel: EnterpriseChannel;
  retry: RetryPolicy;
  approval: ApprovalRequirement;
  timeoutMs: number;
}

export const DEFAULT_ENTERPRISE_TIMEOUT_MS = 120_000;

/** Metric keys the S3 executor exports into the run result (Step 11). */
export const ENTERPRISE_METRIC_KEYS = [
  'scenarioMs',
  'stepsRun',
  'stepsFailed',
  'stepsSkipped',
  'assertionsTotal',
  'assertionsPassed',
  'assertionsFailed',
  'restCalls',
  'restMsAvg',
  'sdkCalls',
  'cliCalls',
  'desktopActions',
  'automationRuns',
  'connectorSyncs',
  'stepMsAvg',
  'stepMsMax',
  'recoveries',
  'rssBytes',
] as const;

/* ─────────────────────────── pure parse / validate ─────────────────────────── */

export function isEnterpriseSpec(spec: ScenarioSpec | null | undefined): boolean {
  return !!spec && (spec as { kind?: unknown }).kind === 'enterprise';
}

export type ParseEnterpriseResult =
  | { ok: true; value: EnterpriseScenarioSpec }
  | { ok: false; error: string };

const ACTION_SET: ReadonlySet<string> = new Set(ENTERPRISE_ACTION_TYPES);
const ASSERTION_SET: ReadonlySet<string> = new Set(ENTERPRISE_ASSERTION_TYPES);
const CHANNEL_SET: ReadonlySet<string> = new Set(ENTERPRISE_CHANNELS);
const CATEGORY_SET: ReadonlySet<string> = new Set(ENTERPRISE_SCENARIO_CATEGORIES);

function parseAssertion(a: unknown, where: string): { ok: true; value: EnterpriseAssertion } | { ok: false; error: string } {
  const o = (a ?? {}) as Record<string, unknown>;
  const type = o.type as EnterpriseAssertionType;
  if (!ASSERTION_SET.has(type)) return { ok: false, error: `${where}: unknown assertion type "${String(o.type)}"` };
  const value: EnterpriseAssertion = { type };
  if (typeof o.target === 'string') value.target = o.target;
  if (typeof o.moduleId === 'string') value.moduleId = o.moduleId;
  if (typeof o.field === 'string') value.field = o.field;
  if ('expected' in o) value.expected = o.expected;
  if (typeof o.operator === 'string') value.operator = o.operator as AssertionOperator;
  if (typeof o.permission === 'string') value.permission = o.permission;
  if (typeof o.allowed === 'boolean') value.allowed = o.allowed;
  if (typeof o.maxMs === 'number') value.maxMs = o.maxMs;
  if (typeof o.message === 'string') value.message = o.message;
  return { ok: true, value };
}

function parseRetry(v: unknown, fallback: RetryPolicy): RetryPolicy {
  const o = (v ?? {}) as Record<string, unknown>;
  const maxAttempts = typeof o.maxAttempts === 'number' && o.maxAttempts >= 1 ? Math.floor(o.maxAttempts) : fallback.maxAttempts;
  const backoffMs = typeof o.backoffMs === 'number' && o.backoffMs >= 0 ? o.backoffMs : fallback.backoffMs;
  const onExhausted = o.onExhausted === 'skip' || o.onExhausted === 'abort' ? o.onExhausted : fallback.onExhausted;
  return { maxAttempts, backoffMs, onExhausted };
}

function parseStep(raw: unknown, i: number, defaultRetry: RetryPolicy): { ok: true; value: EnterpriseStep } | { ok: false; error: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const action = o.action as EnterpriseActionType;
  if (!ACTION_SET.has(action)) return { ok: false, error: `step[${i}]: unknown action "${String(o.action)}"` };
  if (o.channel !== undefined && !CHANNEL_SET.has(o.channel as string)) {
    return { ok: false, error: `step[${i}] (${action}): unknown channel "${String(o.channel)}"` };
  }
  const assertions: EnterpriseAssertion[] = [];
  if (Array.isArray(o.assert)) {
    for (let j = 0; j < o.assert.length; j += 1) {
      const r = parseAssertion(o.assert[j], `step[${i}].assert[${j}]`);
      if (!r.ok) return r;
      assertions.push(r.value);
    }
  }
  const value: EnterpriseStep = {
    id: typeof o.id === 'string' && o.id ? o.id : `step-${i + 1}`,
    action,
    input: isRecord(o.input) ? o.input : {},
    retry: parseRetry(o.retry, defaultRetry),
  };
  if (typeof o.name === 'string') value.name = o.name;
  if (CHANNEL_SET.has(o.channel as string)) value.channel = o.channel as EnterpriseChannel;
  if (typeof o.saveAs === 'string') value.saveAs = o.saveAs;
  if (assertions.length) value.assert = assertions;
  if (Array.isArray(o.dependsOn)) value.dependsOn = o.dependsOn.filter((x): x is string => typeof x === 'string');
  if (o.optional === true) value.optional = true;
  if (typeof o.timeoutMs === 'number') value.timeoutMs = o.timeoutMs;
  return { ok: true, value };
}

/** Validate + normalize an opaque scenario spec into a typed enterprise scenario. Pure. */
export function parseEnterpriseScenario(spec: ScenarioSpec): ParseEnterpriseResult {
  if (!isEnterpriseSpec(spec)) return { ok: false, error: 'scenario spec is not an enterprise scenario (kind !== "enterprise")' };
  const s = spec as Record<string, unknown>;

  const category = s.category as EnterpriseScenarioCategory;
  if (!CATEGORY_SET.has(category)) return { ok: false, error: `unknown category "${String(s.category)}"` };

  const rawMeta = (s.metadata ?? {}) as Record<string, unknown>;
  if (typeof rawMeta.title !== 'string' || !rawMeta.title.trim()) {
    return { ok: false, error: 'metadata.title is required' };
  }

  const rawSteps = s.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return { ok: false, error: 'enterprise scenario requires a non-empty steps array' };
  }

  const retry = parseRetry(s.retry, DEFAULT_RETRY_POLICY);

  const steps: EnterpriseStep[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rawSteps.length; i += 1) {
    const r = parseStep(rawSteps[i], i, retry);
    if (!r.ok) return r;
    if (seenIds.has(r.value.id)) return { ok: false, error: `step[${i}]: duplicate step id "${r.value.id}"` };
    seenIds.add(r.value.id);
    steps.push(r.value);
  }
  // dependency ids must resolve
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!seenIds.has(dep)) return { ok: false, error: `step "${step.id}": dependsOn unknown step "${dep}"` };
    }
  }

  const assertions: EnterpriseAssertion[] = [];
  if (Array.isArray(s.assertions)) {
    for (let i = 0; i < s.assertions.length; i += 1) {
      const r = parseAssertion(s.assertions[i], `assertions[${i}]`);
      if (!r.ok) return r;
      assertions.push(r.value);
    }
  }

  const cleanup: EnterpriseStep[] = [];
  if (Array.isArray(s.cleanup)) {
    for (let i = 0; i < s.cleanup.length; i += 1) {
      const r = parseStep(s.cleanup[i], i, retry);
      if (!r.ok) return { ok: false, error: r.error.replace('step[', 'cleanup[') };
      cleanup.push(r.value);
    }
  }

  const metadata: EnterpriseScenarioMetadata = { title: rawMeta.title.trim() };
  if (typeof rawMeta.description === 'string') metadata.description = rawMeta.description;
  if (typeof rawMeta.owner === 'string') metadata.owner = rawMeta.owner;
  if (typeof rawMeta.version === 'string') metadata.version = rawMeta.version;

  const value: EnterpriseScenarioSpec = {
    kind: 'enterprise',
    category,
    metadata,
    tags: Array.isArray(s.tags) ? s.tags.filter((x): x is string => typeof x === 'string') : [],
    preconditions: parsePreconditions(s.preconditions),
    variables: isRecord(s.variables) ? s.variables : {},
    dataset: parseDataset(s.dataset),
    steps,
    assertions,
    expected: parseExpected(s.expected),
    artifacts: parseArtifacts(s.artifacts),
    cleanup,
    metrics: Array.isArray(s.metrics) ? s.metrics.filter((x): x is string => typeof x === 'string') : [],
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter((x): x is string => typeof x === 'string') : [],
    defaultChannel: CHANNEL_SET.has(s.defaultChannel as string) ? (s.defaultChannel as EnterpriseChannel) : 'auto',
    retry,
    approval: parseApproval(s.approval),
    timeoutMs: typeof s.timeoutMs === 'number' && s.timeoutMs > 0 ? s.timeoutMs : DEFAULT_ENTERPRISE_TIMEOUT_MS,
  };
  return { ok: true, value };
}

/** Resolve the effective channel for a step. Pure. */
export function resolveStepChannel(step: EnterpriseStep, scenarioDefault: EnterpriseChannel): EnterpriseChannel {
  if (step.channel && step.channel !== 'auto') return step.channel;
  if (scenarioDefault && scenarioDefault !== 'auto') return scenarioDefault;
  return ACTION_DEFAULT_CHANNEL[step.action] ?? 'module';
}

function parsePreconditions(v: unknown): EnterprisePrecondition[] {
  if (!Array.isArray(v)) return [];
  const out: EnterprisePrecondition[] = [];
  for (const raw of v) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const type = o.type as EnterprisePrecondition['type'];
    if (!['permission', 'moduleRegistered', 'recordExists', 'connectorConnected', 'custom'].includes(type)) continue;
    const pc: EnterprisePrecondition = { type };
    if (typeof o.target === 'string') pc.target = o.target;
    if (typeof o.permission === 'string') pc.permission = o.permission;
    if (typeof o.message === 'string') pc.message = o.message;
    out.push(pc);
  }
  return out;
}

function parseDataset(v: unknown): EnterpriseDatasetRef | null {
  if (!isRecord(v)) return null;
  const source = v.source as EnterpriseDatasetSource;
  if (!['inline', 'csv', 'json', 'generated', 'reference'].includes(source)) return null;
  const ref: EnterpriseDatasetRef = { source };
  if (typeof v.datasetId === 'string') ref.datasetId = v.datasetId;
  if (Array.isArray(v.rows)) ref.rows = v.rows.filter(isRecord);
  if (typeof v.raw === 'string') ref.raw = v.raw;
  if (isRecord(v.generate) && typeof v.generate.count === 'number') {
    ref.generate = {
      count: Math.max(0, Math.floor(v.generate.count)),
      template: isRecord(v.generate.template) ? v.generate.template : undefined,
      seed: typeof v.generate.seed === 'number' ? v.generate.seed : undefined,
    };
  }
  if (isRecord(v.parameters)) ref.parameters = v.parameters;
  if (isRecord(v.reference) && typeof v.reference.moduleId === 'string') {
    ref.reference = { moduleId: v.reference.moduleId, query: isRecord(v.reference.query) ? v.reference.query : undefined };
  }
  if (Array.isArray(v.validate)) ref.validate = v.validate.filter((x): x is string => typeof x === 'string');
  return ref;
}

function parseExpected(v: unknown): EnterpriseExpectedResult[] {
  if (!Array.isArray(v)) return [];
  const out: EnterpriseExpectedResult[] = [];
  for (const raw of v) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o.description !== 'string') continue;
    const er: EnterpriseExpectedResult = { description: o.description };
    const a = parseAssertion(o.assertion, 'expected');
    if (a.ok) er.assertion = a.value;
    out.push(er);
  }
  return out;
}

function parseArtifacts(v: unknown): EnterpriseArtifactSpec[] {
  if (!Array.isArray(v)) return [];
  const out: EnterpriseArtifactSpec[] = [];
  for (const raw of v) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o.name !== 'string') continue;
    const kind = o.kind as EnterpriseArtifactSpec['kind'];
    if (!['screenshot', 'log', 'report', 'result'].includes(kind)) continue;
    const spec: EnterpriseArtifactSpec = { name: o.name, kind };
    if (typeof o.from === 'string') spec.from = o.from;
    out.push(spec);
  }
  return out;
}

function parseApproval(v: unknown): ApprovalRequirement {
  if (!isRecord(v)) return { ...DEFAULT_APPROVAL };
  const approval: ApprovalRequirement = { required: v.required === true };
  if (Array.isArray(v.approvers)) approval.approvers = v.approvers.filter((x): x is string => typeof x === 'string');
  if (typeof v.permission === 'string') approval.permission = v.permission;
  return approval;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
