/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the enterprise action registry.
 *
 * Every reusable enterprise action (Step 5) maps to a REAL platform call through the
 * {@link EnterprisePlatform} port — create/approve/receive/produce/invoice/pay across
 * ERP+CRM, run MRP/APS, trigger automations + plugins, and drive the REST/SDK/CLI/
 * desktop channels. No action fabricates data: each returns the real record/response.
 * The map is the single place that knows which module key + action id each high-level
 * verb targets, so the executor stays channel-agnostic.
 */
import type { DesktopAction, LogLevel } from '@neuropause/shared';
import type { EnterpriseActionType } from '@neuropause/shared';
import type { EnterprisePlatform, PlatformRecord } from './platform';
import type { EnterprisePerfCollector } from './metrics';
import type { VariableScope } from './vars';

export interface ArtifactInput {
  kind: 'screenshot' | 'video' | 'log' | 'report' | 'result';
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageRef?: string | null;
  inline?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ActionContext {
  platform: EnterprisePlatform;
  vars: VariableScope;
  perf: EnterprisePerfCollector;
  emitLog: (message: string, level?: LogLevel) => void;
  emitStep: (name: string) => void;
  attachArtifact: (input: ArtifactInput) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Record a created entity for cleanup / rollback. */
  track: (moduleId: string, id: string) => void;
}

export interface ActionOutcome {
  /** Captured by the step's `saveAs`. */
  value?: unknown;
  recordId?: string;
  moduleId?: string;
  record?: PlatformRecord | null;
  raw?: unknown;
}

export type ActionHandler = (input: Record<string, unknown>, ctx: ActionContext) => Promise<ActionOutcome>;

/* ── module-key vocabulary (the single source of truth mirrored from the live registry) ── */
const MODULE = {
  customers: 'crm-customers',
  leads: 'crm-leads',
  contacts: 'crm',
  suppliers: 'procurement-suppliers',
  purchaseOrders: 'procurement-orders',
  products: 'inventory-products',
  movements: 'inventory-movements',
  productionOrders: 'manufacturing-orders',
  salesOrders: 'sales-orders',
  invoices: 'finance',
  payments: 'finance-payments',
} as const;

async function create(ctx: ActionContext, moduleId: string, input: Record<string, unknown>): Promise<ActionOutcome> {
  const rec = await ctx.platform.module.create(moduleId, fieldsOf(input), titleOpts(input));
  ctx.track(rec.moduleId, rec.id);
  ctx.emitLog(`created ${moduleId} ${rec.id}`);
  return { value: rec.id, recordId: rec.id, moduleId: rec.moduleId, record: rec };
}

async function runAction(ctx: ActionContext, moduleId: string, input: Record<string, unknown>, action: string): Promise<ActionOutcome> {
  const id = str(input.id ?? input.recordRef ?? input.record);
  const res = await ctx.platform.module.runAction(moduleId, id, action);
  for (const c of res.created ?? []) ctx.track(c.moduleId, c.id);
  ctx.emitLog(`ran ${moduleId}.${action} on ${id} → ${res.record?.status ?? '?'}`);
  return { value: id, recordId: id, moduleId, record: res.record, raw: res };
}

export const ENTERPRISE_ACTIONS: Record<Exclude<EnterpriseActionType, 'exportReport'>, ActionHandler> = {
  /* CRM */
  createCustomer: (i, c) => create(c, MODULE.customers, i),
  updateCustomer: async (i, c) => {
    const id = str(i.id ?? i.recordRef);
    const rec = await c.platform.module.update(MODULE.customers, id, { fields: fieldsOf(i) });
    return { value: rec.id, recordId: rec.id, moduleId: rec.moduleId, record: rec };
  },
  deleteCustomer: async (i, c) => {
    const id = str(i.id ?? i.recordRef);
    const ok = await c.platform.module.delete(MODULE.customers, id);
    return { value: ok, recordId: id, moduleId: MODULE.customers };
  },

  /* Procurement + inventory */
  createSupplier: (i, c) => create(c, MODULE.suppliers, i),
  createProduct: (i, c) => create(c, MODULE.products, i),
  createPurchaseOrder: (i, c) => create(c, MODULE.purchaseOrders, i),
  approvePurchaseOrder: (i, c) => runAction(c, MODULE.purchaseOrders, i, 'approve'),
  receiveGoods: (i, c) => runAction(c, MODULE.purchaseOrders, i, 'receiveGoods'),
  issueInventory: (i, c) => create(c, MODULE.movements, { type: 'issue', ...fieldsOf(i) }),

  /* Manufacturing */
  createProductionOrder: (i, c) => create(c, MODULE.productionOrders, i),
  scheduleProduction: (i, c) => runAction(c, MODULE.productionOrders, i, str(i.action) || 'plan'),
  completeProduction: (i, c) => runAction(c, MODULE.productionOrders, i, 'complete'),

  /* Sales + finance */
  createSalesOrder: (i, c) => create(c, MODULE.salesOrders, i),
  createInvoice: (i, c) => create(c, MODULE.invoices, i),
  receivePayment: (i, c) => create(c, MODULE.payments, i),

  /* Planning */
  runMrp: async (_i, c) => {
    const r = await c.platform.planning.run('mrp');
    c.emitLog(`MRP: ${JSON.stringify(r.summary)}`);
    return { value: r.summary, raw: r };
  },
  runAps: async (_i, c) => {
    const r = await c.platform.planning.run('aps');
    c.emitLog(`APS: ${JSON.stringify(r.summary)}`);
    return { value: r.summary, raw: r };
  },

  /* Automation + plugins */
  triggerAutomation: async (i, c) => {
    c.perf.automationRuns += 1;
    const r = await c.platform.automation.run(str(i.ruleId ?? i.id), record(i.payload));
    c.emitLog(`automation ${str(i.ruleId ?? i.id)} → ${r.ok ? 'ok' : r.error ?? 'failed'}`);
    return { value: { ok: r.ok, ranId: r.ranId, actions: r.actions }, raw: r };
  },
  runPlugin: async (i, c) => {
    const r = await c.platform.plugin.run(str(i.pluginId ?? i.id), record(i.input));
    return { value: { ok: r.ok, output: r.output }, raw: r };
  },

  /* Developer channels */
  executeRestCall: async (i, c) => {
    const t0 = c.now();
    const res = await c.platform.rest({
      method: (str(i.method) || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: str(i.path),
      body: i.body,
      query: record(i.query) as Record<string, string | number | boolean> | undefined,
    });
    c.perf.rest(c.now() - t0);
    c.emitLog(`REST ${str(i.method) || 'GET'} ${str(i.path)} → ${res.status}`);
    return { value: res, raw: res };
  },
  executeSdkCall: async (i, c) => {
    c.perf.sdkCalls += 1;
    const res = await c.platform.sdk({ method: str(i.method), args: Array.isArray(i.args) ? i.args : [] });
    return { value: res, raw: res };
  },
  executeCliCommand: async (i, c) => {
    c.perf.cliCalls += 1;
    const argv = Array.isArray(i.argv) ? i.argv.map(String) : str(i.command).split(' ').filter(Boolean);
    const res = await c.platform.cli(argv);
    c.emitLog(`CLI ${argv.join(' ')} → exit ${res.code}`);
    return { value: { code: res.code, stdout: res.stdout }, raw: res };
  },

  /**
   * Desktop (reuses S2).
   *
   * P13C Round 9 — F15. A step MAY name a `sessionId`, so a scenario that opens
   * two windows can say which one it means. It may NOT name an owner: the
   * channel resolves that from the tenant resolver, and a named id only ever
   * selects among the caller's own sessions. `openDesktop` returns the id so a
   * later step can reference it through `saveAs`.
   */
  openDesktop: async (i, c) => {
    const handle = await c.platform.desktop.open({ profile: str(i.profile) || 'temporary', ...sessionRef(i) });
    c.emitLog(`desktop session opened (${handle.sessionId})`);
    return { value: { sessionId: handle.sessionId } };
  },
  clickUi: async (i, c) => {
    c.perf.desktopActions += 1;
    const r = await c.platform.desktop.action({ type: 'click', selector: str(i.selector) }, sessionRef(i));
    return { value: r.assertion, raw: r };
  },
  typeUi: async (i, c) => {
    c.perf.desktopActions += 1;
    const r = await c.platform.desktop.action({ type: 'type', selector: str(i.selector), text: str(i.text) } as DesktopAction, sessionRef(i));
    return { value: r.assertion, raw: r };
  },
  takeScreenshot: async (i, c) => {
    c.perf.desktopActions += 1;
    const name = str(i.name) || 'screenshot';
    const shot = await c.platform.desktop.screenshot(name, sessionRef(i));
    c.attachArtifact({
      kind: 'screenshot',
      name: `${name}.png`,
      mimeType: 'image/png',
      sizeBytes: shot.sizeBytes,
      storageRef: shot.storageRef ?? null,
      inline: shot.storageRef ? null : shot.bytes ? shot.bytes.toString('base64') : null,
    });
    return { value: { storageRef: shot.storageRef, sizeBytes: shot.sizeBytes } };
  },

  /* Generic module + connector + control */
  moduleCreate: (i, c) => create(c, str(i.moduleId), i),
  moduleUpdate: async (i, c) => {
    const rec = await c.platform.module.update(str(i.moduleId), str(i.id ?? i.recordRef), { fields: fieldsOf(i) });
    return { value: rec.id, recordId: rec.id, moduleId: rec.moduleId, record: rec };
  },
  moduleDelete: async (i, c) => {
    const ok = await c.platform.module.delete(str(i.moduleId), str(i.id ?? i.recordRef));
    return { value: ok };
  },
  moduleAction: (i, c) => runAction(c, str(i.moduleId), i, str(i.action)),
  syncConnector: async (i, c) => {
    c.perf.connectorSyncs += 1;
    const r = await c.platform.connectors.sync(str(i.connectorId ?? i.id), i.accountId != null ? str(i.accountId) : null);
    c.emitLog(`connector ${str(i.connectorId ?? i.id)} sync → ${r.ok ? 'ok' : r.message}`);
    return { value: { ok: r.ok, message: r.message }, raw: r };
  },
  wait: async (i, c) => {
    await c.sleep(num(i.durationMs) ?? 0);
    return {};
  },
};

/* ── helpers ── */
const CONTROL_KEYS = new Set(['id', 'recordRef', 'record', 'moduleId', 'action', 'title', 'tags', 'fields']);

/**
 * The session a desktop step names, if it names one.
 *
 * Returns `undefined` rather than `{ sessionId: '' }` for an absent value, so
 * "no session named" stays distinct from "named the empty string" — the channel
 * treats the first as "my current session" and the second as a name it does not
 * have, and collapsing them would turn a typo into somebody else's window.
 */
function sessionRef(input: Record<string, unknown>): { sessionId: string } | undefined {
  return typeof input.sessionId === 'string' && input.sessionId !== '' ? { sessionId: input.sessionId } : undefined;
}

/** Extract module fields: explicit `input.fields`, else the input minus control keys. */
function fieldsOf(input: Record<string, unknown>): Record<string, unknown> {
  if (input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)) return input.fields as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (!CONTROL_KEYS.has(k)) out[k] = v;
  return out;
}
function titleOpts(input: Record<string, unknown>): { title?: string; tags?: string[] } {
  const opts: { title?: string; tags?: string[] } = {};
  if (typeof input.title === 'string') opts.title = input.title;
  if (Array.isArray(input.tags)) opts.tags = input.tags.filter((x): x is string => typeof x === 'string');
  return opts;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
