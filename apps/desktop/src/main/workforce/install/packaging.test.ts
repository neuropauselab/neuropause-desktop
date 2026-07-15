/**
 * P8.5 — worker package integrity + signature. Checksum is reproducible, a signed
 * first-party package verifies, and tampering / untrusted / unsigned packages are
 * rejected.
 */
import { describe, expect, it } from 'vitest';
import type { WorkerPackageManifest } from '@neuropause/shared';
import { generateSigningKeyPair, registerTrustedKey } from '../../nps/signature';
import { canonicalize, digestManifest, packWorker, verifyWorkerPackage } from './packaging';

const pair = generateSigningKeyPair();
const KEY_ID = 'wpkg_test_packaging';
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

describe('worker package packaging', () => {
  it('produces a reproducible digest independent of key order', () => {
    const a = manifest();
    const b: WorkerPackageManifest = { engine: { neuropause: '^1.0.0' }, id: 'worker:pkg-acme-ops', ...manifest() };
    expect(digestManifest(a)).toBe(digestManifest(b));
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('packs and verifies a first-party signed package', () => {
    const pkg = packWorker(manifest(), KEY_ID, pair.privateKeyPem);
    expect(pkg.checksum).toBe(digestManifest(manifest()));
    expect(verifyWorkerPackage(pkg)).toEqual({ ok: true, reason: 'ok' });
  });

  it('rejects a tampered manifest (checksum mismatch)', () => {
    const pkg = packWorker(manifest(), KEY_ID, pair.privateKeyPem);
    const tampered = { ...pkg, manifest: { ...pkg.manifest, version: '9.9.9' } };
    expect(verifyWorkerPackage(tampered)).toEqual({ ok: false, reason: 'checksum_mismatch' });
  });

  it('rejects an unsigned package', () => {
    const m = manifest();
    const pkg = { manifest: m, checksum: digestManifest(m), signatureKeyId: null, signature: null };
    expect(verifyWorkerPackage(pkg)).toMatchObject({ ok: false, reason: 'signature_no_signature' });
  });

  it('rejects a signature from an untrusted key', () => {
    const other = generateSigningKeyPair();
    const forged = packWorker(manifest(), 'wpkg_not_trusted', other.privateKeyPem);
    expect(verifyWorkerPackage(forged)).toMatchObject({ ok: false, reason: 'signature_no_trusted_key' });
  });

  it('rejects a valid-key signature over the WRONG digest', () => {
    // Correct trusted key, but the signature is over a different manifest's checksum.
    const pkg = packWorker(manifest({ version: '2.0.0' }), KEY_ID, pair.privateKeyPem);
    const swapped = { ...pkg, manifest: manifest({ version: '2.0.0' }), checksum: digestManifest(manifest()) };
    // checksum no longer matches the manifest → caught before signature.
    expect(verifyWorkerPackage(swapped).ok).toBe(false);
  });
});
