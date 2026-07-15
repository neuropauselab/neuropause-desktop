/**
 * P8.5 — worker package validation. A well-formed, signed, compatible, least-privilege
 * package passes; every attack vector / malformed field is rejected with a clear error.
 */
import { describe, expect, it } from 'vitest';
import type { WorkerPackage, WorkerPackageManifest } from '@neuropause/shared';
import { generateSigningKeyPair, registerTrustedKey } from '../../nps/signature';
import { packWorker } from './packaging';
import {
  composeInstalledWorker,
  validateWorkerPackage,
  type PackageValidationContext,
} from './manifest';

const pair = generateSigningKeyPair();
const KEY_ID = 'wpkg_test_manifest';
registerTrustedKey(KEY_ID, pair.publicKeyPem);

function manifest(over: Partial<WorkerPackageManifest> = {}): WorkerPackageManifest {
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

function sign(m: WorkerPackageManifest): WorkerPackage {
  return packWorker(m, KEY_ID, pair.privateKeyPem);
}

const ctx = (over: Partial<PackageValidationContext> = {}): PackageValidationContext => ({
  appVersion: '1.0.0',
  isBuiltIn: () => false,
  isInstalled: () => false,
  ...over,
});

describe('validateWorkerPackage', () => {
  it('accepts a well-formed, signed, compatible, least-privilege package', () => {
    const r = validateWorkerPackage(sign(manifest()), ctx());
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it('rejects a non-namespaced id (collision protection by construction)', () => {
    const r = validateWorkerPackage(sign(manifest({ id: 'worker:founder' })), ctx());
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('namespaced'))).toBe(true);
  });

  it('rejects a built-in id collision explicitly', () => {
    const r = validateWorkerPackage(sign(manifest()), ctx({ isBuiltIn: (id) => id === 'worker:pkg-acme-ops' }));
    expect(r.errors.some((e) => e.includes('collides with a built-in'))).toBe(true);
  });

  it('rejects an incompatible engine range', () => {
    const r = validateWorkerPackage(sign(manifest({ engine: { neuropause: '^2.0.0' } })), ctx());
    expect(r.errors.some((e) => e.includes('incompatible engine'))).toBe(true);
  });

  it('rejects a tampered package (verification fails)', () => {
    const pkg = sign(manifest());
    const tampered = { ...pkg, manifest: { ...pkg.manifest, version: '1.2.3' } };
    const r = validateWorkerPackage(tampered, ctx());
    expect(r.errors.some((e) => e.includes('verification failed'))).toBe(true);
  });

  it('rejects an unsigned package', () => {
    const pkg = sign(manifest());
    const r = validateWorkerPackage({ ...pkg, signature: null, signatureKeyId: null }, ctx());
    expect(r.errors.some((e) => e.includes('verification failed'))).toBe(true);
  });

  it('rejects a bad version', () => {
    const r = validateWorkerPackage(sign(manifest({ version: '1.0' })), ctx());
    expect(r.errors.some((e) => e.includes('x.y.z'))).toBe(true);
  });

  it('rejects a permission scope a skill needs but the manifest did not declare', () => {
    // An infra skill requires read:timeline + execute:action; only read:timeline declared.
    const m = manifest({
      skills: [{ kind: 'infra', id: 'stop-x', label: 'Stop instance', target: 'aws', actionId: 'aws_ec2_stop', required: ['instanceId'], refKey: 'instanceId' }],
      permissions: ['read:timeline'],
    });
    const r = validateWorkerPackage(sign(m), ctx());
    expect(r.errors.some((e) => e.includes('execute:action') && e.includes('not declared'))).toBe(true);
  });

  it('rejects an unknown declared permission scope', () => {
    const m = manifest({ permissions: ['read:entities', 'read:timeline', 'root:all' as never] });
    const r = validateWorkerPackage(sign(m), ctx());
    expect(r.errors.some((e) => e.includes('unknown permission scope'))).toBe(true);
  });

  it('rejects an infra skill missing required config', () => {
    const m = manifest({
      skills: [{ kind: 'infra', id: 'x', label: 'Do', required: ['a'], refKey: 'a' }],
      permissions: ['read:timeline', 'execute:action'],
    });
    const r = validateWorkerPackage(sign(m), ctx());
    expect(r.errors.some((e) => e.includes('missing "target"'))).toBe(true);
    expect(r.errors.some((e) => e.includes('missing "actionId"'))).toBe(true);
  });

  it('rejects an unknown role', () => {
    const r = validateWorkerPackage(sign(manifest({ role: 'overlord' as never })), ctx());
    expect(r.errors.some((e) => e.includes('unknown role'))).toBe(true);
  });

  it('rejects an unknown memoryScope', () => {
    const r = validateWorkerPackage(sign(manifest({ memoryScope: 'galaxy' as never })), ctx());
    expect(r.errors.some((e) => e.includes('unknown memoryScope'))).toBe(true);
  });

  it('rejects a missing dependency and a self-dependency', () => {
    const missing = validateWorkerPackage(sign(manifest({ dependencies: ['worker:pkg-other'] })), ctx());
    expect(missing.errors.some((e) => e.includes('missing dependency'))).toBe(true);
    const self = validateWorkerPackage(sign(manifest({ dependencies: ['worker:pkg-acme-ops'] })), ctx());
    expect(self.errors.some((e) => e.includes('cannot depend on itself'))).toBe(true);
  });

  it('accepts a dependency that is already installed', () => {
    const r = validateWorkerPackage(
      sign(manifest({ dependencies: ['worker:pkg-base'] })),
      ctx({ isInstalled: (id) => id === 'worker:pkg-base' }),
    );
    expect(r.ok).toBe(true);
  });
});

describe('composeInstalledWorker', () => {
  it('builds a builtIn:false worker with least-privilege derived grants + provenance', () => {
    const def = composeInstalledWorker(manifest());
    expect(def.worker.builtIn).toBe(false);
    expect(def.worker.identity.id).toBe('worker:pkg-acme-ops');
    expect(def.worker.metadata.source).toBe('installed');
    expect(def.worker.metadata.author).toBe('Acme');
    // Derived grants are exactly what the advisory skill requires.
    const scopes = def.worker.permissions.filter((p) => p.granted).map((p) => p.scope).sort();
    expect(scopes).toEqual(['read:entities', 'read:timeline']);
    expect(def.skills.get('review-ops')).toBeDefined();
  });
});
