/**
 * Platform composition root. Assembles the event-driven core and hands the
 * runtime core three things:
 *   - `api`          : the Public Event API other modules publish/subscribe through;
 *   - `handlers`     : secure IPC handlers for timeline query/stats/export,
 *                      diagnostics, and renderer-origin event emission;
 *   - `wireProducers`: subscribes to the existing services and republishes their
 *                      signals as Platform Events.
 *
 * This is the one platform file that may touch Electron (native notifications,
 * userData paths) — the bus, timeline, subscribers, and producers it wires are
 * all Electron-free and unit-tested in isolation.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, Notification } from 'electron';
import type {
  AuthStatus,
  DiagnosticsReport,
  NpsProgressEvent,
  PlatformEvent,
  PluginHostEvent,
  RuntimeEvent,
  TimelineQuery,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  TimelineQueryRequest,
  PlatformEmitRequest,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import { runOutsidePrincipal } from '../tenancy/backgroundPrincipal';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { catalogClient } from '../catalog/catalogClient';
import { registry } from '../registry/registry';
import { packageService } from '../nps/packageService';
import { setAllowUnsignedInstalls } from '../nps/signature';
import { pluginManager } from '../plugins/pluginManager';
import { supervisor } from '../runtime/supervisor';
import { EventBus } from './eventBus';
import type { TenantScope } from '@neuropause/shared';
import { TimelineService } from './timelineService';
import { PlatformEventApi } from './eventApi';
import { registerSubscribers } from './subscribers';
import { DiagnosticsService, makeCheck, type DiagnosticProbe } from './diagnostics';

/**
 * Probes contributed from above the platform layer (e.g. AI health, wired in the
 * composition root). DiagnosticsService reads its probes array at report time, so
 * late pushes are picked up; registrations made before the platform starts are
 * drained into the live array during init.
 */
let liveProbes: DiagnosticProbe[] | null = null;
const pendingProbes: DiagnosticProbe[] = [];
export function registerDiagnosticProbes(extra: DiagnosticProbe[]): void {
  (liveProbes ?? pendingProbes).push(...extra);
}
import {
  runtimeEventToPlatform,
  downloadEventToPlatform,
  pluginEventToPlatform,
  authStatusToPlatform,
  build,
} from './producers';

const log = createLogger('platform');

export interface ProducerSources {
  supervisor: { on(event: 'event', listener: (e: RuntimeEvent) => void): unknown };
  packageService: { on(event: 'progress', listener: (e: NpsProgressEvent) => void): unknown };
  pluginHost: { on(event: 'event', listener: (e: PluginHostEvent) => void): unknown };
  authService: { on(event: 'statusChanged', listener: (s: AuthStatus) => void): unknown };
}

export interface Platform {
  /** P13B — bind the tenant boundary (bus stamping + timeline filtering). */
  bindTenant: (resolve: () => TenantScope | null) => void;
  api: PlatformEventApi;
  diagnostics: () => Promise<DiagnosticsReport>;
  handlers: SecureHandlerDef[];
  wireProducers: (sources: ProducerSources) => void;
  dispose: () => Promise<void>;
}

function auditLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'audit.log');
}

function appendAuditLine(event: PlatformEvent): void {
  const line = `${JSON.stringify({
    at: event.timestamp,
    kind: 'platform-event',
    type: event.type,
    actor: event.actor,
    resource: event.resource,
    correlationId: event.correlationId,
  })}\n`;
  void fs
    .mkdir(join(app.getPath('userData'), 'logs'), { recursive: true })
    .then(() => fs.appendFile(auditLogPath(), line))
    .catch(() => undefined);
}

function notifyUser(event: PlatformEvent): void {
  if (!Notification.isSupported()) return;
  const title = TITLES[event.type] ?? 'NeuroPause';
  const body = event.resource?.name ?? event.resource?.id ?? '';
  try {
    new Notification({ title, body }).show();
  } catch {
    /* notifications are best-effort */
  }
}

const TITLES: Partial<Record<PlatformEvent['type'], string>> = {
  'runtime.crashed': 'An application crashed',
  'plugin.crashed': 'A plugin crashed',
  'download.failed': 'A download failed',
  'update.available': 'Update available',
  'permission.granted': 'Permission granted',
};

