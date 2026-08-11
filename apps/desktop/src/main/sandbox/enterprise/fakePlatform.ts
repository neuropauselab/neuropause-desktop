/**
 * AI Sandbox — Enterprise Scenario Runner (S3): in-memory platform (TEST DOUBLE).
 *
 * A deterministic {@link EnterprisePlatform} used to unit-test the action registry,
 * assertion engine, dataset system, reporting, recovery, and the executor end-to-end on
 * the REAL S1 engine — the same dependency-injection pattern the whole app uses for its
 * platform/OS/network boundaries. The PRODUCTION runner always wires
 * `createRealEnterprisePlatform` (real ERP/CRM/REST/SDK/CLI/…); this fake is injected
 * only by tests. It performs no I/O and uses no real clock. It models enough real
 * behavior — creating a record emits a timeline event, a graph node, and bumps a KPI —
 * to make assertions meaningful.
 */
import type { DesktopAction } from '@neuropause/shared';
import {
  DesktopSessionRegistry,
  type DesktopOwnerResolver,
  type OwnedDesktopSession,
} from './desktopSessionOwnership';
import {
  EnterpriseAuthorizationError,
  EnterprisePlatformError,
  type DesktopSessionHandle,
  type DesktopSessionRef,
  type EnterpriseDesktopChannel,
  type EnterprisePlatform,
  type PlatformActionResult,
  type PlatformAutomationMonitor,
  type PlatformAutomationResult,
  type PlatformCliResult,
  type PlatformConnectorResult,
  type PlatformConnectorState,
  type PlatformGraphNode,
  type PlatformKpi,
  type PlatformPlanningResult,
  type PlatformPluginResult,
  type PlatformRecord,
  type PlatformRestRequest,
  type PlatformRestResponse,
  type PlatformSdkCall,
  type PlatformSdkResult,
  type PlatformTimelineEntry,
} from './platform';

export interface FakePlatformScript {
  /** Registered module ids (defaults to a broad ERP/CRM set). */
  modules?: string[];
  /** Permissions the current actor holds (defaults to "all" — Owner). */
  permissions?: string[] | 'all';
  /** Denied permissions (overrides `all`). */
  deny?: string[];
  connectors?: string[];
  /** Active automation rule ids. */
  automationRules?: string[];
  plugins?: string[];
  webhooks?: string[];
  /** Entity refs a memory entry references. */
  memoryRefs?: string[];
  /** Planning summaries returned by `planning.run`. */
  planning?: { mrp?: Record<string, number>; aps?: Record<string, number> };
  /** Desktop elements available (selector → visible/text) for desktop-step assertions. */
  desktopElements?: { selector: string; visible?: boolean; text?: string }[];
  /** When set, the desktop channel `open` rejects (unavailable backend). */
  desktopUnavailable?: string;
  /**
   * WHO the desktop calls are made as. P13C Round 9 — F15.
   *
   * Defaults to one fixed tenant, so an ordinary test is a single organization
   * and nothing changes for it. An isolation test supplies a MUTABLE resolver —
   * the same way `sandboxTenancy.test.ts` drives the stores through a mutable
   * scope — because switching tenants against one live channel is the thing
   * under test; building a second channel per tenant would make every assertion
   * pass for the wrong reason.
   */
  desktopOwner?: DesktopOwnerResolver;
  /** Make the first N `create` calls for a module throw a recoverable error (retry tests). */
  failCreate?: { moduleId: string; times: number; message?: string };
}

const DEFAULT_MODULES = [
  'crm', 'crm-leads', 'crm-customers', 'procurement-suppliers', 'procurement-orders',
  'procurement-receipts', 'inventory-products', 'inventory-movements', 'manufacturing-orders',
  'manufacturing-schedules', 'sales-orders', 'finance', 'finance-payments',
];

interface FakeTimeline {
  entries: PlatformTimelineEntry[];
}

/**
 * The fake desktop channel — OWNER-KEYED, exactly like the real one.
 *
 * P13C ROUND 9 — F15. This class held `private open_ = false` and a `seq`: one
 * slot, the same defect as `createRealDesktopChannel`. That matters more than a
 * test double usually does, because the gates run headless and exercise THE FAKE
 * through the same port — a fake with a shared slot keeps every gate green while
 * production leaks, which is precisely how the finding survived.
 *
 * It therefore resolves ownership through the SAME
 * {@link DesktopSessionRegistry} the production channel uses, so a test that
 * proves the fake refuses a foreign session is proving the production rule
 * rather than a parallel one written to agree with it.
 */
