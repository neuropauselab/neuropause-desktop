/**
 * Runtime Supervisor — the heart of the NeuroPause Runtime. It owns every live
 * instance, drives the lifecycle state machine (launch / stop / suspend /
 * resume / restart), routes each app kind to the right adapter, runs health
 * checks, samples resources, detects crashes, and applies a restart policy.
 *
 * It is built for many simultaneous instances across many app kinds: instances
 * are keyed by id and indexed by app, and adapters are pluggable, so adding a
 * container or remote runtime later is additive.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  AppType,
  HealthStatus,
  OpenAppRequest,
  RuntimeEvent,
  RuntimeInstanceDto,
  StoreAppDetail,
  TenantScope,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { registry } from '../registry/registry';
import { catalogClient } from '../catalog/catalogClient';
import type { LaunchContext, RuntimeAdapter, RuntimeInstance, RuntimeInstanceOwner } from './types';
import { ownerForTenantKey, sameOwner } from './types';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';
import { WebRuntimeAdapter } from './adapters/webAdapter';
import { ProcessRuntimeAdapter } from './adapters/processAdapter';

const log = createLogger('runtime');
const MAX_RESTARTS = 3;

/**
 * A7 — both outbound events are declared here so their payloads are real types at
 * every listener, including the two that forward them to the renderer. Previously
 * `event` and `openApp` were `any` from the emitter outward.
 */
class RuntimeSupervisor extends EventEmitter<{ event: [RuntimeEvent]; openApp: [OpenAppRequest] }> {
  private instances = new Map<string, RuntimeInstance>();
  private adapters: RuntimeAdapter[] = [new WebRuntimeAdapter(), new ProcessRuntimeAdapter()];
  private launchUrlCache = new Map<string, string | null>();

  /**
   * WHO IS ASKING. P13C ROUND 11 — M-3.
   *
   * The supervisor holds LIVE PROCESSES, not catalogue rows. The catalogue is
   * legitimately INSTALL_GLOBAL — one copy of the app on one machine — but a
   * running instance is something one organization started, and it reports
   * `pid`, `startedAt`, `uptimeMs`, `restarts` and a CPU/memory sample.
   *
   * Bound to `activeTenantScope` in the composition root, never to
   * `tenantContext.scope`: the principal-aware resolver is the one Round 10's
   * RT-H2 established, and `resolverAttachment.test.ts` fails the build if a
   * `bindScope` in this process receives the session-only one.
   *
   * UNBOUND ANSWERS `unowned-install`, which is the single-user desktop case and
   * is one audience rather than a shared one. The composition root binds it, and
   * `round11RuntimeOwnership.test.ts` pins that line by name — because "nobody
   * bound it" must not silently become "everyone can see everything".
   */
  private scopeSource: (() => TenantScope | null) | null = null;

  /**
   * P13C ROUND 11 — M-3. REGISTERED WITH THE STARTUP GATE.
   *
   * `tenantStoreRegistry` refused this file the moment it defined a `bindScope`,
   * which is the invariant behaving exactly as designed: a seam the startup gate
   * cannot see is a seam that can silently ship unbound, and an unbound
   * supervisor answers `unowned-install` for every caller — the shared audience
   * this finding WAS. So `assertAllTenantStoresBound()` now refuses to start an
   * install where nothing bound it.
   *
   * It registers as tenant-scoped rather than declaring a store scope: the
   * instances are LIVE PROCESSES, not persisted rows, so `storeScopeGate` (which
   * keys off persistence) correctly has nothing to say about this file. The two
   * mechanisms are deliberately blind to different things.
   */
  constructor() {
    super();
    registerTenantStore('runtime-supervisor', () => this.scopeSource !== null);
  }

  /** Attach the authoritative tenant resolver. Composition root only. */
  bindScope(source: () => TenantScope | null): this {
    this.scopeSource = source;
    return this;
  }

  /** The audience the CALLER belongs to right now. */
  private ownerNow(): RuntimeInstanceOwner {
    return ownerForTenantKey(this.scopeSource?.()?.tenantId ?? '');
  }

  private adapterFor(kind: AppType): RuntimeAdapter {
    const adapter = this.adapters.find((a) => a.kinds.includes(kind));
    if (!adapter) throw new Error(`No runtime adapter for app kind "${kind}"`);
    return adapter;
  }

  private buildContext(instance: RuntimeInstance, entry = registry.getRaw(instance.slug)): LaunchContext {
    return {
      entry: entry!,
      instance,
      openApp: (req: OpenAppRequest) => this.emit('openApp', req),
      emit: (partial) => this.dispatch(instance, partial),
    };
  }

