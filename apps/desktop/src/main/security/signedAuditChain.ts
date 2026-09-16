/**
 * S113 (FG-S112-AUDIT-KEY, non-frozen operationalization) — production wiring of the H5 Ed25519
 * signer to the H6 durable keychain, over the EXISTING canonical AuditChain. No second audit system,
 * no second key store.
 *
 * Flow: provision a durable Ed25519 signing key through the existing secret store (credentialStore /
 * safeStorage OS keychain) → sign the AuditChain's persisted snapshot HEAD (bound to namespace/tenant
 * + algorithm + keyId + version) → on restart, recover the key + verify. A tamper of entries, the
 * head, the signature, the key, the version, or the tenant fails closed. Verification is INTEGRITY
 * INFORMATION ONLY — it never grants authority (no import path to authz/cst/command-bus).
 *
 * Backward compatibility: a historical AuditChain with NO signature is honestly `UNSIGNED` — never a
 * fabricated signature, never a `VERIFICATION_FAILED`. Unsigned history is a truthful state.
 *
 * Private key material: lives ONLY in the OS keychain via the injected `SecretStore`. It is never put
 * in the renderer, an IPC payload, a normal application file, a log, or an audit record. Persisted
 * signature metadata (`SignedAuditHead`) carries only public keyId/version/signature.
 */
import type { AuditChain, AuditChainSnapshot } from './auditChain';
import type { SecretStore } from './durableKekProvider';
import {
  generateAuditSigningKey,
  signAuditHead,
  verifyAuditHead,
  type AuditSigningKey,
  type AuditVerificationKey,
  type SignedAuditHead,
  type AuditAnchor,
} from './auditSigner';

const SIGNING_KEY_ENTRY = 'neuropause.audit.signing-key.v1';

interface PersistedSigningKey {
  keyId: string;
  version: number;
  algorithm: 'Ed25519';
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * Durable Ed25519 audit-signing key over the existing secret store (OS keychain). Provisions once,
 * recovers on restart. Only the public half leaves this provider.
 */
export class DurableAuditKeyProvider {
  private key: AuditSigningKey | undefined;

  constructor(private readonly store: SecretStore, private readonly entryKey = SIGNING_KEY_ENTRY) {}

  /** Load the durable key if present. Fail-closed on corrupt data (treated as absent → UNSIGNED). */
  async load(): Promise<AuditSigningKey | undefined> {
    try {
      const raw = await this.store.get(this.entryKey);
      if (!raw) return undefined;
      const p = JSON.parse(raw) as PersistedSigningKey;
      if (p.algorithm !== 'Ed25519' || typeof p.privateKeyPem !== 'string' || typeof p.publicKeyPem !== 'string') return undefined;
      this.key = { keyId: p.keyId, version: p.version, algorithm: 'Ed25519', privateKeyPem: p.privateKeyPem, publicKeyPem: p.publicKeyPem };
      return this.key;
    } catch {
      return undefined; // corrupt keychain blob → no key (fail-closed; do NOT overwrite recoverable material)
    }
  }

  /** Provision the durable signing key if absent (idempotent); returns the active key. */
  async ensureKey(keyId = 'np-audit', now = Date.now()): Promise<AuditSigningKey> {
    if (this.key) return this.key;
    const existing = await this.load();
    if (existing) return existing;
    const key = generateAuditSigningKey(keyId, 1, now);
    const persisted: PersistedSigningKey = { keyId: key.keyId, version: key.version, algorithm: 'Ed25519', privateKeyPem: key.privateKeyPem, publicKeyPem: key.publicKeyPem };
    await this.store.set(this.entryKey, JSON.stringify(persisted));
    this.key = key;
    return key;
  }

  /** The public verification key only — safe to hand to a verifier. */
  verificationKey(): AuditVerificationKey | undefined {
    return this.key ? { keyId: this.key.keyId, version: this.key.version, algorithm: 'Ed25519', publicKeyPem: this.key.publicKeyPem } : undefined;
  }
  signingKey(): AuditSigningKey | undefined {
    return this.key;
  }
}

export type AuditIntegrityState = 'SIGNED' | 'UNSIGNED' | 'VERIFICATION_FAILED';

export interface AuditIntegrityStatus {
  state: AuditIntegrityState;
  /** the hash-chain check (entries recompute to head). */
  chainOk: boolean;
  /** the signature check (present ⇒ verified over the current head). undefined when unsigned. */
  signatureOk?: boolean;
  algorithm?: string;
  keyId?: string;
  keyVersion?: number;
  head: string;
  detail: string;
}

/** Build the anchor a signature binds to, from an AuditChain snapshot. */
export function anchorFromSnapshot(namespace: string, snapshot: AuditChainSnapshot): AuditAnchor {
  return { namespace, chainAlgo: snapshot.algo, head: snapshot.head };
}

/** Sign an AuditChain's current head with the durable key. Returns the signature metadata to persist. */
export function signAuditChainHead<T>(key: AuditSigningKey, namespace: string, chain: AuditChain<T>): SignedAuditHead {
  return signAuditHead(key.privateKeyPem, key, anchorFromSnapshot(namespace, chain.snapshot()));
}

/**
 * Verify an AuditChain's integrity: the hash chain over `entries` AND (if a signature is present) the
 * Ed25519 signature over the current head. Fail-closed. Backward-compatible: no signature ⇒ UNSIGNED.
 */
export function verifyAuditChainIntegrity<T>(
  namespace: string,
  chain: AuditChain<T>,
  entries: readonly T[],
  verificationKeys: readonly AuditVerificationKey[],
  signed: SignedAuditHead | undefined,
): AuditIntegrityStatus {
  const snapshot = chain.snapshot();
  const chainOk = chain.verify(entries).ok;
  if (!signed) {
    return { state: 'UNSIGNED', chainOk, head: snapshot.head, detail: chainOk ? 'hash chain intact; no signature on record (unsigned history)' : 'hash chain FAILED; unsigned' };
  }
  const signatureOk = verifyAuditHead(verificationKeys, anchorFromSnapshot(namespace, snapshot), signed);
  const ok = chainOk && signatureOk;
  return {
    state: ok ? 'SIGNED' : 'VERIFICATION_FAILED',
    chainOk,
    signatureOk,
    algorithm: signed.algorithm,
    keyId: signed.keyId,
    keyVersion: signed.version,
    head: snapshot.head,
    detail: ok
      ? 'hash chain intact AND signature verifies over the current head'
      : `integrity FAILED (chainOk=${chainOk}, signatureOk=${signatureOk})`,
  };
}
