/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the platform port.
 *
 * The single boundary between the Scenario Runner and the live NeuroPause platform.
 * Everything in S3 (action registry, assertion engine, executor, datasets, reporting)
 * is built against this interface and unit-tested with an in-memory platform; the
 * PRODUCTION adapter (`createRealEnterprisePlatform`) implements it against the REAL
 * in-process subsystems — the live `EnterpriseModuleRegistry` via `runSecureHandler`,
 * the REST gateway, an SDK client on an in-process transport, the CLI's `runCommand`,
 * the automation runner, timeline, knowledge graph, executive snapshot, connector
 * service, and the planning engines. Same injected-boundary pattern as the S1 engine
 * and the S2 desktop driver. NOTHING here is a mock: the production default calls the
 * real platform; the fake exists only for tests.
 */
import type { DesktopAction } from '@neuropause/shared';

/** A platform record (module entity) as the runner sees it — the fields it needs. */
export interface PlatformRecord {
  id: string;
  moduleId: string;
  title?: string;
  status?: string;
  fields: Record<string, unknown>;
  updatedAt?: string;
}

export interface PlatformActionResult {
  ok: boolean;
  record: PlatformRecord | null;
  message?: string;
  /** Records created as a side effect (e.g. a conversion), by module id. */
  created?: PlatformRecord[];
}

export interface PlatformRestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
}
export interface PlatformRestResponse {
  status: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface PlatformSdkCall {
  /** The SDK enterprise resource method, e.g. `getModules` / `postModulesModuleIdRecords`. */
  method: string;
  args?: unknown[];
}
export interface PlatformSdkResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface PlatformCliResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

export interface PlatformAutomationResult {
  ok: boolean;
  ranId: string | null;
  actions: number;
  error?: string;
}
export interface PlatformAutomationMonitor {
  completed: number;
  failed: number;
  running: number;
}

export interface PlatformConnectorResult {
  ok: boolean;
  message: string;
}
export interface PlatformConnectorState {
  status: string;
  lastSyncAt: string | null;
  entityCount: number;
  consecutiveFailures: number;
}

export interface PlatformTimelineEntry {
  id: string;
  kind: string;
  title: string;
  at: string;
  entityRefs: string[];
  resourceId: string | null;
}

export interface PlatformGraphNode {
  id: string;
  type: string;
  label: string;
}

export interface PlatformKpi {
  key: string;
  label: string;
  value: number | null;
  display: string;
}

export interface PlatformPlanningResult {
  kind: 'mrp' | 'aps';
  ok: boolean;
  /** Headline numbers (e.g. shortages, planned orders, bottlenecks) for assertions. */
  summary: Record<string, number>;
}

export interface PlatformPluginResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

/** Desktop channel — reuses the S2 session manager + action interpreter. */
export interface EnterpriseDesktopChannel {
  open(opts?: { profile?: string }): Promise<void>;
  action(action: DesktopAction): Promise<{ assertion?: { ok: boolean; message: string } }>;
  screenshot(name: string): Promise<{ storageRef: string | null; sizeBytes: number; bytes?: Buffer }>;
  isOpen(): boolean;
  close(): Promise<void>;
}

/**
 * The capabilities the Scenario Runner needs from the real platform. The production
 * adapter wires each to a real in-process subsystem; the fake implements them in memory.
 */
export interface EnterprisePlatform {
  /** `real` in production, `fake` in tests. */
  readonly kind: string;

  module: {
    create(moduleId: string, fields: Record<string, unknown>, opts?: { title?: string; tags?: string[]; metadata?: Record<string, unknown> }): Promise<PlatformRecord>;
    update(moduleId: string, id: string, patch: { fields?: Record<string, unknown>; title?: string }): Promise<PlatformRecord>;
    delete(moduleId: string, id: string): Promise<boolean>;
    runAction(moduleId: string, id: string, action: string): Promise<PlatformActionResult>;
    get(moduleId: string, id: string): Promise<PlatformRecord | null>;
    list(moduleId: string, query?: Record<string, unknown>): Promise<PlatformRecord[]>;
    isRegistered(moduleId: string): boolean;
  };

  rest(req: PlatformRestRequest): Promise<PlatformRestResponse>;
  sdk(call: PlatformSdkCall): Promise<PlatformSdkResult>;
  cli(argv: string[]): Promise<PlatformCliResult>;

  automation: {
    run(ruleId: string, payload?: Record<string, unknown>): Promise<PlatformAutomationResult>;
    monitor(): Promise<PlatformAutomationMonitor>;
  };

  connectors: {
    sync(connectorId: string, accountId?: string | null): Promise<PlatformConnectorResult>;
    state(connectorId: string, accountId?: string | null): Promise<PlatformConnectorState | null>;
  };

  timeline: {
    query(entityRef: string): Promise<PlatformTimelineEntry[]>;
  };

  graph: {
    rebuild(): Promise<void>;
    getNode(id: string): Promise<PlatformGraphNode | null>;
    neighbors(id: string): Promise<PlatformGraphNode[]>;
  };

  memory: {
    /** Whether a memory entry references the given entity (for memoryUpdated assertions). */
    references(entityRef: string): Promise<boolean>;
  };

  executive: {
    snapshotKpis(): Promise<PlatformKpi[]>;
  };

  planning: {
    run(kind: 'mrp' | 'aps'): Promise<PlatformPlanningResult>;
  };

  plugin: {
    run(pluginId: string, input?: Record<string, unknown>): Promise<PlatformPluginResult>;
    isRegistered(pluginId: string): Promise<boolean>;
  };

  webhook: {
    delivered(ref: string): Promise<boolean>;
  };

  security: {
    /** Whether the current actor holds a permission (RBAC, real gate). */
    can(permission: string): Promise<boolean>;
  };

  desktop: EnterpriseDesktopChannel;

  now(): number;
}

/** Thrown when the platform cannot perform an operation (e.g. module not registered). */
export class EnterprisePlatformError extends Error {
  constructor(message: string, readonly code: string = 'platform_error') {
    super(message);
    this.name = 'EnterprisePlatformError';
  }
}

/** Thrown by the real platform's security gate when an actor lacks a permission. */
export class EnterpriseAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnterpriseAuthorizationError';
  }
}
