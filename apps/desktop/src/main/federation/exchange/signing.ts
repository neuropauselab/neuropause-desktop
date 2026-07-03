/**
 * Organization-exchange signing (pure-ish). Real Ed25519 digital signatures over
 * a canonical artifact manifest — the same primitive the Phase 8 marketplace
 * uses. A signed artifact proves provenance (which org published it) and
 * integrity (the bytes have not changed) before another org consumes it.
 */
import { createHash, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import type { ArtifactSignature } from '@neuropause/shared';

export interface SignableManifest {
  kind: string;
  name: string;
  version: string;
  scope: string;
  publisherOrg: string;
}

function canonical(m: SignableManifest): string {
  return JSON.stringify({ kind: m.kind, name: m.name, publisherOrg: m.publisherOrg, scope: m.scope, version: m.version });
}

export function digestManifest(m: SignableManifest): string {
  return createHash('sha256').update(canonical(m)).digest('hex');
}

export function signArtifact(m: SignableManifest, privateKey: KeyObject, keyId: string, now = new Date().toISOString()): ArtifactSignature {
  const digest = digestManifest(m);
  const signature = edSign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
  return { algorithm: 'ed25519', keyId, digest, signature, signedAt: now };
}

export function verifyArtifact(m: SignableManifest, sig: ArtifactSignature, publicKey: KeyObject): boolean {
  if (sig.algorithm !== 'ed25519') return false;
  const digest = digestManifest(m);
  if (digest !== sig.digest) return false;
  try {
    return edVerify(null, Buffer.from(digest, 'hex'), publicKey, Buffer.from(sig.signature, 'base64'));
  } catch {
    return false;
  }
}
