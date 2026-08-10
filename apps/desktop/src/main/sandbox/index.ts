/**
 * AI Sandbox — Sandbox Core (S1) composition root.
 *
 * Loads the sandbox stores, constructs the execution engine, ensures a default
 * workspace, and exposes the whole surface over the secure IPC bridge (reads gated on
 * `sandbox:read`, mutations on `sandbox:manage`, both authenticated + audited). No
 * executor is registered here — S1 is the reusable core; a later stage calls
 * `subsystem.engine.registerExecutor(...)`. The file path is injected so the whole
 * subsystem unit-tests on a temp dir.
 */
import { join } from 'node:path';
import {
  EmptyRequest,
  IpcChannel,
  SandboxArtifactGetRequest,
  SandboxArtifactListRequest,
  SandboxDashboardRequest,
  SandboxDatasetCreateRequest,
  SandboxDatasetDeleteRequest,
  SandboxDatasetListRequest,
  SandboxExecutionCancelRequest,
  SandboxExecutionEnqueueRequest,
  SandboxExecutionGetRequest,
  SandboxExecutionHistoryRequest,
  SandboxExecutionRefRequest,
  SandboxExecutionTimelineRequest,
  SandboxQueueStateRequest,
  SandboxScenarioArchiveRequest,
  SandboxScenarioCreateRequest,
  SandboxScenarioGetRequest,
  SandboxScenarioListRequest,
  SandboxScenarioUpdateRequest,
  SandboxScenarioVersionCreateRequest,
  SandboxScenarioVersionsRequest,
  SandboxWorkspaceCreateRequest,
  SandboxWorkspaceDeleteRequest,
  SandboxWorkspaceUpdateRequest,
} from '@neuropause/shared';
import type {
  SandboxArtifactListRequest as TArtifactList,
  SandboxArtifactGetRequest as TArtifactGet,
  SandboxDashboardRequest as TDashboard,
  SandboxDatasetCreateRequest as TDatasetCreate,
  SandboxDatasetDeleteRequest as TDatasetDelete,
  SandboxDatasetListRequest as TDatasetList,
  SandboxExecutionCancelRequest as TExecCancel,
  SandboxExecutionEnqueueRequest as TEnqueue,
  SandboxExecutionGetRequest as TExecGet,
  SandboxExecutionHistoryRequest as THistory,
  SandboxExecutionRefRequest as TExecRef,
  SandboxExecutionTimelineRequest as TTimeline,
  SandboxQueueStateRequest as TQueueState,
  SandboxScenarioArchiveRequest as TScenarioArchive,
  SandboxScenarioCreateRequest as TScenarioCreate,
  SandboxScenarioGetRequest as TScenarioGet,
  SandboxScenarioListRequest as TScenarioList,
  SandboxScenarioUpdateRequest as TScenarioUpdate,
  SandboxScenarioVersionCreateRequest as TVersionCreate,
  SandboxScenarioVersionsRequest as TVersions,
  SandboxEvent,
  SandboxWorkspaceCreateRequest as TWorkspaceCreate,
  SandboxWorkspaceDeleteRequest as TWorkspaceDelete,
  SandboxWorkspaceUpdateRequest as TWorkspaceUpdate,
} from '@neuropause/shared';
import type { IpcBroadcaster, TenantScope } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { SandboxWorkspaceStore } from './workspaceStore';
import { SandboxScenarioStore } from './scenarioStore';
import { SandboxExecutionStore } from './executionStore';
import { SandboxArtifactStore } from './artifactStore';
import { SandboxDatasetStore } from './datasetStore';
import { SandboxExecutionEngine } from './executionEngine';
import { generateReport } from './reportGenerator';
import { buildDashboard } from './dashboard';

const log = createLogger('sandbox');

export interface SandboxDeps {
  /**
   * P13C N3 — the tenant boundary for every sandbox store.
   *
   * Injected rather than imported so this root stays testable, and REQUIRED so
   * a caller cannot construct the subsystem without one. Before this the five
   * stores had no tenant seam of any kind, and the composition root at
   * `runtimeCore` bound nine other stores while omitting all five of these.
   */
  scope: () => TenantScope | null;
  broadcast: IpcBroadcaster;
  /** Directory the sandbox stores live under (e.g. <userData>/sandbox). */
  baseDir: string;
  now?: () => number;
}

export interface SandboxSubsystem {
  handlers: SecureHandlerDef[];
  /** A later stage registers the real executor + reads live state here. */
  engine: SandboxExecutionEngine;
  dispose: () => void;
}

