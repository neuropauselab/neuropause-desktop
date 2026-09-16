/**
 * S113 — operational H5+H6: durable Ed25519 key over the keychain, signing the live AuditChain head.
 * Proves the full flow (provision → sign → restart → recover → verify) + the tamper matrix, fail-closed,
 * tenant-isolated, backward-compatible with unsigned history, integrity-only (never authority).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditChain } from './auditChain';
import type { SecretStore } from './durableKekProvider';
import {
  DurableAuditKeyProvider,
  signAuditChainHead,
  verifyAuditChainIntegrity,
} from './signedAuditChain';

const canonical = (e: { id: string; msg: string }) => `${e.id}|${e.msg}`;

function fakeKeychain(): SecretStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return { dump, get: async (k) => dump.get(k) ?? null, set: async (k, s) => void dump.set(k, s) };
}
function chainWith(ns: string, entries: Array<{ id: string; msg: string }>) {
  const c = new AuditChain(canonical, ns);
  for (const e of entries) c.append(e);
  return c;
}

describe('A. provision → sign → RESTART → recover → verify (the FG-S112-AUDIT-KEY flow)', () => {
  it('a durable key survives restart and verifies the persisted audit head', async () => {
    const keychain = fakeKeychain();
    // boot 1: provision key, build chain, sign head
    const p1 = new DurableAuditKeyProvider(keychain);
    const key = await p1.ensureKey();
    const entries = [{ id: '1', msg: 'governed-action-a' }, { id: '2', msg: 'governed-action-b' }];
    const chain = chainWith('tenant-A', entries);
    const signed = signAuditChainHead(key, 'tenant-A', chain);
    // boot 2 (RESTART): fresh provider recovers the SAME key from the keychain
    const p2 = new DurableAuditKeyProvider(keychain);
    const recovered = await p2.load();
    expect(recovered?.publicKeyPem).toBe(key.publicKeyPem);
    const status = verifyAuditChainIntegrity('tenant-A', chain, entries, [p2.verificationKey()!], signed);
    expect(status.state).toBe('SIGNED');
    expect(status.chainOk).toBe(true);
    expect(status.signatureOk).toBe(true);
    expect(status.keyVersion).toBe(1);
    expect(status.algorithm).toBe('Ed25519');
  });

  it('ensureKey is idempotent (does not re-provision on a second boot)', async () => {
    const keychain = fakeKeychain();
    const k1 = await new DurableAuditKeyProvider(keychain).ensureKey();
    const k2 = await new DurableAuditKeyProvider(keychain).ensureKey();
    expect(k2.publicKeyPem).toBe(k1.publicKeyPem);
  });
});

describe('B. backward compatibility — unsigned history is UNSIGNED, never fabricated/failed', () => {
  it('no signature on record → UNSIGNED (chain still checked)', () => {
    const entries = [{ id: '1', msg: 'x' }];
    const chain = chainWith('t', entries);
    const status = verifyAuditChainIntegrity('t', chain, entries, [], undefined);
    expect(status.state).toBe('UNSIGNED');
    expect(status.chainOk).toBe(true);
    expect(status.signatureOk).toBeUndefined();
  });

  it('unsigned + a broken chain → UNSIGNED with chainOk=false (no fabricated signature)', () => {
    const chain = chainWith('t', [{ id: '1', msg: 'x' }, { id: '2', msg: 'y' }]);
    const tampered = [{ id: '1', msg: 'x' }, { id: '2', msg: 'HACK' }];
    const status = verifyAuditChainIntegrity('t', chain, tampered, [], undefined);
    expect(status.state).toBe('UNSIGNED');
    expect(status.chainOk).toBe(false);
  });
});

describe('C. tamper matrix — every invalid condition fails closed (VERIFICATION_FAILED)', () => {
  async function signed(ns: string, entries: Array<{ id: string; msg: string }>) {
    const kc = fakeKeychain();
    const key = await new DurableAuditKeyProvider(kc).ensureKey();
    const chain = chainWith(ns, entries);
    const sig = signAuditChainHead(key, ns, chain);
    const vk = { keyId: key.keyId, version: key.version, algorithm: 'Ed25519' as const, publicKeyPem: key.publicKeyPem };
    return { key, chain, sig, vk, kc };
  }

  it('MODIFIED entry (chain recomputes to a different head) → FAILED', async () => {
    const { sig, vk } = await signed('t', [{ id: '1', msg: 'a' }, { id: '2', msg: 'b' }]);
    const tamperedChain = chainWith('t', [{ id: '1', msg: 'a' }, { id: '2', msg: 'MOD' }]);
    const st = verifyAuditChainIntegrity('t', tamperedChain, [{ id: '1', msg: 'a' }, { id: '2', msg: 'MOD' }], [vk], sig);
    expect(st.state).toBe('VERIFICATION_FAILED');
  });

  it('FORGED entries AND head (internally consistent) → FAILED (signature does not attest forged head)', async () => {
    const { sig, vk } = await signed('t', [{ id: '1', msg: 'a' }]);
    const forged = chainWith('t', [{ id: '1', msg: 'EVIL' }]); // recomputes its own consistent head
    expect(forged.verify([{ id: '1', msg: 'EVIL' }]).ok).toBe(true);
    const st = verifyAuditChainIntegrity('t', forged, [{ id: '1', msg: 'EVIL' }], [vk], sig);
    expect(st.state).toBe('VERIFICATION_FAILED');
  });

  it('REORDERED / REMOVED / DUPLICATED entries → FAILED', async () => {
    const base = [{ id: '1', msg: 'a' }, { id: '2', msg: 'b' }, { id: '3', msg: 'c' }];
    const { sig, vk } = await signed('t', base);
    for (const bad of [
      [{ id: '2', msg: 'b' }, { id: '1', msg: 'a' }, { id: '3', msg: 'c' }], // reorder
      [{ id: '1', msg: 'a' }, { id: '3', msg: 'c' }], // remove
      [{ id: '1', msg: 'a' }, { id: '1', msg: 'a' }, { id: '2', msg: 'b' }, { id: '3', msg: 'c' }], // duplicate
    ]) {
      const c = chainWith('t', bad);
      expect(verifyAuditChainIntegrity('t', c, bad, [vk], sig).state).toBe('VERIFICATION_FAILED');
    }
  });

  it('WRONG TENANT (namespace) → FAILED', async () => {
    const entries = [{ id: '1', msg: 'x' }];
    const { sig, vk } = await signed('tenant-A', entries);
    const bChain = chainWith('tenant-B', entries); // identical entries, different namespace
    expect(verifyAuditChainIntegrity('tenant-B', bChain, entries, [vk], sig).state).toBe('VERIFICATION_FAILED');
  });

  it('WRONG KEY and WRONG KEY VERSION → FAILED', async () => {
    const entries = [{ id: '1', msg: 'x' }];
    const { chain, sig } = await signed('t', entries);
    const otherKey = await new DurableAuditKeyProvider(fakeKeychain()).ensureKey();
    const wrongKeyVk = { keyId: sig.keyId, version: sig.version, algorithm: 'Ed25519' as const, publicKeyPem: otherKey.publicKeyPem };
    expect(verifyAuditChainIntegrity('t', chain, entries, [wrongKeyVk], sig).state).toBe('VERIFICATION_FAILED');
    // wrong version: verifier only holds v1, signature claims v2
    const { vk } = await signed('t', entries);
    expect(verifyAuditChainIntegrity('t', chain, entries, [vk], { ...sig, version: 2 }).state).toBe('VERIFICATION_FAILED');
  });

  it('FORGED / CORRUPTED signature metadata → FAILED, never throws', async () => {
    const { chain, vk, sig } = await signed('t', [{ id: '1', msg: 'x' }]);
    expect(verifyAuditChainIntegrity('t', chain, [{ id: '1', msg: 'x' }], [vk], { ...sig, signature: Buffer.from('forged').toString('base64') }).state).toBe('VERIFICATION_FAILED');
    // @ts-expect-error deliberately malformed signature object
    expect(() => verifyAuditChainIntegrity('t', chain, [{ id: '1', msg: 'x' }], [vk], { keyId: 'x' })).not.toThrow();
  });

  it('CORRUPT keychain blob → no key recovered (fail-closed, UNSIGNED not fabricated)', async () => {
    const kc = fakeKeychain();
    kc.dump.set('neuropause.audit.signing-key.v1', '{bad json');
    const p = new DurableAuditKeyProvider(kc);
    expect(await p.load()).toBeUndefined();
    expect(p.verificationKey()).toBeUndefined();
  });
});

describe('D. structural — integrity only, no authority, no secret exposure', () => {
  it('signedAuditChain imports nothing that could grant authority; status carries no private key', async () => {
    const src = readFileSync(join(__dirname, 'signedAuditChain.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    for (const forbidden of ['enterprise/authz', 'runtimeAuthz', '/cst', 'dispatchCommand', 'commandBus', 'approvalEngine', '@neuropause/security']) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
    const kc = fakeKeychain();
    const key = await new DurableAuditKeyProvider(kc).ensureKey();
    const chain = chainWith('t', [{ id: '1', msg: 'x' }]);
    const st = verifyAuditChainIntegrity('t', chain, [{ id: '1', msg: 'x' }], [{ keyId: key.keyId, version: 1, algorithm: 'Ed25519', publicKeyPem: key.publicKeyPem }], signAuditChainHead(key, 't', chain));
    // integrity status is inert data — no permission/authority surface
    expect(st).not.toHaveProperty('permission');
    expect(st).not.toHaveProperty('authorized');
    expect(JSON.stringify(st)).not.toMatch(/PRIVATE KEY/);
    // the persisted key blob is the ONLY place private material lives (the keychain)
    const persisted = kc.dump.get('neuropause.audit.signing-key.v1')!;
    expect(persisted).toMatch(/PRIVATE KEY/); // it IS there (OS-encrypted in production)
    // …but the verification key handed to verifiers is public-only
    const p2 = new DurableAuditKeyProvider(kc);
    await p2.load();
    expect(JSON.stringify(p2.verificationKey())).not.toMatch(/PRIVATE KEY/);
    expect(p2.verificationKey()!.publicKeyPem).toMatch(/PUBLIC KEY/);
  });
});
