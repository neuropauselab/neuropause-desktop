/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the PRODUCTION platform adapter.
 *
 * Maps the {@link EnterprisePlatform} port onto the REAL in-process subsystems. It is a
 * thin mapper over closures the composition root (runtimeCore) builds from the live
 * singletons — module CRUD/actions go through the SAME secure core the IPC bridge + REST
 * gateway use (`runSecureHandler` over the real `EnterpriseModuleRegistry`), so the runner
 * is a client of the gated core and can NEVER bypass RBAC. Nothing here is a mock: every
 * call reaches real ERP/CRM/automation/timeline/graph/executive/connector/planning state.
 */
import { IpcChannel } from '@neuropause/shared';
import type {
  EnterpriseDesktopChannel,
  EnterprisePlatform,
  PlatformCliResult,
  PlatformConnectorResult,
  PlatformConnectorState,
  PlatformGraphNode,
  PlatformKpi,
  PlatformPlanningResult,
  PlatformPluginResult,
  PlatformRecord,
  PlatformTimelineEntry,
} from './platform';

/** Real capabilities, injected as closures from runtimeCore (where the singletons live). */
export interface RealPlatformDeps {
  /** `runSecureHandler(handlerByChannel.get(channel), payload, secureBridgeDeps)`. */
  dispatch: (channel: string, payload: unknown) => Promise<unknown>;
  /** `handleEnterpriseApiRequest` mapped to a plain envelope (gateway + secure core). */
  restRaw: (req: { method: string; path: string; body?: unknown; query?: Record<string, string | number | boolean>; apiKey?: string | null }) => Promise<{ status: number; ok: boolean; data?: unknown; error?: string }>;
  /** The real `NeuroPauseClient.enterprise` resource (SDK on an in-process transport). */
  sdkEnterprise: Record<string, (...args: unknown[]) => Promise<unknown>>;
  /** `runCommand(argv, { client, out, err })`. */
  cli: (argv: string[]) => Promise<PlatformCliResult>;
  automationRun: (ruleId: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; ranId: string | null; actions: number }>;
  automationMonitor: () => { completed: number; failed: number; running: number };
  timelineQuery: (entityRef: string) => PlatformTimelineEntry[];
  graphGetNode: (id: string) => PlatformGraphNode | null;
  graphNeighbors: (id: string) => PlatformGraphNode[];
  graphRebuild: () => Promise<void>;
  memoryReferences: (ref: string) => boolean;
  executiveKpis: () => PlatformKpi[];
  connectorSync: (id: string, accountId: string | null) => Promise<PlatformConnectorResult>;
  connectorState: (id: string) => PlatformConnectorState | null;
  planningRun: (kind: 'mrp' | 'aps') => PlatformPlanningResult;
  pluginRun: (id: string, input: Record<string, unknown>) => Promise<PlatformPluginResult>;
  pluginRegistered: (id: string) => boolean;
  webhookDelivered: (ref: string) => boolean;
  moduleRegistered: (id: string) => boolean;
  /** RBAC gate: true iff the signed-in actor holds the permission. */
  can: (permission: string) => boolean;
  desktop: EnterpriseDesktopChannel;
  now: () => number;
}

interface RawEntity {
  id?: string;
  title?: string;
  status?: string;
  fields?: Record<string, unknown>;
  updatedAt?: string;
}