export async function initPlatform(deps: {
  broadcast: IpcBroadcaster;
}): Promise<Platform> {
  const startedAt = Date.now();

  // TD-2 (GA blocker): marketplace package installs are fail-closed in packaged
  // (production) builds — unsigned/untrusted artifacts are refused. Unsigned
  // installs are permitted only in unpackaged dev, where the demo catalog is
  // unsigned. A tampered or untrusted-key signature is always refused.
  setAllowUnsignedInstalls(!app.isPackaged);

  const bus = new EventBus({
    replayBufferSize: 500,
    onSubscriberError: (id, _event, err) =>
      log.warn('Subscriber error', {
        subscriber: id,
        error: err instanceof Error ? err.message : String(err),
      }),
  });

  const timeline = new TimelineService({ dir: join(app.getPath('userData'), 'timeline') });

  /**
   * P13B — the event system's tenant boundary is bound by the COMPOSITION ROOT,
   * not here.
   *
   * The platform subsystem boots before the enterprise subsystem exists to
   * resolve anything, so a binding made at this point would capture a resolver
   * that can only ever answer null. `runtimeCore` binds `bus` and `timeline`
   * alongside every other scoped store, once the resolver is real. Until then
   * events are unowned — the correct reading of "published before the app knew
   * who it was acting for".
   */
  await timeline.init();

  const api = new PlatformEventApi(bus, timeline);

  /**
   * The viewer resolver, late-bound. P13C ROUND 9 — F5.
   *
   * Same reason the bus's own tenant resolver is late-bound: the platform
   * subsystem boots before the enterprise subsystem exists to resolve anything.
   * Until the composition root binds it this answers null, and the forwarder's
   * predicate reads null as "system events only" — fail-closed, not fail-open.
   */
  let viewerScope: () => TenantScope | null = () => null;

  registerSubscribers(bus, {
    persist: (e) => timeline.append(e),
    audit: (e) => appendAuditLine(e),
    notify: (e) => notifyUser(e),
    broadcast: (e) => deps.broadcast(IpcChannel.PlatformEventBroadcast, e),
    viewerScope: () => viewerScope(),
  });

  // Service health probes (use only confirmed public methods).
  const probes: DiagnosticProbe[] = [
    () => makeCheck('ipc', 'IPC', 'ok', { detail: 'Secure bridge active' }),
    () => {
      const ok = registry.isIntegrityOk();
      return makeCheck('registry', 'Registry', ok ? 'ok' : 'degraded', {
        detail: `${registry.list().length} installed`,
        recommendation: ok ? null : 'Registry integrity check failed — restore from a backup.',
      });
    },
    () =>
      makeCheck('package-service', 'Package Service', 'ok', {
        detail: `${packageService.operations().length} operation(s)`,
      }),
    () =>
      makeCheck('runtime', 'Runtime', 'ok', { detail: `${supervisor.list().length} instance(s)` }),
    () =>
      makeCheck('plugin-host', 'Plugin Host', 'ok', {
        detail: `${pluginManager.list().length} plugin(s)`,
      }),
    () =>
      makeCheck('background-services', 'Background Services', 'ok', {
        detail: 'Scheduler · health monitor · update checker · crash reporter',
      }),
    async () => {
      const started = Date.now();
      try {
        const page = await catalogClient.sections('trending', 1, 1);
        return makeCheck('backend', 'Backend · Database · Cache', 'ok', {
          detail: `Reachable (${page.total} apps)`,
          latencyMs: Date.now() - started,
        });
      } catch (err) {
        return makeCheck('backend', 'Backend · Database · Cache', 'down', {
          detail: err instanceof Error ? err.message : 'Unreachable',
          latencyMs: Date.now() - started,
          recommendation: 'Start the backend (npm run dev) and infrastructure (npm run infra:up).',
        });
      }
    },
  ];

  const diagnostics = new DiagnosticsService({ bus, timeline, startedAt, probes });
  probes.push(...pendingProbes);
  pendingProbes.length = 0;
  liveProbes = probes;

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.TimelineQuery,
      schema: TimelineQueryRequest,
      handler: (p) => api.query(p as TimelineQuery),
    },
    { channel: IpcChannel.TimelineStats, schema: EmptyRequest, handler: () => api.stats() },
    {
      channel: IpcChannel.TimelineExport,
      schema: EmptyRequest,
      audit: true,
      handler: () => timeline.export(),
    },
    {
      channel: IpcChannel.DiagnosticsGet,
      schema: EmptyRequest,
      handler: () => diagnostics.report(),
    },
    {
      channel: IpcChannel.PlatformEmit,
      schema: PlatformEmitRequest,
      handler: (p) => {
        const r = p as PlatformEmitRequest;
        const evt =
          r.type === 'workspace.opened'
            ? build.workspaceOpened(r.resourceId ?? 'workspace', r.resourceName ?? null)
            : build.workspaceClosed(r.resourceId ?? 'workspace', r.resourceName ?? null);
        api.publish(evt);
        return { ok: true };
      },
    },
  ];

  // Producer wiring: subscribe to existing services and republish.
  const wireProducers = (sources: ProducerSources): void => {
    const seenDownloads = new Set<string>();
    let wasAuthenticated = false;

    sources.supervisor.on('event', (e) => {
      const input = runtimeEventToPlatform(e);
      if (input) api.publish(input);
    });
    sources.packageService.on('progress', (e) => {
      const input = downloadEventToPlatform(e, seenDownloads);
      if (input) api.publish(input);
    });
    sources.pluginHost.on('event', (e) => {
      const input = pluginEventToPlatform(e);
      if (input) api.publish(input);
    });
    sources.authService.on('statusChanged', (s) => {
      const input = authStatusToPlatform(s, wasAuthenticated);
      wasAuthenticated = s.state === 'authenticated';
      if (input) api.publish(input);
    });
  };

  log.info('Platform core initialized', { timeline: timeline.stats().total });

  return {
    api,
    diagnostics: () => diagnostics.report(),
    handlers,
    wireProducers,
    /**
     * P13B — bind the tenant boundary onto the event system.
     *
     * Called by the composition root once the tenant resolver is real. The bus
     * stamps each event as it is materialized; the timeline filters every read.
     */
    bindTenant: (resolve: () => TenantScope | null): void => {
      bus.bindTenant(() => resolve()?.tenantId ?? null);
      timeline.bindScope(resolve);
      /**
       * P13C ROUND 9 — F5. THE VIEWER IS NOT THE ACTOR.
       *
       * `resolve` is `activeTenantScope`, which PREFERS a background principal
       * when one is in scope — correct for stamping an event with whose work it
       * is, and wrong for deciding which window may see it. A connector sync
       * running as tenant A publishes while the renderer shows tenant B; asking
       * `resolve()` inside that job returns A and would hand A's identifiers to
       * B's window, which is the finding with an extra step.
       *
       * `runOutsidePrincipal` leaves the job's principal for the duration of the
       * call, so this reads the SESSION — exactly what the person at the
       * keyboard is entitled to, never more. It grants nothing; it only stops
       * the forwarder pretending to be the job.
       */
      viewerScope = () => runOutsidePrincipal(() => resolve());
    },
    dispose: () => timeline.dispose(),
  };
}
