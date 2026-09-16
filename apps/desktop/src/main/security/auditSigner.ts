/**
 * S111 harvest (H5) — Ed25519 signing for the canonical audit chain.
 *
 * HARVESTED (adapted, not imported) from packages/security/src/keys.ts `ed25519Signer()` — whose own
 * comment says "real signing keys for the audit chain". The source package is unwired and on the
 * parallel @neuropause/* spine, so importing it would be a second security system (S110/S111 Rule);
 * only the Ed25519 sign/verify capability is harvested here, re-implemented over node:crypto.
 *
 * WHY: the live `AuditChain` (security/auditChain.ts) is a SHA-256 hash chain whose own threat model
 * is honest about its gap — "a local attacker with write access to BOTH the entries and the persisted
 * head can still forge a consistent chain." A DIGITAL SIGNATURE over the chain head closes exactly
 * that gap: forging entries + head is not enough, because the attacker does not hold the private key,
 * so the signature over the forged head will not verify. This module STRENGTHENS the existing chain —
 * it does NOT replace it and creates no second audit system.
 *
 * SCOPE (H5 = signing only; H6 = key storage/rotation, deliberately separate): this module is a PURE
 * sign/verify capability over injected keys. It does NOT store, provision, or rotate keys, and it
 * NEVER embeds key material. Durable private-key storage (OS keychain via secureStore) + rotation is
 * H6 and is the gated follow-up that makes live audit signing production-real. Until then this proves
 * the gap is closed WHENEVER a durable key is provisioned.
 *
 * NOT AUTHORITY: verification returns a boolean about integrity — never a permission. This module has
 * no import path to authz/cst/command-bus/store; a signature can never grant or bypass authority.
 * Fail-closed: any verification error, unknown key, or version mismatch → NOT verified.
 */
import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey } from 'node:crypto';

export const AUDIT_SIGNATURE_ALG = 'Ed25519' as const;

/** The anchor a signature binds to: the chain's identity (namespace = tenant/log) + algo + head. */
export interface AuditAnchor {
  /** the audit chain namespace — binds the signature to one tenant/log (see auditChain.auditGenesis). */
  namespace: string;
  /** the hash-chain algorithm label (e.g. 'sha256-chain-v1'). */
  chainAlgo: string;
  /** the chain head being attested (AuditChain.snapshot().head). */
  head: string;
}

export interface AuditSigningKey {
  keyId: string;
  version: number;
  algorithm: typeof AUDIT_SIGNATURE_ALG;
  privateKeyPem: string;
  publicKeyPem: string;
}

/** Public half only — safe to distribute for verification (carries NO private material). */
export interface AuditVerificationKey {
  keyId: string;
  version: number;
  algorithm: typeof AUDIT_SIGNATURE_ALG;
  publicKeyPem: string;
}

export interface SignedAuditHead {
  keyId: string;
  version: number;
  algorithm: typeof AUDIT_SIGNATURE_ALG;
  /** base64 Ed25519 signature over canonicalAuditAnchor(anchor). NO private material. */
  signature: string;
  signedAt: number;
}

/**
 * Generate an Ed25519 signing key with identity + version metadata. For tests/authoring; live durable
 * storage of the privateKeyPem is H6 (OS keychain), never plaintext, never to the renderer.
 */
export function generateAuditSigningKey(keyId: string, version = 1, now = Date.now()): AuditSigningKey {
  void now;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    version,
    algorithm: AUDIT_SIGNATURE_ALG,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function verificationKeyOf(key: AuditSigningKey): AuditVerificationKey {
  return { keyId: key.keyId, version: key.version, algorithm: key.algorithm, publicKeyPem: key.publicKeyPem };
}

/** Deterministic canonical bytes of the anchor — fixed field order; the exact thing signed/verified. */
export function canonicalAuditAnchor(anchor: AuditAnchor): string {
  return `neuropause-audit-sig:v1\nnamespace=${anchor.namespace}\nchainAlgo=${anchor.chainAlgo}\nhead=${anchor.head}`;
}

/** Sign a chain head with an Ed25519 private key. Binds keyId/version + the namespace-scoped anchor. */
export function signAuditHead(privateKeyPem: string, key: { keyId: string; version: number }, anchor: AuditAnchor, now = Date.now()): SignedAuditHead {
  const data = Buffer.from(canonicalAuditAnchor(anchor));
  const signature = edSign(null, data, privateKeyPem).toString('base64');
  return { keyId: key.keyId, version: key.version, algorithm: AUDIT_SIGNATURE_ALG, signature, signedAt: now };
}

/**
 * FAIL-CLOSED verification. Returns true ONLY when: the signed metadata names a key we hold at the
 * exact version, the algorithm matches, and the Ed25519 signature verifies over the canonical anchor.
 * Any unknown key, version mismatch, wrong tenant/namespace (⇒ different anchor bytes), forged
 * signature, or thrown error → false. Never throws.
 */
export function verifyAuditHead(verificationKeys: readonly AuditVerificationKey[], anchor: AuditAnchor, signed: SignedAuditHead): boolean {
  try {
    if (!signed || signed.algorithm !== AUDIT_SIGNATURE_ALG || typeof signed.signature !== 'string') return false;
    const key = verificationKeys.find((k) => k.keyId === signed.keyId && k.version === signed.version && k.algorithm === AUDIT_SIGNATURE_ALG);
    if (!key) return false; // unknown key id OR wrong key version → fail closed
    const pub = createPublicKey(key.publicKeyPem);
    const data = Buffer.from(canonicalAuditAnchor(anchor));
    return edVerify(null, data, pub, Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}
