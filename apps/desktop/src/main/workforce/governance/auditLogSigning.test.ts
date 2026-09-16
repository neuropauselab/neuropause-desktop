import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkforceAuditEntry } from '@neuropause/shared';
import { AuditLog } from './auditLog';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';
import { generateAuditSigningKey } from '../../security/auditSigner';

/**
 * S115 — AUDIT INTEGRITY + SECURITY OPERATIONS CONVERGENCE.
 *
 * The workforce governance AuditLog (a SHA-256 hash chain) is now head-signed with a durable Ed25519
 * key (H5) provisioned through the OS keychain (H6). These tests prove, adversarially and fail-closed:
 *   - no key  ⇒ UNSIGNED (truthful backward-compatible state, never a fabricated signature)
 *   - key     ⇒ SIGNED, and the state survives persist→reload
 *   - a tampered entry / head / signature / wrong key / wrong version / removed-or-reordered entry
 *     ⇒ VERIFICATION_FAILED (never a false SIGNED)
 *   - the exposed surface carries ONLY {state, algorithm, keyId, keyVersion} — never key material,
 *     never the head or entries.
 */

function tempPath(): string {
  return join(tmpdir(), `np-audit-signing-${randomUUID()}.json`);
}

function entry(i: number, over: Partial<WorkforceAuditEntry> = {}): WorkforceAuditEntry {
  return {
    id: `entry-${i}`,
    at: `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    workerId: `worker-${i % 3}`,
    workerRole: 'founder',
    skillId: `skill-${i}`,
    requestId: `req-${i}`,
    decision: 'allow',
    risk: 'low',
    summary: `decision ${i}`,
    ...over,
  };
}

describe('AuditLog — Ed25519 head signing (S115 audit integrity)', () => {
  const paths: string[] = [];
  afterEach(async () => {
    for (const p of paths.splice(0)) {
      await fs.rm(p, { force: true }).catch(() => undefined);
      await fs.rm(`${p}.tmp`, { force: true }).catch(() => undefined);
    }
  });
  function newLog(): { log: AuditLog; path: string } {
    const path = tempPath();
    paths.push(path);
    return { log: new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE), path };
  }

  it('UNSIGNED when no signing key is attached (truthful, not fabricated)', async () => {
    const { log } = newLog();
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();
    const s = log.integrityStatus();
    expect(s.state).toBe('UNSIGNED');
    expect(s.algorithm).toBeUndefined();
    expect(s.keyId).toBeUndefined();
  });

  it('SIGNED with a key attached, and the state survives persist→reload', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();
    expect(log.integrityStatus().state).toBe('SIGNED');

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(key);
    await reopened.load();
    const s = reopened.integrityStatus();
    expect(s.state).toBe('SIGNED');
    expect(s.algorithm).toBe('Ed25519');
    expect(s.keyId).toBe('np-audit-test');
    expect(s.keyVersion).toBe(1);
  });

  it('VERIFICATION_FAILED when a persisted entry is tampered (chain breaks)', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.entries[2].summary = 'FORGED';
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(key);
    await reopened.load();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });

  it('VERIFICATION_FAILED when the persisted signature is forged/mutated', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    // Flip the base64 signature payload, keep everything else valid.
    raw.signature.signature = Buffer.from('not-a-real-signature').toString('base64');
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(key);
    await reopened.load();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });

  it('VERIFICATION_FAILED when verified under a DIFFERENT key (wrong keypair)', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const attacker = generateAuditSigningKey('np-audit-test', 1); // same id/version, different keypair
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(attacker);
    await reopened.load();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });

  it('VERIFICATION_FAILED when the verifier key version does not match the signature', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const wrongVersion = { ...key, version: 2 }; // no matching (keyId, version) verification key
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(wrongVersion);
    await reopened.load();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });

  it('VERIFICATION_FAILED when a persisted entry is removed after signing', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.entries.splice(1, 1); // remove one entry, keep the signed head
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(key);
    await reopened.load();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });

  it('VERIFICATION_FAILED when persisted entries are reordered after signing', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    [raw.entries[0], raw.entries[1]] = [raw.entries[1], raw.entries[0]];
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(key);
    await reopened.load();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });

  it('the exposed surface carries ONLY safe fields — never key material, head, or entries', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 3; i++) log.record(entry(i));
    await log.flush();

    const s = log.integrityStatus();
    expect(Object.keys(s).sort()).toEqual(['algorithm', 'keyId', 'keyVersion', 'state']);
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(serialized).not.toContain(key.privateKeyPem.trim().split('\n')[1]); // no PEM body
    expect(serialized).not.toContain('BEGIN'); // no PEM at all
    expect(serialized).not.toContain('signature'); // no raw signature bytes
    expect(serialized).not.toContain('head'); // no chain head
    expect(serialized).not.toContain('entry-'); // no audit entries
  });

  it('malformed persisted signature fails closed (VERIFICATION_FAILED, no throw)', async () => {
    const key = generateAuditSigningKey('np-audit-test', 1);
    const { log, path } = newLog();
    log.attachSigningKey(key);
    await log.load();
    for (let i = 0; i < 4; i++) log.record(entry(i));
    await log.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.signature = { keyId: 'np-audit-test', version: 1, algorithm: 'Ed25519', signature: '!!!not-base64!!!', signedAt: 0 };
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.attachSigningKey(key);
    await reopened.load();
    expect(() => reopened.integrityStatus()).not.toThrow();
    expect(reopened.integrityStatus().state).toBe('VERIFICATION_FAILED');
  });
});