interface FakeDesktopSession extends OwnedDesktopSession {
  shots: number;
  clicks: { selector: string; sessionId: string }[];
}

export class FakeDesktop implements EnterpriseDesktopChannel {
  private readonly registry: DesktopSessionRegistry<FakeDesktopSession>;
  constructor(private readonly script: FakePlatformScript) {
    /**
     * The default owner is ONE fixed tenant, so every pre-existing test keeps
     * running as a single organization and a test that wants to prove ISOLATION
     * has to introduce a second owner deliberately. Same asymmetry, and the same
     * reason, as `TEST_TENANT_SCOPE`: crossing a boundary should read as an
     * intrusion, not as ordinary setup.
     */
    this.registry = new DesktopSessionRegistry<FakeDesktopSession>(
      script.desktopOwner ?? (() => ({ tenantId: 'fake-tenant', workspaceId: 'fake-workspace' })),
    );
  }

  open(opts?: { profile?: string; sessionId?: string }): Promise<DesktopSessionHandle> {
    if (this.script.desktopUnavailable) {
      return Promise.reject(new EnterprisePlatformError(this.script.desktopUnavailable, 'desktop_unavailable'));
    }
    let claim: ReturnType<DesktopSessionRegistry<FakeDesktopSession>['claim']>;
    try {
      claim = this.registry.claim(opts?.sessionId, 'open');
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    if (claim.existing) return Promise.resolve({ sessionId: claim.existing.sessionId });
    this.registry.put({ sessionId: claim.sessionId, owner: claim.owner, shots: 0, clicks: [] });
    return Promise.resolve({ sessionId: claim.sessionId });
  }
  isOpen(ref?: DesktopSessionRef): boolean {
    return this.registry.peek(ref) !== null;
  }
  /** Test hook: what was driven into ONE session. Never install-wide. */
  clicksOn(ref?: DesktopSessionRef): { selector: string; sessionId: string }[] {
    return [...(this.registry.peek(ref)?.clicks ?? [])];
  }
  action(action: DesktopAction, ref?: DesktopSessionRef): Promise<{ assertion?: { ok: boolean; message: string } }> {
    let session: FakeDesktopSession;
    try {
      session = this.registry.require(ref, `desktop ${action.type}`);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const el = (this.script.desktopElements ?? []).find((e) => e.selector === action.selector);
    if (action.type === 'assertVisible' || action.type === 'assertExists') {
      const ok = !!el && el.visible !== false;
      return Promise.resolve({ assertion: { ok, message: ok ? `visible: ${action.selector}` : `expected "${action.selector}" visible` } });
    }
    if (action.type === 'assertText') {
      const ok = !!el && (el.text ?? '').includes(action.text ?? '');
      return Promise.resolve({ assertion: { ok, message: ok ? 'text matched' : `expected "${action.selector}" to contain "${action.text}"` } });
    }
    // interaction actions require the element to exist (drives recovery/error paths)
    if ((action.type === 'click' || action.type === 'type' || action.type === 'fill') && !el) {
      return Promise.reject(new EnterprisePlatformError(`selector "${action.selector}" not found`, 'desktop_automation'));
    }
    // Recorded on the SESSION, so a test can prove which window a click landed in.
    if (action.type === 'click') session.clicks.push({ selector: action.selector ?? '', sessionId: session.sessionId });
    return Promise.resolve({});
  }
  screenshot(name: string, ref?: DesktopSessionRef): Promise<{ storageRef: string | null; sizeBytes: number; bytes?: Buffer }> {
    let session: FakeDesktopSession;
    try {
      session = this.registry.require(ref, 'screenshot');
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    session.shots += 1;
    /**
     * The bytes NAME THE SESSION AND ITS OWNER.
     *
     * A screenshot that returned the same bytes whoever asked would make an
     * isolation test pass while the leak it exists to catch was still there —
     * `A !== B` is not a proof of anything. These are the fake's stand-in for
     * pixels of a particular tenant's window, so a test can assert that A's
     * capture is A's window rather than merely "not B's".
     */
    const bytes = Buffer.from(`fake-shot:${session.owner.tenantId}:${session.sessionId}:${name}:${session.shots}`);
    return Promise.resolve({ storageRef: null, sizeBytes: bytes.length, bytes });
  }
  close(ref?: DesktopSessionRef): Promise<void> {
    // Named close: refused when it is not this owner's. Unnamed: close mine, if any.
    if (ref?.sessionId) {
      let session: FakeDesktopSession;
      try {
        session = this.registry.require(ref, 'close');
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      this.registry.drop(session);
      return Promise.resolve();
    }
    const mine = this.registry.peek();
    if (mine) this.registry.drop(mine);
    return Promise.resolve();
  }
}

export class FakeEnterprisePlatform implements EnterprisePlatform {
  readonly kind = 'fake';
  readonly records = new Map<string, PlatformRecord>();
  private readonly tlLog: FakeTimeline = { entries: [] };
  private readonly nodes = new Map<string, PlatformGraphNode>();
  private readonly edges = new Map<string, Set<string>>();
  private kpis: PlatformKpi[] = [{ key: 'records', label: 'Records', value: 0, display: '0' }];
  private automationMonitor: PlatformAutomationMonitor = { completed: 0, failed: 0, running: 0 };
  private readonly connectorState = new Map<string, PlatformConnectorState>();
  private seq = 0;
  private failCreateCount = 0;
  /** Typed as the fake so isolation tests can ask which session a click landed in. */
  readonly desktop: FakeDesktop;
  private readonly moduleSet: ReadonlySet<string>;

  constructor(private readonly script: FakePlatformScript = {}, private readonly clock: () => number = Date.now) {
    this.moduleSet = new Set(script.modules ?? DEFAULT_MODULES);
    this.desktop = new FakeDesktop(script);
  }

  now(): number {
    return this.clock();
  }

  /* ── module CRUD + actions ── */
  module = {
    isRegistered: (moduleId: string): boolean => this.moduleSet.has(moduleId),
    create: (moduleId: string, fields: Record<string, unknown>, opts?: { title?: string; tags?: string[]; metadata?: Record<string, unknown> }): Promise<PlatformRecord> => {
      if (!this.moduleSet.has(moduleId)) throw new EnterprisePlatformError(`module "${moduleId}" is not registered`, 'module_not_found');
      if (this.script.failCreate && this.script.failCreate.moduleId === moduleId && this.failCreateCount < this.script.failCreate.times) {
        this.failCreateCount += 1;
        throw new Error(this.script.failCreate.message ?? `timeout creating ${moduleId}`);
      }
      this.seq += 1;
      const id = `rec_${this.seq}`;
      const record: PlatformRecord = {
        id,
        moduleId,
        title: opts?.title ?? String(fields.name ?? fields.title ?? id),
        status: typeof fields.status === 'string' ? fields.status : 'active',
        fields: { ...fields },
        updatedAt: new Date(this.clock()).toISOString(),
      };
      this.records.set(id, record);
      this.emitTimeline('enterprise.record.created', id);
      this.addNode(`erp:${id}`, moduleId, record.title ?? id);
      this.bumpKpi('records', 1);
      return Promise.resolve(clone(record));
    },
    update: (moduleId: string, id: string, patch: { fields?: Record<string, unknown>; title?: string }): Promise<PlatformRecord> => {
      const record = this.records.get(id);
      if (!record || record.moduleId !== moduleId) throw new EnterprisePlatformError(`record "${id}" not found`, 'record_not_found');
      record.fields = { ...record.fields, ...(patch.fields ?? {}) };
      if (patch.title) record.title = patch.title;
      if (typeof patch.fields?.status === 'string') record.status = patch.fields.status;
      record.updatedAt = new Date(this.clock()).toISOString();
      this.emitTimeline('enterprise.record.updated', id);
      return Promise.resolve(clone(record));
    },
    delete: (moduleId: string, id: string): Promise<boolean> => {
      const record = this.records.get(id);
      if (!record || record.moduleId !== moduleId) return Promise.resolve(false);
      record.status = 'deleted';
      record.updatedAt = new Date(this.clock()).toISOString();
      this.emitTimeline('enterprise.record.deleted', id);
      return Promise.resolve(true);
    },
    runAction: (moduleId: string, id: string, action: string): Promise<PlatformActionResult> => {
      const record = this.records.get(id);
      if (!record || record.moduleId !== moduleId) throw new EnterprisePlatformError(`record "${id}" not found`, 'record_not_found');
      const created: PlatformRecord[] = [];
      if (action === 'convert') {
        this.seq += 1;
        const cust: PlatformRecord = { id: `rec_${this.seq}`, moduleId: 'crm-customers', title: record.title, status: 'onboarding', fields: { sourceLead: id }, updatedAt: new Date(this.clock()).toISOString() };
        this.records.set(cust.id, cust);
        this.addNode(`erp:${cust.id}`, cust.moduleId, cust.title ?? cust.id);
        created.push(clone(cust));
        record.fields.convertedCustomer = cust.id;
      }
      record.status = ACTION_STATUS[action] ?? action;
      record.updatedAt = new Date(this.clock()).toISOString();
      this.emitTimeline('enterprise.record.action', id);
      return Promise.resolve({ ok: true, record: clone(record), created });
    },
    get: (moduleId: string, id: string): Promise<PlatformRecord | null> => {
      const record = this.records.get(id);
      return Promise.resolve(record && record.moduleId === moduleId ? clone(record) : null);
    },
    list: (moduleId: string): Promise<PlatformRecord[]> =>
      Promise.resolve([...this.records.values()].filter((r) => r.moduleId === moduleId).map(clone)),
  };

  /* ── REST (routes to the module ops, mirroring the real gateway) ── */
  rest(req: PlatformRestRequest): Promise<PlatformRestResponse> {
    const create = req.path.match(/^\/modules\/([^/]+)\/records$/);
    const actionM = req.path.match(/^\/modules\/([^/]+)\/records\/([^/]+)\/actions\/([^/]+)$/);
    const getM = req.path.match(/^\/modules\/([^/]+)\/records\/([^/]+)$/);
    try {
      if (req.method === 'POST' && create) {
        const fields = (isRecord(req.body) ? (req.body.fields as Record<string, unknown>) : {}) ?? {};
        return this.module.create(create[1], fields).then((record) => ({ status: 201, ok: true, data: record }));
      }
      if (req.method === 'POST' && actionM) {
        return this.module.runAction(actionM[1], actionM[2], actionM[3]).then((r) => ({ status: 200, ok: r.ok, data: r.record }));
      }
      if (req.method === 'GET' && getM) {
        return this.module.get(getM[1], getM[2]).then((record) => (record ? { status: 200, ok: true, data: record } : { status: 404, ok: false, error: 'not_found' }));
      }
      if (req.method === 'GET' && req.path === '/health') return Promise.resolve({ status: 200, ok: true, data: { status: 'ok' } });
    } catch (err) {
      return Promise.resolve({ status: 400, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return Promise.resolve({ status: 404, ok: false, error: `no route for ${req.method} ${req.path}` });
  }

  sdk(call: PlatformSdkCall): Promise<PlatformSdkResult> {
    const args = call.args ?? [];
    if (call.method === 'getModules') return Promise.resolve({ ok: true, data: [...this.moduleSet] });
    if (call.method === 'postModulesModuleIdRecords') {
      const [moduleId, body] = args as [string, { fields?: Record<string, unknown> }];
      return this.module.create(moduleId, body?.fields ?? {}).then((record) => ({ ok: true, data: record })).catch((e: unknown) => ({ ok: false, error: msg(e) }));
    }
    if (call.method === 'getHealth') return Promise.resolve({ ok: true, data: { status: 'ok' } });
    return Promise.resolve({ ok: false, error: `unknown sdk method "${call.method}"` });
  }

  cli(argv: string[]): Promise<PlatformCliResult> {
    if (argv[0] === 'modules') return Promise.resolve({ code: 0, stdout: [...this.moduleSet], stderr: [] });
    if (argv[0] === 'health') return Promise.resolve({ code: 0, stdout: ['ok'], stderr: [] });
    if (argv[0] === 'records' && argv[2] === 'list') {
      const list = [...this.records.values()].filter((r) => r.moduleId === argv[1]);
      return Promise.resolve({ code: 0, stdout: list.map((r) => r.id), stderr: [] });
    }
    return Promise.resolve({ code: 1, stdout: [], stderr: [`unknown command "${argv.join(' ')}"`] });
  }

  automation = {
    run: (ruleId: string): Promise<PlatformAutomationResult> => {
      const active = new Set(this.script.automationRules ?? []);
      if (!active.has(ruleId)) {
        this.automationMonitor.failed += 1;
        return Promise.resolve({ ok: false, ranId: null, actions: 0, error: `automation rule "${ruleId}" not active` });
      }
      this.automationMonitor.completed += 1;
      this.emitTimeline('automation.completed', ruleId);
      return Promise.resolve({ ok: true, ranId: ruleId, actions: 1 });
    },
    monitor: (): Promise<PlatformAutomationMonitor> => Promise.resolve({ ...this.automationMonitor }),
  };

  connectors = {
    sync: (connectorId: string): Promise<PlatformConnectorResult> => {
      const known = new Set(this.script.connectors ?? []);
      if (!known.has(connectorId)) return Promise.resolve({ ok: false, message: `connector "${connectorId}" not connected` });
      const prev = this.connectorState.get(connectorId);
      this.connectorState.set(connectorId, {
        status: 'success',
        lastSyncAt: new Date(this.clock()).toISOString(),
        entityCount: (prev?.entityCount ?? 0) + 1,
        consecutiveFailures: 0,
      });
      return Promise.resolve({ ok: true, message: 'synced' });
    },
    state: (connectorId: string): Promise<PlatformConnectorState | null> => Promise.resolve(this.connectorState.get(connectorId) ?? null),
  };

  timeline = {
    query: (entityRef: string): Promise<PlatformTimelineEntry[]> =>
      Promise.resolve(this.tlLog.entries.filter((e) => e.entityRefs.includes(entityRef) || e.resourceId === entityRef).map(clone)),
  };

  graph = {
    rebuild: (): Promise<void> => Promise.resolve(),
    getNode: (id: string): Promise<PlatformGraphNode | null> => Promise.resolve(this.nodes.get(id) ? clone(this.nodes.get(id)!) : null),
    neighbors: (id: string): Promise<PlatformGraphNode[]> => {
      const ns = this.edges.get(id) ?? new Set<string>();
      return Promise.resolve([...ns].map((n) => this.nodes.get(n)).filter((n): n is PlatformGraphNode => !!n).map(clone));
    },
  };

  memory = {
    references: (entityRef: string): Promise<boolean> => Promise.resolve(new Set(this.script.memoryRefs ?? []).has(entityRef)),
  };

  executive = {
    snapshotKpis: (): Promise<PlatformKpi[]> => Promise.resolve(this.kpis.map(clone)),
  };

  planning = {
    run: (kind: 'mrp' | 'aps'): Promise<PlatformPlanningResult> => {
      const summary = (kind === 'mrp' ? this.script.planning?.mrp : this.script.planning?.aps) ?? (kind === 'mrp' ? { shortages: 0, plannedOrders: 0 } : { bottlenecks: 0, scheduledOps: 0 });
      return Promise.resolve({ kind, ok: true, summary });
    },
  };

  plugin = {
    run: (pluginId: string, input?: Record<string, unknown>): Promise<PlatformPluginResult> => {
      if (!new Set(this.script.plugins ?? []).has(pluginId)) return Promise.resolve({ ok: false, error: `plugin "${pluginId}" not registered` });
      return Promise.resolve({ ok: true, output: { echoed: input ?? {} } });
    },
    isRegistered: (pluginId: string): Promise<boolean> => Promise.resolve(new Set(this.script.plugins ?? []).has(pluginId)),
  };

  webhook = {
    delivered: (ref: string): Promise<boolean> => Promise.resolve(new Set(this.script.webhooks ?? []).has(ref)),
  };

  security = {
    can: (permission: string): Promise<boolean> => {
      if (new Set(this.script.deny ?? []).has(permission)) return Promise.resolve(false);
      if (this.script.permissions === 'all' || this.script.permissions === undefined) return Promise.resolve(true);
      return Promise.resolve(new Set(this.script.permissions).has(permission));
    },
  };

  /** Test helper: assert an authorization failure by throwing the real error type. */
  denyOrThrow(permission: string): void {
    throw new EnterpriseAuthorizationError(`missing permission: ${permission}`);
  }

  private emitTimeline(kind: string, entityRef: string): void {
    this.seq += 1;
    this.tlLog.entries.push({
      id: `tl_${this.seq}`,
      kind,
      title: kind,
      at: new Date(this.clock()).toISOString(),
      entityRefs: [entityRef],
      resourceId: entityRef,
    });
  }
  private addNode(id: string, type: string, label: string): void {
    this.nodes.set(id, { id, type, label });
  }
  private bumpKpi(key: string, by: number): void {
    this.kpis = this.kpis.map((k) => (k.key === key ? { ...k, value: (k.value ?? 0) + by, display: String((k.value ?? 0) + by) } : k));
  }
}

const ACTION_STATUS: Record<string, string> = {
  approve: 'approved',
  send: 'sent',
  receiveGoods: 'received',
  post: 'posted',
  plan: 'planned',
  start: 'in_progress',
  complete: 'completed',
  cancel: 'cancelled',
  issue: 'issued',
  ship: 'shipped',
  fulfill: 'fulfilled',
  convertToInvoice: 'invoiced',
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
