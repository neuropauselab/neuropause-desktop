/**
 * P8.5 — Worker package integrity + signature.
 *
 * A worker package is content-hashed (SHA-256 over the canonical manifest) and the
 * hash is Ed25519-signed by a trusted publisher key. This reuses the existing crypto
 * primitives — `nps/signature.ts` (Ed25519 trust store) and Node's `createHash` —
 * so there is NO new crypto and NO new PKI. The host verifies the checksum and the
 * signature (against a registered trusted key) before an install proceeds.
 */
import { createHash } from 'node:crypto';
import type { WorkerPackage, WorkerPackageManifest } from '@neuropause/shared';
import { signData, verifySignature } from '../../nps/signature';

/** Recursively sort object keys (arrays keep order) so the digest is reproducible. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]));
  }
  return value;
}

/** Stable, canonical JSON for a manifest (key-order independent). */
export function canonicalize(manifest: WorkerPackageManifest): string {
  return JSON.stringify(sortKeys(manifest));
}

/** The package checksum: SHA-256 hex of the canonical manifest. */
export function digestManifest(manifest: WorkerPackageManifest): string {
  return createHash('sha256').update(canonicalize(manifest)).digest('hex');
}

/** Produce a signed package from a manifest (first-party publishing helper). */
export function packWorker(
  manifest: WorkerPackageManifest,
  keyId: string,
  privateKeyPem: string,
): WorkerPackage {
  const checksum = digestManifest(manifest);
  const signature = signData(Buffer.from(checksum, 'hex'), privateKeyPem);
  return { manifest, checksum, signatureKeyId: keyId, signature };
}

export interface PackageVerification {
  ok: boolean;
  /** 'ok' | 'checksum_mismatch' | 'signature_<reason>' */
  reason: string;
}

/**
 * Verify a package end to end: the checksum must match the manifest's true digest,
 * and the signature must verify against a TRUSTED key. Both must pass — a valid
 * checksum with an untrusted/absent signature is rejected.
 */
export function verifyWorkerPackage(pkg: WorkerPackage): PackageVerification {
  const expected = digestManifest(pkg.manifest);
  if (expected !== pkg.checksum) return { ok: false, reason: 'checksum_mismatch' };
  const sig = verifySignature(Buffer.from(pkg.checksum, 'hex'), pkg.signature, pkg.signatureKeyId);
  if (!sig.verified) return { ok: false, reason: `signature_${sig.reason}` };
  return { ok: true, reason: 'ok' };
}