export async function initSandbox(deps: SandboxDeps): Promise<SandboxSubsystem> {
  const now = deps.now ?? Date.now;
  const workspaces = new SandboxWorkspaceStore(join(deps.baseDir, 'workspaces.json'), now);
  const scenarios = new SandboxScenarioStore(join(deps.baseDir, 'scenarios.json'), now);
  const executions = new SandboxExecutionStore(join(deps.baseDir, 'executions.json'), now);
  const artifacts = new SandboxArtifactStore(join(deps.baseDir, 'artifacts.json'), now);
  const datasets = new SandboxDatasetStore(join(deps.baseDir, 'datasets.json'), now);

  // Bind BEFORE load: an unbound store denies, and denying during hydration is
  // the correct order — the alternative is a window where reads are open.
  for (const store of [workspaces, scenarios, executions, artifacts, datasets]) {
    store.bindScope(deps.scope);
  }

  /**
   * THE BOOT INVARIANT — the check whose absence let two stores ship unbound.
   *
   * `hasScope()` existed on the base class with ZERO callers, and the fresh
   * sweep found exactly what that predicts: `ValidationRunStore` and
   * `BenchmarkStore` extend the same substrate, gained the same seam, and were
   * never bound — so they stayed open while their five siblings closed. The
   * enterprise module registry has thrown on an unbound store since P11; the
   * sandbox substrate had the accessor and nothing that read it.
   *
   * Throwing at composition rather than warning, because a sandbox store that
   * denies every read is a broken product someone reports, while one that
   * answers every read is a disclosure nobody sees.
   */
  const unbound = [
    ['workspaces', workspaces],
    ['scenarios', scenarios],
    ['executions', executions],
    ['artifacts', artifacts],
    ['datasets', datasets],
  ].filter(([, store]) => !(store as { hasScope(): boolean }).hasScope());
  if (unbound.length > 0) {
    throw new Error(`Sandbox stores have no tenant boundary: ${unbound.map(([n]) => n).join(', ')}`);
  }

  await Promise.all([workspaces.load(), scenarios.load(), executions.load(), artifacts.load(), datasets.load()]);
  /**
   * NO DEFAULT WORKSPACE AT BOOT.
   *
   * `ensureDefault()` used to run here, at startup, with no tenant resolved —
   * which under the new ownership rule would throw, and under the old one
   * created an unowned workspace that every tenant then adopted. A tenant's
   * default sandbox is created lazily, on their first sandbox call, when there
   * is an organization to own it.
   */

  const engine = new SandboxExecutionEngine({
    workspaces,
    scenarios,
    executions,
    artifacts,
    datasets,
    /**
     * P13C N3 — the broadcast carries its owner.
     *
     * This fans out to EVERY open window, so a renderer showing tenant B was
     * told when tenant A's run started, with A's execution, workspace and
     * scenario ids in the payload. The event now names its tenant, and the
     * engine stamps it from the execution row, so a window can ignore what is
     * not its own. The ids alone were the disclosure — a live feed of another
     * customer's activity, and a supply of ids to try elsewhere.
     */
    broadcast: (event: SandboxEvent) => deps.broadcast(IpcChannel.SandboxEventBroadcast, event),
    now,
  });

  const read = 'sandbox:read' as const;
  const manage = 'sandbox:manage' as const;

  const handlers: SecureHandlerDef[] = [
    /* Workspace */
    { channel: IpcChannel.SandboxWorkspaceList, schema: EmptyRequest, requireAuth: true, permission: read, handler: () => {
      // A tenant with no sandbox workspace gets their OWN, lazily. Boot no
      // longer creates one, because at boot there is no tenant to own it.
      if (workspaces.list().length === 0) workspaces.ensureDefault();
      return workspaces.list();
    } },
    {
      channel: IpcChannel.SandboxWorkspaceCreate, schema: SandboxWorkspaceCreateRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => { const r = p as TWorkspaceCreate; return workspaces.create({ name: r.name, description: r.description, settings: r.settings }); },
    },
    {
      channel: IpcChannel.SandboxWorkspaceUpdate, schema: SandboxWorkspaceUpdateRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => { const r = p as TWorkspaceUpdate; return workspaces.update(r.id, { name: r.name, description: r.description, settings: r.settings }); },
    },
    {
      channel: IpcChannel.SandboxWorkspaceDelete, schema: SandboxWorkspaceDeleteRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => ({ deleted: workspaces.delete((p as TWorkspaceDelete).id) }),
    },

    /* Scenario (registry + versioning + metadata) */
    { channel: IpcChannel.SandboxScenarioList, schema: SandboxScenarioListRequest, requireAuth: true, permission: read, handler: (p) => { const r = p as TScenarioList; return scenarios.list({ workspaceId: r.workspaceId, includeArchived: r.includeArchived }); } },
    { channel: IpcChannel.SandboxScenarioGet, schema: SandboxScenarioGetRequest, requireAuth: true, permission: read, handler: (p) => scenarios.get((p as TScenarioGet).id) },
    {
      channel: IpcChannel.SandboxScenarioCreate, schema: SandboxScenarioCreateRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => { const r = p as TScenarioCreate; return scenarios.create({ workspaceId: r.workspaceId, key: r.key, name: r.name, description: r.description, metadata: r.metadata }); },
    },
    {
      channel: IpcChannel.SandboxScenarioUpdate, schema: SandboxScenarioUpdateRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => { const r = p as TScenarioUpdate; return scenarios.update(r.id, { name: r.name, description: r.description, metadata: r.metadata }); },
    },
    { channel: IpcChannel.SandboxScenarioArchive, schema: SandboxScenarioArchiveRequest, requireAuth: true, permission: manage, audit: true, handler: (p) => { const r = p as TScenarioArchive; return scenarios.archive(r.id, r.archived); } },
    {
      channel: IpcChannel.SandboxScenarioVersionCreate, schema: SandboxScenarioVersionCreateRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => { const r = p as TVersionCreate; return scenarios.createVersion(r.scenarioId, r.spec, r.changelog) ?? { error: 'not_found' }; },
    },
    { channel: IpcChannel.SandboxScenarioVersions, schema: SandboxScenarioVersionsRequest, requireAuth: true, permission: read, handler: (p) => scenarios.versions((p as TVersions).scenarioId) },

    /* Execution (engine + registry + queue + timeline + history) */
    { channel: IpcChannel.SandboxExecutionEnqueue, schema: SandboxExecutionEnqueueRequest, requireAuth: true, permission: manage, audit: true, handler: (p) => { const r = p as TEnqueue; return engine.enqueue({ scenarioId: r.scenarioId, version: r.version, trigger: r.trigger, priority: r.priority, datasetId: r.datasetId }); } },
    { channel: IpcChannel.SandboxExecutionGet, schema: SandboxExecutionGetRequest, requireAuth: true, permission: read, handler: (p) => executions.get((p as TExecGet).id) },
    { channel: IpcChannel.SandboxExecutionHistory, schema: SandboxExecutionHistoryRequest, requireAuth: true, permission: read, handler: (p) => { const r = p as THistory; return executions.history({ workspaceId: r.workspaceId, scenarioId: r.scenarioId, status: r.status, limit: r.limit, cursor: r.cursor }); } },
    { channel: IpcChannel.SandboxExecutionCancel, schema: SandboxExecutionCancelRequest, requireAuth: true, permission: manage, audit: true, handler: (p) => engine.cancel((p as TExecCancel).id) },
    { channel: IpcChannel.SandboxExecutionTimeline, schema: SandboxExecutionTimelineRequest, requireAuth: true, permission: read, handler: (p) => { const r = p as TTimeline; return executions.timelineFor(r.executionId, r.limit); } },
    { channel: IpcChannel.SandboxQueueState, schema: SandboxQueueStateRequest, requireAuth: true, permission: read, handler: (p) => engine.queueState((p as TQueueState).workspaceId) },

    /* Artifacts + result + report */
    { channel: IpcChannel.SandboxArtifactList, schema: SandboxArtifactListRequest, requireAuth: true, permission: read, handler: (p) => { const r = p as TArtifactList; return artifacts.list(r.executionId, r.kind); } },
    { channel: IpcChannel.SandboxArtifactGet, schema: SandboxArtifactGetRequest, requireAuth: true, permission: read, handler: (p) => artifacts.get((p as TArtifactGet).id) },
    { channel: IpcChannel.SandboxResultGet, schema: SandboxExecutionRefRequest, requireAuth: true, permission: read, handler: (p) => artifacts.getResult((p as TExecRef).executionId) },
    { channel: IpcChannel.SandboxReportGet, schema: SandboxExecutionRefRequest, requireAuth: true, permission: read, handler: (p) => artifacts.getReport((p as TExecRef).executionId) },
    {
      channel: IpcChannel.SandboxReportGenerate, schema: SandboxExecutionRefRequest, requireAuth: true, permission: manage, audit: true,
      handler: (p) => {
        const { executionId } = p as TExecRef;
        const execution = executions.get(executionId);
        if (!execution) return { error: 'not_found' };
        const scenario = scenarios.get(execution.scenarioId);
        if (!scenario) return { error: 'not_found' };
        const report = generateReport({
          execution,
          scenario,
          result: artifacts.getResult(executionId),
          artifacts: artifacts.list(executionId),
          timeline: executions.timelineFor(executionId),
          now,
        });
        artifacts.addReport(report);
        executions.setReportRef(executionId, report.id);
        return report;
      },
    },

    /* Dataset (inputs) */
    { channel: IpcChannel.SandboxDatasetList, schema: SandboxDatasetListRequest, requireAuth: true, permission: read, handler: (p) => datasets.list((p as TDatasetList).workspaceId) },
    { channel: IpcChannel.SandboxDatasetCreate, schema: SandboxDatasetCreateRequest, requireAuth: true, permission: manage, audit: true, handler: (p) => { const r = p as TDatasetCreate; return datasets.create({ workspaceId: r.workspaceId, name: r.name, description: r.description, rows: r.rows, schema: r.schema, storageRef: r.storageRef }); } },
    { channel: IpcChannel.SandboxDatasetDelete, schema: SandboxDatasetDeleteRequest, requireAuth: true, permission: manage, audit: true, handler: (p) => ({ deleted: datasets.delete((p as TDatasetDelete).id) }) },

    /* Dashboard */
    { channel: IpcChannel.SandboxDashboard, schema: SandboxDashboardRequest, requireAuth: true, permission: read, handler: (p) => buildDashboard({ workspaces, scenarios, executions, artifacts, engine, now }, (p as TDashboard).workspaceId) },
  ];

  log.info('AI Sandbox core initialized', { workspaces: workspaces.count(), scenarios: scenarios.count() });
  return { handlers, engine, dispose: () => undefined };
}