export function createRealEnterprisePlatform(deps: RealPlatformDeps): EnterprisePlatform {
  const toRecord = (raw: unknown, moduleId: string): PlatformRecord => {
    const e = (raw ?? {}) as RawEntity;
    const rec: PlatformRecord = { id: e.id ?? '', moduleId, fields: e.fields ?? {} };
    if (e.title !== undefined) rec.title = e.title;
    if (e.status !== undefined) rec.status = e.status;
    if (e.updatedAt !== undefined) rec.updatedAt = e.updatedAt;
    return rec;
  };
  const unwrap = (res: unknown, moduleId: string): PlatformRecord => {
    const r = (res ?? {}) as { record?: unknown };
    return toRecord(r.record ?? res, moduleId);
  };

  return {
    kind: 'real',

    module: {
      isRegistered: deps.moduleRegistered,
      create: async (moduleId, fields, opts) => {
        const res = await deps.dispatch(IpcChannel.EnterpriseModuleCreate, { moduleId, fields, title: opts?.title, tags: opts?.tags, metadata: opts?.metadata });
        return unwrap(res, moduleId);
      },
      update: async (moduleId, id, patch) => {
        const res = await deps.dispatch(IpcChannel.EnterpriseModuleUpdate, { moduleId, id, fields: patch.fields, title: patch.title });
        return unwrap(res, moduleId);
      },
      delete: async (moduleId, id) => {
        await deps.dispatch(IpcChannel.EnterpriseModuleDelete, { moduleId, id });
        return true;
      },
      runAction: async (moduleId, id, action) => {
        const res = await deps.dispatch(IpcChannel.EnterpriseModuleAction, { moduleId, id, action });
        const fetched = await deps.dispatch(IpcChannel.EnterpriseModuleGet, { moduleId, id }).catch(() => null);
        return { ok: true, record: fetched ? toRecord(fetched, moduleId) : unwrap(res, moduleId), created: [] };
      },
      get: async (moduleId, id) => {
        const res = await deps.dispatch(IpcChannel.EnterpriseModuleGet, { moduleId, id }).catch(() => null);
        if (!res) return null;
        const rec = toRecord(res, moduleId);
        return rec.id ? rec : null;
      },
      list: async (moduleId, query) => {
        const res = await deps.dispatch(IpcChannel.EnterpriseModuleList, { moduleId, ...(query ?? {}) }).catch(() => []);
        const items = Array.isArray(res) ? res : ((res as { items?: unknown[] })?.items ?? []);
        return items.map((x) => toRecord(x, moduleId));
      },
    },

    rest: async (req) => {
      const res = await deps.restRaw({ method: req.method, path: req.path, body: req.body, query: req.query });
      const out: { status: number; ok: boolean; data?: unknown; error?: string } = { status: res.status, ok: res.ok };
      if (res.data !== undefined) out.data = res.data;
      if (res.error !== undefined) out.error = res.error;
      return out;
    },

    sdk: async (call) => {
      const fn = deps.sdkEnterprise[call.method];
      if (typeof fn !== 'function') return { ok: false, error: `unknown sdk method "${call.method}"` };
      try {
        const data = await fn(...(call.args ?? []));
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    cli: deps.cli,

    automation: {
      run: async (ruleId, payload) => {
        const r = await deps.automationRun(ruleId, payload ?? {});
        return { ok: r.ok, ranId: r.ranId, actions: r.actions };
      },
      monitor: () => Promise.resolve(deps.automationMonitor()),
    },

    connectors: {
      sync: (id, accountId) => deps.connectorSync(id, accountId ?? null),
      state: (id) => Promise.resolve(deps.connectorState(id)),
    },

    timeline: { query: (ref) => Promise.resolve(deps.timelineQuery(ref)) },

    graph: {
      rebuild: () => deps.graphRebuild(),
      getNode: (id) => Promise.resolve(deps.graphGetNode(id)),
      neighbors: (id) => Promise.resolve(deps.graphNeighbors(id)),
    },

    memory: { references: (ref) => Promise.resolve(deps.memoryReferences(ref)) },

    executive: { snapshotKpis: () => Promise.resolve(deps.executiveKpis()) },

    planning: { run: (kind) => Promise.resolve(deps.planningRun(kind)) },

    plugin: {
      run: (id, input) => deps.pluginRun(id, input ?? {}),
      isRegistered: (id) => Promise.resolve(deps.pluginRegistered(id)),
    },

    webhook: { delivered: (ref) => Promise.resolve(deps.webhookDelivered(ref)) },

    security: { can: (perm) => Promise.resolve(deps.can(perm)) },

    desktop: deps.desktop,

    now: deps.now,
  };
}
