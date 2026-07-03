/**
 * Marketplace publishing pipeline — pure functions for the two security-critical
 * steps: a static **security scan** of a package manifest, and **digital signing**
 * of the manifest digest with an Ed25519 key. No I/O; the store holds the signing
 * key and orchestrates the submission lifecycle around these.
 */
import { createHash, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ListingManifest, PackageSignature, ScanFinding, ScanResult, ScanSeverity } from '@neuropause/shared';

/** Permissions considered dangerous and requiring elevated review. */
const DANGEROUS_PERMISSIONS = new Set([
  'system:exec',
  'system:shell',
  'fs:write:all',
  'fs:read:all',
  'secrets:read',
  'credentials:read',
  'network:raw',
  'process:spawn',
]);

const SEVERITY_RANK: Record<ScanSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function finding(rule: string, severity: ScanSeverity, message: string): ScanFinding {
  return { id: `sf_${randomUUID()}`, rule, severity, message };
}

/** A deterministic static security scan over a package manifest. */
export function securityScan(manifest: ListingManifest, now = new Date().toISOString()): ScanResult {
  const findings: ScanFinding[] = [];

  if (!manifest.entry || manifest.entry.trim() === '') {
    findings.push(finding('entry.missing', 'critical', 'Manifest declares no entry point.'));
  }

  for (const p of manifest.permissions) {
    if (DANGEROUS_PERMISSIONS.has(p)) {
      findings.push(finding('permission.dangerous', 'high', `Requests dangerous permission "${p}".`));
    }
  }

  const usesNetwork = manifest.capabilities.includes('network') || manifest.permissions.some((p) => p.startsWith('network'));
  if (usesNetwork && manifest.network.length === 0) {
    findings.push(finding('network.undeclared', 'medium', 'Uses network capability without declaring any allowed domains.'));
  }

  for (const dep of manifest.dependencies) {
    if (dep.includes('..') || dep.startsWith('/') || dep.startsWith('file:') || dep.startsWith('http:')) {
      findings.push(finding('dependency.suspicious', 'high', `Suspicious dependency reference "${dep}".`));
    }
  }

  if (manifest.permissions.length > 8) {
    findings.push(finding('permission.excessive', 'low', `Requests ${manifest.permissions.length} permissions; review least-privilege.`));
  }

  if (!manifest.metadata.publisher) {
    findings.push(finding('metadata.publisher', 'info', 'No publisher declared in metadata.'));
  }

  const max = findings.reduce((m, f) => Math.max(m, SEVERITY_RANK[f.severity]), 0);
  const status = max >= SEVERITY_RANK.high ? 'fail' : max >= SEVERITY_RANK.low ? 'warn' : 'pass';

  return { status, findings, scannedAt: now, scanner: 'neuropause-static-scan/1' };
}

/** Canonical JSON for a manifest — stable key order so digests are reproducible. */
export function canonicalManifest(manifest: ListingManifest): string {
  const ordered = {
    capabilities: [...manifest.capabilities].sort(),
    dependencies: [...manifest.dependencies].sort(),
    entry: manifest.entry,
    kind: manifest.kind,
    metadata: Object.fromEntries(Object.entries(manifest.metadata).sort(([a], [b]) => a.localeCompare(b))),
    name: manifest.name,
    network: [...manifest.network].sort(),
    permissions: [...manifest.permissions].sort(),
    version: manifest.version,
  };
  return JSON.stringify(ordered);
}

export function digestManifest(manifest: ListingManifest): string {
  return createHash('sha256').update(canonicalManifest(manifest)).digest('hex');
}

/** Sign a manifest's digest with an Ed25519 private key. */
export function signManifest(manifest: ListingManifest, privateKey: KeyObject, keyId: string, now = new Date().toISOString()): PackageSignature {
  const digest = digestManifest(manifest);
  const signature = edSign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
  return { algorithm: 'ed25519', keyId, digest, signature, signedAt: now };
}

/** Verify a manifest signature against an Ed25519 public key. */
export function verifyManifest(manifest: ListingManifest, sig: PackageSignature, publicKey: KeyObject): boolean {
  if (sig.algorithm !== 'ed25519') return false;
  const digest = digestManifest(manifest);
  if (digest !== sig.digest) return false;
  try {
    return edVerify(null, Buffer.from(digest, 'hex'), publicKey, Buffer.from(sig.signature, 'base64'));
  } catch {
    return false;
  }
}