  /** Centralized event sink: updates instance, emits, and applies restart policy. */
  private dispatch(
    instance: RuntimeInstance,
    partial: Omit<RuntimeEvent, 'instanceId' | 'appSlug' | 'at'>,
  ): void {
    if (partial.status) instance.status = partial.status;
    if (partial.health) instance.health = partial.health;
    const event: RuntimeEvent = {
      ...partial,
      instanceId: instance.instanceId,
      appSlug: instance.slug,
      at: new Date().toISOString(),
    };
    this.emit('event', event);
    void this.syncRegistryStatus(instance.slug);

    if (partial.type === 'crash') {
      void this.handleCrash(instance);
    }
  }

  private async handleCrash(instance: RuntimeInstance): Promise<void> {
    if (instance.restarts >= MAX_RESTARTS) {
      log.warn('Crash restart limit reached', { slug: instance.slug });
      instance.status = 'failed';
      await registry.setHealth(instance.slug, 'unhealthy');
      return;
    }
    instance.restarts += 1;
    log.info('Restarting after crash', { slug: instance.slug, attempt: instance.restarts });
    await new Promise((r) => setTimeout(r, 1000 * instance.restarts));
    instance.intentionalStop = false;
    instance.status = 'starting';
    try {
      await this.adapterFor(instance.kind).launch(this.buildContext(instance));
    } catch (err) {
      instance.status = 'failed';
      instance.lastError = (err as Error).message;
      this.dispatch(instance, { type: 'lifecycle', status: 'failed', health: 'unhealthy', message: instance.lastError });
    }
  }

  /** Reflects aggregate runtime status for an app back into the registry. */
  private async syncRegistryStatus(slug: string): Promise<void> {
    const forApp = [...this.instances.values()].filter((i) => i.slug === slug);
    const anyRunning = forApp.some((i) => i.status === 'running');
    const anySuspended = forApp.some((i) => i.status === 'suspended');
    const status = anyRunning ? 'running' : anySuspended ? 'suspended' : 'stopped';
    await registry.setRuntimeStatus(slug, status);
  }

  private async resolveLaunchUrl(slug: string): Promise<string | null> {
    if (this.launchUrlCache.has(slug)) return this.launchUrlCache.get(slug) ?? null;
    let url: string | null = null;
    try {
      const detail: StoreAppDetail = await catalogClient.app(slug);
      url = detail.launchUrl ?? detail.homepageUrl ?? null;
    } catch {
      url = null;
    }
    this.launchUrlCache.set(slug, url);
    return url;
  }

  /* ── lifecycle ── */

  async launch(slug: string): Promise<RuntimeInstanceDto> {
    const entry = registry.getRaw(slug);
    if (!entry) throw new Error(`${slug} is not installed`);

    const instance: RuntimeInstance = {
      instanceId: randomUUID(),
      // P13C ROUND 11 — M-3. Stamped from the resolver at launch, never from a
      // caller-supplied field: the renderer may say WHICH app to start and never
      // WHOSE the running process is.
      owner: this.ownerNow(),
      slug: entry.slug,
      name: entry.name,
      kind: entry.appType,
      status: 'starting',
      health: 'unknown',
      pid: null,
      child: null,
      launchUrl: await this.resolveLaunchUrl(slug),
      startedAt: null,
      restarts: 0,
      lastError: null,
      lastResource: null,
      intentionalStop: false,
    };
    this.instances.set(instance.instanceId, instance);
    this.dispatch(instance, { type: 'lifecycle', status: 'starting', health: 'unknown', message: 'Starting' });

    try {
      await this.adapterFor(instance.kind).launch(this.buildContext(instance, entry));
      instance.startedAt = Date.now();
      await registry.recordLaunch(slug);
      // Best-effort server-side launch tracking.
      const installationId = (entry.config as Record<string, unknown>).installationId;
      if (typeof installationId === 'string') {
        catalogClient.recordLaunch(installationId).catch(() => undefined);
      }
      return this.toDto(instance);
    } catch (err) {
      instance.status = 'failed';
      instance.lastError = (err as Error).message;
      this.dispatch(instance, { type: 'lifecycle', status: 'failed', health: 'unhealthy', message: instance.lastError });
      return this.toDto(instance);
    }
  }

  /** Stop an instance the caller owns. */
  async stop(instanceId: string): Promise<void> {
    this.requireInstance(instanceId);
    await this.stopInternal(instanceId);
  }

