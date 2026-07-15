/**
 * P8.5 — Worker install lifecycle service.
 *
 * Owns install / update / enable / disable / rollback / uninstall over the persisted
 * InstallStore, composing each signed manifest into a WorkerDefinition and registering
 * it into the EXISTING WorkerRegistry (builtIn:false). It also owns the installed
 * workers' skill map, which the composition root merges into the single `skillsFor`
 * resolution seam — so a DISABLED or UNINSTALLED worker has no resolvable skills and
 * the runtime refuses to run it (fails "has no skill"), while governance/RBAC/trust
 * treat every installed worker identically to a built-in. No new runtime, no code
 * execution from the package.
 */
import type {
  PlatformEventInput,
  PlatformEventType,
  WorkerInstallDetail,
  WorkerInstallResult,
  WorkerInstallSummary,
  WorkerPackage,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { SkillImpl, WorkerDefinition } from '../sdk';
import type { WorkerRegistry } from '../registry/workerRegistry';
import type { InstallStore, StoredInstall } from './installStore';
import { composeInstalledWorker, validateWorkerPackage, type PackageValidationContext } from './manifest';

const log = createLogger('workforce-install');

export interface InstallServiceDeps {
  store: InstallStore;
  registry: WorkerRegistry;
  /** The running app/engine version, for compatibility checks. */
  appVersion: string;
  /** Publish a platform event (→ timeline). Optional so the service runs in tests. */
  publish?: (event: PlatformEventInput) => void;
  clock?: () => string;
}

export type InstallResult = WorkerInstallResult;

export class WorkerInstallService {
  private readonly clock: () => string;
  /** Enabled installed workers' skills — merged into the runtime's skillsFor. */
  private readonly skills = new Map<string, Map<string, SkillImpl>>();

  constructor(private readonly deps: InstallServiceDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  /** Skill lookup for the composition-root resolver (null when absent/disabled). */
  skillsFor(workerId: string): Map<string, SkillImpl> | null {
    return this.skills.get(workerId) ?? null;
  }

  private ctx(): PackageValidationContext {
    return {
      appVersion: this.deps.appVersion,
      isBuiltIn: (id) => this.deps.registry.get(id)?.builtIn === true,
      isInstalled: (id) => this.deps.store.has(id),
    };
  }

  /**
   * Re-register + re-activate persisted installs on startup (silent; no events).
   * Each record is RE-VALIDATED end to end (signature against a trusted key, checksum,
   * namespace, built-in collision, permissions) — a tampered `workforce-installs.json`
   * therefore cannot register an unsigned worker or hijack a built-in at boot. Any
   * installed (builtIn:false) worker not successfully restored is reconciled out of the
   * registry so the roster never shows a skill-less "ghost".
   */
  async load(): Promise<void> {
    await this.deps.store.load();
    const restored = new Set<string>();
    for (const r of this.deps.store.all()) {
      const pkg: WorkerPackage = {
        manifest: r.manifest,
        checksum: r.checksum,
        signatureKeyId: r.signatureKeyId,
        signature: r.signature,
      };
      const v = validateWorkerPackage(pkg, this.ctx());
      if (!v.ok) {
        log.warn('Skipping invalid install on load', { id: r.id, errors: v.errors });
        continue;
      }
      try {
        const def = composeInstalledWorker(r.manifest); // register preserves earned trust/health
        this.deps.registry.register(def);
        restored.add(r.id);
        if (r.state === 'enabled') {
          this.skills.set(r.id, def.skills);
          this.deps.registry.setLifecycle(r.id, 'idle');
        } else {
          this.deps.registry.setLifecycle(r.id, 'paused');
        }
      } catch (err) {
        log.error('Failed to restore installed worker', { id: r.id, error: String(err) });
      }
    }
    // Reconcile: drop stale installed workers persisted in the registry but not restored.
    for (const w of this.deps.registry.list()) {
      if (!w.builtIn && !restored.has(w.identity.id)) this.deps.registry.unregister(w.identity.id);
    }
    log.info('Restored installed workers', { count: restored.size });
  }

  install(pkg: WorkerPackage): InstallResult {
    const id = pkg.manifest.id;
    if (this.deps.store.has(id)) return this.fail([`"${id}" is already installed; use update`]);
    const v = validateWorkerPackage(pkg, this.ctx());
    if (!v.ok) return this.fail(v.errors);

    const now = this.clock();
    const def = composeInstalledWorker(pkg.manifest);
    this.activate(def);
    const record: StoredInstall = {
      id,
      version: pkg.manifest.version,
      state: 'enabled',
      manifest: pkg.manifest,
      checksum: pkg.checksum,
      signatureKeyId: pkg.signatureKeyId,
      signature: pkg.signature,
      previous: null,
      installedAt: now,
      updatedAt: now,
    };
    this.deps.store.put(record);
    this.deps.registry.setLifecycle(id, 'idle', now);
    this.event('worker.installed', record);
    return this.done(record);
  }

  update(pkg: WorkerPackage): InstallResult {
    const id = pkg.manifest.id;
    const existing = this.deps.store.get(id);
    if (!existing) return this.fail([`"${id}" is not installed; use install`]);
    const v = validateWorkerPackage(pkg, this.ctx());
    if (!v.ok) return this.fail(v.errors);

    const now = this.clock();
    const def = composeInstalledWorker(pkg.manifest);
    this.activate(def); // register preserves earned trust/health for the same id
    const record: StoredInstall = {
      id,
      version: pkg.manifest.version,
      state: existing.state,
      manifest: pkg.manifest,
      checksum: pkg.checksum,
      signatureKeyId: pkg.signatureKeyId,
      signature: pkg.signature,
      // Retain the prior version (with its signature) for one-step rollback.
      previous: {
        version: existing.version,
        manifest: existing.manifest,
        checksum: existing.checksum,
        signatureKeyId: existing.signatureKeyId,
        signature: existing.signature,
      },
      installedAt: existing.installedAt,
      updatedAt: now,
    };
    this.deps.store.put(record);
    if (record.state === 'disabled') this.deactivate(id);
    this.event('worker.updated', record);
    return this.done(record);
  }

  rollback(id: string): InstallResult {
    const existing = this.deps.store.get(id);
    if (!existing) return this.fail([`"${id}" is not installed`]);
    if (!existing.previous) return this.fail([`"${id}" has no previous version to roll back to`]);

    const now = this.clock();
    const prev = existing.previous;
    let def: WorkerDefinition;
    try {
      def = composeInstalledWorker(prev.manifest);
    } catch (err) {
      return this.fail([err instanceof Error ? err.message : String(err)]);
    }
    this.activate(def);
    const record: StoredInstall = {
      id,
      version: prev.version,
      state: existing.state,
      manifest: prev.manifest,
      checksum: prev.checksum,
      signatureKeyId: prev.signatureKeyId,
      signature: prev.signature,
      previous: null, // rollback consumes the retained version
      installedAt: existing.installedAt,
      updatedAt: now,
    };
    this.deps.store.put(record);
    if (record.state === 'disabled') this.deactivate(id);
    this.event('worker.rolled_back', record);
    return this.done(record);
  }

  enable(id: string): InstallResult {
    const existing = this.deps.store.get(id);
    if (!existing) return this.fail([`"${id}" is not installed`]);
    const now = this.clock();
    let def: WorkerDefinition;
    try {
      def = composeInstalledWorker(existing.manifest);
    } catch (err) {
      return this.fail([err instanceof Error ? err.message : String(err)]);
    }
    this.activate(def);
    this.deps.registry.setLifecycle(id, 'idle', now);
    const record: StoredInstall = { ...existing, state: 'enabled', updatedAt: now };
    this.deps.store.put(record);
    this.event('worker.enabled', record);
    return this.done(record);
  }

  disable(id: string): InstallResult {
    const existing = this.deps.store.get(id);
    if (!existing) return this.fail([`"${id}" is not installed`]);
    const now = this.clock();
    this.deactivate(id);
    this.deps.registry.setLifecycle(id, 'paused', now);
    const record: StoredInstall = { ...existing, state: 'disabled', updatedAt: now };
    this.deps.store.put(record);
    this.event('worker.disabled', record);
    return this.done(record);
  }

  uninstall(id: string): InstallResult {
    const existing = this.deps.store.get(id);
    if (!existing) return this.fail([`"${id}" is not installed`]);
    // Refuse if another installed package still declares this one as a dependency.
    const dependents = this.deps.store
      .all()
      .filter((r) => r.id !== id && r.manifest.dependencies.includes(id))
      .map((r) => r.id);
    if (dependents.length > 0) {
      return this.fail([`"${id}" is required by: ${dependents.join(', ')}`]);
    }
    this.deps.registry.unregister(id);
    this.deactivate(id);
    this.deps.store.delete(id);
    this.event('worker.uninstalled', existing);
    return { ok: true, errors: [], summary: this.toSummary(existing) };
  }

  listInstalls(): WorkerInstallSummary[] {
    return this.deps.store.all().map((r) => this.toSummary(r));
  }

  /** P8.6 — full install detail (manifest skills/deps/signature/engine) for the Center. */
  installDetail(id: string): WorkerInstallDetail | null {
    const r = this.deps.store.get(id);
    if (!r) return null;
    return {
      ...this.toSummary(r),
      description: r.manifest.description,
      memoryScope: r.manifest.memoryScope,
      goals: r.manifest.goals,
      skills: r.manifest.skills,
      dependencies: r.manifest.dependencies,
      engine: r.manifest.engine,
      checksum: r.checksum,
      signatureKeyId: r.signatureKeyId,
      signed: r.signatureKeyId != null && r.signature != null,
      previousVersion: r.previous?.version ?? null,
    };
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private activate(def: WorkerDefinition): void {
    this.deps.registry.register(def);
    this.skills.set(def.worker.identity.id, def.skills);
  }

  private deactivate(id: string): void {
    this.skills.delete(id);
  }

  private toSummary(r: StoredInstall): WorkerInstallSummary {
    return {
      id: r.id,
      name: r.manifest.name,
      version: r.version,
      author: r.manifest.author,
      state: r.state,
      role: r.manifest.role,
      capabilities: r.manifest.capabilities,
      permissions: r.manifest.permissions,
      canRollback: r.previous !== null,
      installedAt: r.installedAt,
      updatedAt: r.updatedAt,
    };
  }

  private event(type: PlatformEventType, record: StoredInstall): void {
    if (!this.deps.publish) return;
    this.deps.publish({
      type,
      category: 'automation',
      source: 'workforce',
      resource: { type: 'worker', id: record.id, name: record.manifest.name },
      metadata: {
        version: record.version,
        author: record.manifest.author,
        state: record.state,
        role: record.manifest.role,
      },
    });
  }

  private fail(errors: string[]): InstallResult {
    return { ok: false, errors, summary: null };
  }

  private done(record: StoredInstall): InstallResult {
    return { ok: true, errors: [], summary: this.toSummary(record) };
  }
}
