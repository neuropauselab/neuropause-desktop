/**
 * S111 (H5) — Ed25519 audit-chain signing. Reproduces packages/security keys.ts Ed25519 semantics,
 * proves it strengthens the live AuditChain (closes the documented forge-entries-and-head gap), and
 * proves the §6 adversarial matrix, fail-closed, tenant-isolated, non-authoritative.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditChain } from './auditChain';
import {
  generateAuditSigningKey,
  verificationKeyOf,
  signAuditHead,
  verifyAuditHead,
  canonicalAuditAnchor,
  type AuditAnchor,
} from './auditSigner';

const canonical = (e: { id: string; msg: string }) => `${e.id}|${e.msg}`;

function chainWith(namespace: string, entries: Array<{ id: string; msg: string }>) {
  const chain = new AuditChain(canonical, namespace);
  for (const e of entries) chain.append(e);
  return chain;
}
function anchorOf(namespace: string, chain: AuditChain<{ id: string; msg: string }>): AuditAnchor {
  const s = chain.snapshot();
  return { namespace, chainAlgo: s.algo, head: s.head };
}

describe('A. reproduces Ed25519 signing + strengthens the live AuditChain', () => {
  it('a signed, untampered chain verifies (chain OK AND signature OK)', () => {
    const key = generateAuditSigningKey('audit-key-1', 1);
    const entries = [{ id: '1', msg: 'a' }, { id: '2', msg: 'b' }, { id: '3', msg: 'c' }];
    const chain = chainWith('tenant-A', entries);
    const anchor = anchorOf('tenant-A', chain);
    const signed = signAuditHead(key.privateKeyPem, key, anchor);
    expect(chain.verify(entries).ok).toBe(true);
    expect(verifyAuditHead([verificationKeyOf(key)], anchor, signed)).toBe(true);
  });

  it('CLOSES THE DOCUMENTED GAP: forging entries AND head fails signature verification', () => {
    const key = generateAuditSigningKey('audit-key-1', 1);
    const entries = [{ id: '1', msg: 'a' }, { id: '2', msg: 'b' }];
    const chain = chainWith('tenant-A', entries);
    const signed = signAuditHead(key.privateKeyPem, key, anchorOf('tenant-A', chain));
    // Attacker rewrites an entry AND recomputes a consistent chain+head (defeats SHA-256-only):
    const forgedEntries = [{ id: '1', msg: 'a' }, { id: '2', msg: 'HACKED' }];
    const forgedChain = chainWith('tenant-A', forgedEntries);
    const forgedAnchor = anchorOf('tenant-A', forgedChain);
    expect(forgedChain.verify(forgedEntries).ok).toBe(true); // internally consistent — SHA-256 alone is fooled
    // …but the OLD signature does not attest the FORGED head, and the attacker cannot re-sign:
    expect(verifyAuditHead([verificationKeyOf(key)], forgedAnchor, signed)).toBe(false);
  });
});

describe('§6 adversarial — audit signing cannot be forged or become authority', () => {
  it('MODIFIED record → signature over the new head fails', () => {
    const key = generateAuditSigningKey('k', 1);
    const chain = chainWith('t', [{ id: '1', msg: 'x' }]);
    const signed = signAuditHead(key.privateKeyPem, key, anchorOf('t', chain));
    const tampered = anchorOf('t', chainWith('t', [{ id: '1', msg: 'x-MOD' }]));
    expect(verifyAuditHead([verificationKeyOf(key)], tampered, signed)).toBe(false);
  });

  it('FORGED signature (garbage) rejected', () => {
    const key = generateAuditSigningKey('k', 1);
    const anchor = anchorOf('t', chainWith('t', [{ id: '1', msg: 'x' }]));
    const forged = { keyId: 'k', version: 1, algorithm: 'Ed25519' as const, signature: Buffer.from('not-a-real-signature').toString('base64'), signedAt: 0 };
    expect(verifyAuditHead([verificationKeyOf(key)], anchor, forged)).toBe(false);
  });

  it('WRONG KEY rejected (signed by A, only B trusted)', () => {
    const a = generateAuditSigningKey('shared-id', 1);
    const b = generateAuditSigningKey('shared-id', 1); // same id, different keypair
    const anchor = anchorOf('t', chainWith('t', [{ id: '1', msg: 'x' }]));
    const signed = signAuditHead(a.privateKeyPem, a, anchor);
    expect(verifyAuditHead([verificationKeyOf(b)], anchor, signed)).toBe(false);
  });

  it('WRONG KEY VERSION rejected', () => {
    const v1 = generateAuditSigningKey('k', 1);
    const anchor = anchorOf('t', chainWith('t', [{ id: '1', msg: 'x' }]));
    const signedV2 = { ...signAuditHead(v1.privateKeyPem, v1, anchor), version: 2 }; // claims v2
    expect(verifyAuditHead([verificationKeyOf(v1)], anchor, signedV2)).toBe(false); // only v1 held
  });

  it('REORDERED records detected by the chain (head differs → signature fails)', () => {
    const key = generateAuditSigningKey('k', 1);
    const ordered = [{ id: '1', msg: 'a' }, { id: '2', msg: 'b' }];
    const signed = signAuditHead(key.privateKeyPem, key, anchorOf('t', chainWith('t', ordered)));
    const reordered = anchorOf('t', chainWith('t', [{ id: '2', msg: 'b' }, { id: '1', msg: 'a' }]));
    expect(verifyAuditHead([verificationKeyOf(key)], reordered, signed)).toBe(false);
  });

  it('CROSS-TENANT signature substitution rejected (namespace bound into the signed anchor)', () => {
    const key = generateAuditSigningKey('k', 1);
    const entries = [{ id: '1', msg: 'x' }];
    const aChain = chainWith('tenant-A', entries);
    const signedA = signAuditHead(key.privateKeyPem, key, anchorOf('tenant-A', aChain));
    // move A's signature onto tenant-B's anchor (even with identical entries → different namespace)
    const bAnchor = anchorOf('tenant-B', chainWith('tenant-B', entries));
    expect(verifyAuditHead([verificationKeyOf(key)], bAnchor, signedA)).toBe(false);
    expect(verifyAuditHead([verificationKeyOf(key)], anchorOf('tenant-A', aChain), signedA)).toBe(true); // A still verifies
  });

  it('REPLAY: signing is stateless + deterministic — signing twice makes NO new audit records', () => {
    const key = generateAuditSigningKey('k', 1);
    const chain = chainWith('t', [{ id: '1', msg: 'x' }]);
    const anchor = anchorOf('t', chain);
    const s1 = signAuditHead(key.privateKeyPem, key, anchor, 100);
    const s2 = signAuditHead(key.privateKeyPem, key, anchor, 100);
    expect(s1.signature).toBe(s2.signature); // Ed25519 deterministic (RFC 8032)
    expect(chain.totalAppended).toBe(1); // signing added nothing to the chain
  });

  it('INTEGRITY FAILURE cannot silently become success (fail-closed on bad input, never throws)', () => {
    const key = generateAuditSigningKey('k', 1);
    const anchor = anchorOf('t', chainWith('t', [{ id: '1', msg: 'x' }]));
    // @ts-expect-error deliberately malformed signed object
    expect(() => verifyAuditHead([verificationKeyOf(key)], anchor, null)).not.toThrow();
    // @ts-expect-error deliberately malformed signed object (fail-closed, not a throw)
    expect(verifyAuditHead([verificationKeyOf(key)], anchor, null)).toBe(false);
    expect(verifyAuditHead([], anchor, signAuditHead(key.privateKeyPem, key, anchor))).toBe(false); // no keys held
  });
});

describe('§6 structural — no secret exposure, no authority', () => {
  it('a SignedAuditHead carries NO private key material; verification keys are public-only', () => {
    const key = generateAuditSigningKey('k', 1);
    const signed = signAuditHead(key.privateKeyPem, key, anchorOf('t', chainWith('t', [{ id: '1', msg: 'x' }])));
    const blob = JSON.stringify(signed);
    expect(blob).not.toMatch(/PRIVATE KEY/);
    expect(signed).not.toHaveProperty('privateKeyPem');
    const vk = verificationKeyOf(key);
    expect(vk).not.toHaveProperty('privateKeyPem');
    expect(JSON.stringify(vk)).not.toMatch(/PRIVATE KEY/);
  });

  it('STRUCTURAL: auditSigner.ts imports nothing that could enforce/grant authority, embeds no key', () => {
    const src = readFileSync(join(__dirname, 'auditSigner.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    // only node:crypto is imported
    expect(importLines.every((l) => l.includes("'node:crypto'"))).toBe(true);
    for (const forbidden of ['enterprise/authz', 'runtimeAuthz', '/cst', 'dispatchCommand', 'commandBus', 'approvalEngine', '@neuropause/security']) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
    // no hardcoded PEM key material in source
    expect(src).not.toMatch(/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
  });

  it('verification returns a boolean about INTEGRITY — never a permission/authority object', () => {
    const key = generateAuditSigningKey('k', 1);
    const anchor = anchorOf('t', chainWith('t', [{ id: '1', msg: 'x' }]));
    const r = verifyAuditHead([verificationKeyOf(key)], anchor, signAuditHead(key.privateKeyPem, key, anchor));
    expect(typeof r).toBe('boolean');
    expect(canonicalAuditAnchor(anchor)).toContain('neuropause-audit-sig:v1');
  });
});