  /**
   * Stop WITHOUT an ownership check — SYSTEM PATH ONLY. P13C ROUND 11 — M-3.
   *
   * `stopByApp` is reached from uninstall, which removes the install-wide
   * catalogue row: every tenant's instance of that app must come down, or a
   * process outlives the app it belongs to. That is a legitimate install-wide
   * act and it is authorized at ITS OWN door (the uninstall channel), not here.
   *
   * Private, and the only two callers are `stop` (which checks first) and
   * `stopByApp`. It is not exported and there is no public unchecked sibling —
   * adding one would reopen M-3 under a new name.
   */
  private async stopInternal(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`No runtime instance ${instanceId}`);
    instance.intentionalStop = true;
    this.dispatch(instance, { type: 'lifecycle', status: 'stopping', health: 'unknown', message: 'Stopping' });
    await this.adapterFor(instance.kind).stop(instance);
    instance.status = 'stopped';
    this.dispatch(instance, { type: 'lifecycle', status: 'stopped', health: 'unknown', message: 'Stopped' });
    this.instances.delete(instanceId);
    await this.syncRegistryStatus(instance.slug);
  }

  async suspend(instanceId: string): Promise<RuntimeInstanceDto> {
    const instance = this.requireInstance(instanceId);
    await this.adapterFor(instance.kind).suspend(instance);
    this.dispatch(instance, { type: 'lifecycle', status: 'suspended', health: 'degraded', message: 'Suspended' });
    return this.toDto(instance);
  }

  async resume(instanceId: string): Promise<RuntimeInstanceDto> {
    const instance = this.requireInstance(instanceId);
    await this.adapterFor(instance.kind).resume(instance);
    this.dispatch(instance, { type: 'lifecycle', status: 'running', health: 'healthy', message: 'Resumed' });
    return this.toDto(instance);
  }

  async restart(instanceId: string): Promise<RuntimeInstanceDto> {
    const instance = this.requireInstance(instanceId);
    const slug = instance.slug;
    await this.stop(instanceId);
    return this.launch(slug);
  }

  async stopByApp(slug: string): Promise<void> {
    const ids = [...this.instances.values()].filter((i) => i.slug === slug).map((i) => i.instanceId);
    // SYSTEM PATH — see `stopInternal`. Uninstall removes the install-wide
    // catalogue row, so every tenant's instance of that app must come down.
    for (const id of ids) await this.stopInternal(id);
  }

  /* ── monitoring ── */

  /** Runs a liveness + resource pass over all instances. Called by HealthMonitor. */
  async checkHealth(): Promise<void> {
    for (const instance of this.instances.values()) {
      if (instance.status !== 'running') continue;
      const adapter = this.adapterFor(instance.kind);
      const sample = await adapter.sampleResource(instance);
      instance.lastResource = sample;
      const health: HealthStatus = sample ? 'healthy' : 'unhealthy';
      if (health !== instance.health) {
        this.dispatch(instance, { type: 'health', status: null, health, message: 'Health check' });
        await registry.setHealth(instance.slug, health);
      }
    }
  }

  /** Only the caller's own live processes. P13C ROUND 11 — M-3. */
  list(): RuntimeInstanceDto[] {
    const me = this.ownerNow();
    return [...this.instances.values()]
      .filter((i) => sameOwner(i.owner, me))
      .map((i) => this.toDto(i));
  }

  get(instanceId: string): RuntimeInstanceDto | null {
    const i = this.instances.get(instanceId);
    if (!i || !sameOwner(i.owner, this.ownerNow())) return null;
    return this.toDto(i);
  }

  /**
   * Resolve an instance the CALLER OWNS, or refuse. P13C ROUND 11 — M-3.
   *
   * THE ERROR IS DELIBERATELY IDENTICAL for "no such instance" and "not yours".
   * A distinguishable message is an existence oracle: instance ids are UUIDs, so
   * a different error for a real-but-foreign id confirms that another
   * organization is running something, which is the inference half of this
   * finding. One message, both cases.
   */
  private requireInstance(instanceId: string): RuntimeInstance {
    const instance = this.instances.get(instanceId);
    if (!instance || !sameOwner(instance.owner, this.ownerNow())) {
      throw new Error(`No runtime instance ${instanceId}`);
    }
    return instance;
  }

  private toDto(i: RuntimeInstance): RuntimeInstanceDto {
    return {
      instanceId: i.instanceId,
      appSlug: i.slug,
      appName: i.name,
      kind: i.kind,
      status: i.status,
      health: i.health,
      pid: i.pid,
      startedAt: i.startedAt ? new Date(i.startedAt).toISOString() : null,
      uptimeMs: i.startedAt ? Date.now() - i.startedAt : 0,
      restarts: i.restarts,
      lastError: i.lastError,
      resource: i.lastResource,
    };
  }
}

export const supervisor = new RuntimeSupervisor();
