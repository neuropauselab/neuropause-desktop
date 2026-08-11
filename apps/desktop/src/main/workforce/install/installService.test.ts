/**
 * P8.5 — worker install lifecycle. Install → registered + governed; enable/disable
 * gate execution; update retains the prior version; rollback restores it; uninstall
 * removes it; installs survive a restart; and an installed worker is governed
 * identically to a built-in (mutating skills still require approval).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkerPackage, WorkerPackageManifest } from '@neuropause/shared';
import { generateSigningKeyPair, registerTrustedKey } from '../../nps/signature';
import { WorkerRegistry } from '../registry/workerRegistry';
import { AuditLog } from '../governance/auditLog';
import { GovernanceRuntime } from '../governance';
import { JobStore } from '../runtime/jobStore';
import { WorkerRuntime } from '../runtime/workerRuntime';
import type { WorkforceData } from '../sdk';
import { InstallStore } from './installStore';
import { WorkerInstallService } from './installService';
import { composeInstalledWorker } from './manifest';
import { digestManifest, packWorker } from './packaging';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

const NOW = '2026-07-15T00:00:00.000Z';
const pair = generateSigningKeyPair();
const KEY_ID = 'wpkg_test_service';
registerTrustedKey(KEY_ID, pair.publicKeyPem);

const stores: Array<{ flush: () => Promise<void> }> = [];
const paths: string[] = [];
function tempPath(): string {
  const p = join(tmpdir(), `nps-install-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function advisoryManifest(over: Partial<WorkerPackageManifest> = {}): WorkerPackageManifest {
  return {
    id: 'worker:pkg-acme-ops',
    name: 'Acme Ops',
    version: '1.0.0',
    author: 'Acme',
    description: 'Ops helper',
    role: 'operations',
    memoryScope: 'self',
    goals: ['Help ops'],
    capabilities: ['review'],
    permissions: ['read:entities', 'read:timeline'],
    skills: [{ kind: 'advisory', id: 'review-ops', label: 'operations' }],
    dependencies: [],
    engine: { neuropause: '^1.0.0' },
    ...over,
  };
}

function infraManifest(): WorkerPackageManifest {
  return advisoryManifest({
    id: 'worker:pkg-acme-infra',
    name: 'Acme Infra',
    role: 'infrastructure',
    permissions: ['read:timeline', 'execute:action'],
    skills: [
      { kind: 'infra', id: 'stop-x', label: 'Stop instance', target: 'aws', actionId: 'aws_ec2_stop', required: ['instanceId'], refKey: 'instanceId' },
    ],
  });
}

function sign(m: WorkerPackageManifest): WorkerPackage {
  return packWorker(m, KEY_ID, pair.privateKeyPem);
}

async function setup(): Promise<{
  registry: WorkerRegistry;
  store: InstallStore;
  service: WorkerInstallService;
  events: string[];
}> {
  const registry = new WorkerRegistry(tempPath());
  const store = new InstallStore(tempPath());
  stores.push(registry, store);
  await registry.load();
  const events: string[] = [];
  const service = new WorkerInstallService({
    store,
    registry,
    appVersion: '1.0.0',
    publish: (e) => events.push(e.type),
    clock: () => NOW,
  });
  await service.load();
  return { registry, store, service, events };
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('WorkerInstallService lifecycle', () => {
  it('installs a signed package: registered (builtIn:false), skills resolvable, event emitted', async () => {
    const { registry, service, events } = await setup();
    const r = service.install(sign(advisoryManifest()));
    expect(r.ok).toBe(true);
    expect(r.summary?.version).toBe('1.0.0');
    const worker = registry.get('worker:pkg-acme-ops');
    expect(worker?.builtIn).toBe(false);
    expect(worker?.metadata.source).toBe('installed');
    expect(service.skillsFor('worker:pkg-acme-ops')?.has('review-ops')).toBe(true);
    expect(service.listInstalls()).toHaveLength(1);
    expect(events).toContain('worker.installed');
  });

  it('rejects an invalid (unsigned) package', async () => {
    const { service, registry } = await setup();
    const pkg = sign(advisoryManifest());
    const r = service.install({ ...pkg, signature: null, signatureKeyId: null });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(registry.get('worker:pkg-acme-ops')).toBeNull();
  });

  it('rejects installing over a built-in id (namespace guard)', async () => {
    const { service } = await setup();
    const r = service.install(sign(advisoryManifest({ id: 'worker:founder' })));
    expect(r.ok).toBe(false);
  });

  it('rejects a duplicate install', async () => {
    const { service } = await setup();
    service.install(sign(advisoryManifest()));
    const again = service.install(sign(advisoryManifest()));
    expect(again.ok).toBe(false);
    expect(again.errors[0]).toContain('already installed');
  });

  it('disable removes skills (runtime cannot resolve); enable restores them', async () => {
    const { registry, service } = await setup();
    service.install(sign(advisoryManifest()));
    service.disable('worker:pkg-acme-ops');
    expect(service.skillsFor('worker:pkg-acme-ops')).toBeNull();
    expect(registry.get('worker:pkg-acme-ops')?.lifecycle).toBe('paused');
    service.enable('worker:pkg-acme-ops');
    expect(service.skillsFor('worker:pkg-acme-ops')?.has('review-ops')).toBe(true);
    expect(registry.get('worker:pkg-acme-ops')?.lifecycle).toBe('idle');
  });

  it('updates to a new version and retains the previous for rollback', async () => {
    const { registry, service } = await setup();
    service.install(sign(advisoryManifest({ version: '1.0.0' })));
    const up = service.update(sign(advisoryManifest({ version: '1.1.0', description: 'v2' })));
    expect(up.ok).toBe(true);
    expect(registry.get('worker:pkg-acme-ops')?.identity.version).toBe('1.1.0');
    const summary = service.listInstalls()[0];
    expect(summary.version).toBe('1.1.0');
    expect(summary.canRollback).toBe(true);
  });

  it('rolls back to the previous version and consumes it', async () => {
    const { registry, service, events } = await setup();
    service.install(sign(advisoryManifest({ version: '1.0.0' })));
    service.update(sign(advisoryManifest({ version: '2.0.0' })));
    const rb = service.rollback('worker:pkg-acme-ops');
    expect(rb.ok).toBe(true);
    expect(registry.get('worker:pkg-acme-ops')?.identity.version).toBe('1.0.0');
    expect(service.listInstalls()[0].canRollback).toBe(false);
    expect(events).toContain('worker.rolled_back');
    // No further rollback available.
    expect(service.rollback('worker:pkg-acme-ops').ok).toBe(false);
  });

  it('uninstalls: removed from the registry, store, and skill map', async () => {
    const { registry, store, service } = await setup();
    service.install(sign(advisoryManifest()));
    const r = service.uninstall('worker:pkg-acme-ops');
    expect(r.ok).toBe(true);
    expect(registry.get('worker:pkg-acme-ops')).toBeNull();
    expect(store.get('worker:pkg-acme-ops')).toBeNull();
    expect(service.skillsFor('worker:pkg-acme-ops')).toBeNull();
  });

  it('survives a restart: a fresh service re-registers persisted installs', async () => {
    const storePath = tempPath();
    const store1 = new InstallStore(storePath);
    const registry1 = new WorkerRegistry(tempPath());
    stores.push(store1, registry1);
    await registry1.load();
    const svc1 = new WorkerInstallService({ store: store1, registry: registry1, appVersion: '1.0.0', clock: () => NOW });
    await svc1.load();
    svc1.install(sign(advisoryManifest()));
    await store1.flush();

    // Fresh process: new store bound to the SAME file + a fresh registry.
    const store2 = new InstallStore(storePath);
    const registry2 = new WorkerRegistry(tempPath());
    stores.push(store2, registry2);
    await registry2.load();
    const svc2 = new WorkerInstallService({ store: store2, registry: registry2, appVersion: '1.0.0', clock: () => NOW });
    await svc2.load();
    expect(registry2.get('worker:pkg-acme-ops')?.builtIn).toBe(false);
    expect(svc2.skillsFor('worker:pkg-acme-ops')?.has('review-ops')).toBe(true);
  });

  it('refuses to uninstall a package another install depends on', async () => {
    const { service } = await setup();
    service.install(sign(advisoryManifest({ id: 'worker:pkg-base' })));
    service.install(sign(advisoryManifest({ id: 'worker:pkg-app', dependencies: ['worker:pkg-base'] })));
    const r = service.uninstall('worker:pkg-base');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('required by');
    // Removing the dependent first, then the base, is allowed.
    expect(service.uninstall('worker:pkg-app').ok).toBe(true);
    expect(service.uninstall('worker:pkg-base').ok).toBe(true);
  });

  it('load re-verifies signatures — a tampered store record is NOT registered', async () => {
    const storePath = tempPath();
    const store1 = new InstallStore(storePath);
    stores.push(store1);
    await store1.load();
    const legit = sign(advisoryManifest());
    // Tamper the manifest (recompute the checksum), but keep the signature over the ORIGINAL.
    const tampered = advisoryManifest({ role: 'executive' });
    store1.put({
      id: 'worker:pkg-acme-ops',
      version: '1.0.0',
      state: 'enabled',
      manifest: tampered,
      checksum: digestManifest(tampered),
      signatureKeyId: legit.signatureKeyId,
      signature: legit.signature,
      previous: null,
      installedAt: NOW,
      updatedAt: NOW,
    });
    await store1.flush();

    const registry2 = new WorkerRegistry(tempPath());
    const store2 = new InstallStore(storePath);
    stores.push(registry2, store2);
    await registry2.load();
    const svc2 = new WorkerInstallService({ store: store2, registry: registry2, appVersion: '1.0.0', clock: () => NOW });
    await svc2.load();
    expect(registry2.get('worker:pkg-acme-ops')).toBeNull();
    expect(svc2.skillsFor('worker:pkg-acme-ops')).toBeNull();
  });

  it('load reconciles a ghost installed worker with no backing store record', async () => {
    const registry = new WorkerRegistry(tempPath());
    const store = new InstallStore(tempPath());
    stores.push(registry, store);
    await registry.load();
    // A builtIn:false worker in the registry that the store does not back.
    registry.register(composeInstalledWorker(advisoryManifest()));
    expect(registry.get('worker:pkg-acme-ops')).not.toBeNull();
    const svc = new WorkerInstallService({ store, registry, appVersion: '1.0.0', clock: () => NOW });
    await svc.load();
    expect(registry.get('worker:pkg-acme-ops')).toBeNull();
  });

  it('scales to many installed packages with O(1) skill lookup', async () => {
    const { registry, service } = await setup();
    const N = 300;
    for (let i = 0; i < N; i++) {
      service.install(sign(advisoryManifest({ id: `worker:pkg-scale-${i}`, name: `Scale ${i}` })));
    }
    expect(service.listInstalls().length).toBe(N);
    expect(service.skillsFor('worker:pkg-scale-0')?.has('review-ops')).toBe(true);
    expect(service.skillsFor('worker:pkg-scale-299')?.has('review-ops')).toBe(true);
    expect(registry.get('worker:pkg-scale-150')).not.toBeNull();
  });
});

describe('installed workers are governed identically to built-ins', () => {
  async function runtimeSetup(): Promise<{ registry: WorkerRegistry; service: WorkerInstallService; runtime: WorkerRuntime }> {
    const registry = new WorkerRegistry(tempPath());
    const store = new InstallStore(tempPath());
    const audit = new AuditLog(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
    const jobs = new JobStore(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
    stores.push(registry, store, audit, jobs);
    await registry.load();
    await audit.load();
    await jobs.load();
    const service = new WorkerInstallService({ store, registry, appVersion: '1.0.0', clock: () => NOW });
    await service.load();
    let c = 0;
    const data: WorkforceData = { now: NOW, entities: [], events: [], memories: [], neighbors: () => [] };
    const runtime = new WorkerRuntime({
      registry,
      governance: new GovernanceRuntime(audit),
      jobs,
      dataProvider: () => data,
      skillsFor: (id) => service.skillsFor(id),
      newId: () => `id-${++c}`,
      clock: () => NOW,
    });
    return { registry, service, runtime };
  }

  it('an installed executable (infra) skill still parks for human approval', async () => {
    const { service, runtime } = await runtimeSetup();
    service.install(sign(infraManifest()));
    const job = runtime.runJob({ workerId: 'worker:pkg-acme-infra', skillId: 'stop-x', input: { instanceId: 'i-0abc' } });
    expect(job.status).toBe('awaiting_approval');
    expect(job.proposals[0].verdict.decision).toBe('require_approval');
    expect(job.proposals[0].execution).toMatchObject({ executor: 'infra', target: 'aws', actionId: 'aws_ec2_stop' });
  });

  it('a disabled installed worker cannot run (no resolvable skill)', async () => {
    const { service, runtime } = await runtimeSetup();
    service.install(sign(infraManifest()));
    service.disable('worker:pkg-acme-infra');
    const job = runtime.runJob({ workerId: 'worker:pkg-acme-infra', skillId: 'stop-x', input: { instanceId: 'i-1' } });
    expect(job.status).toBe('failed');
    expect(job.error).toContain('no skill');
  });
});
