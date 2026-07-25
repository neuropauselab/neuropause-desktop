import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernanceStore } from './governanceStore';

/**
 * REP v2.0 — the enterprise governance audit trail gains tamper-evidence via the
 * shared AuditChain primitive (it previously had none and silently trimmed at
 * 2000). These tests prove the chain verifies, rotates honestly, detects tampering,
 * and survives persist/reload — mirroring the workforce audit guarantees.
 */
let counter = 0;
const paths: string[] = [];
function tempPath(): string {
  counter += 1;
  const p = join(tmpdir(), `np-gov-test-${process.pid}-${counter}.json`);
  paths.push(p);
  return p;
}
afterEach(async () => {
  for (const p of paths.splice(0)) {
    await fs.rm(p, { force: true }).catch(() => undefined);
    await fs.rm(`${p}.tmp`, { force: true }).catch(() => undefined);
  }
});

function auditEntry(i: number) {
  return { actor: `user-${i % 3}`, action: 'policy.update', target: `rule-${i}`, summary: `change ${i}`, workspaceId: 'ws-1' };
}

describe('GovernanceStore — tamper-evident audit trail (REP v2.0)', () => {
  it('records audit entries and verifies the chain', async () => {
    const store = new GovernanceStore(tempPath());
    await store.load();
    for (let i = 0; i < 6; i++) store.record(auditEntry(i));
    const r = store.verifyAuditIntegrity();
    expect(r.ok).toBe(true);
    expect(store.auditCount()).toBe(6);
    expect(store.totalAudit()).toBe(6);
    await store.flush();
  });

  it('persists and reloads with audit integrity intact', async () => {
    const path = tempPath();
    const store = new GovernanceStore(path);
    await store.load();
    for (let i = 0; i < 4; i++) store.record(auditEntry(i));
    await store.flush();

    const reopened = new GovernanceStore(path);
    await reopened.load();
    expect(reopened.auditCount()).toBe(4);
    expect(reopened.verifyAuditIntegrity().ok).toBe(true);
  });

  it('DETECTS a mutated audit entry after reload', async () => {
    const path = tempPath();
    const store = new GovernanceStore(path);
    await store.load();
    for (let i = 0; i < 4; i++) store.record(auditEntry(i));
    await store.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.audit[1].summary = 'FORGED';
    await fs.writeFile(path, JSON.stringify(raw));

    let violated = false;
    const reopened = new GovernanceStore(path);
    reopened.on('integrity-violation', () => (violated = true));
    await reopened.load();
    expect(reopened.verifyAuditIntegrity().ok).toBe(false);
    expect(violated).toBe(true);
  });

  it('bounds retention honestly and still verifies across rotation', async () => {
    const store = new GovernanceStore(tempPath(), { auditCap: 3 });
    await store.load();
    for (let i = 0; i < 9; i++) store.record(auditEntry(i));
    expect(store.auditCount()).toBe(3); // retained window
    expect(store.totalAudit()).toBe(9); // nothing silently lost
    const r = store.verifyAuditIntegrity();
    expect(r.ok).toBe(true);
    expect(r.dropped).toBe(6);
    await store.flush();
  });

  it('upgrades a legacy (unchained) governance file in place', async () => {
    const path = tempPath();
    // Legacy format: audit entries, no integrity block.
    await fs.writeFile(
      path,
      JSON.stringify({
        approvalChains: [],
        complianceRules: [],
        audit: [
          { id: 'ea_1', at: '2026-07-24T00:00:00.000Z', ...auditEntry(1) },
          { id: 'ea_2', at: '2026-07-24T00:00:01.000Z', ...auditEntry(2) },
        ],
        seeded: true,
      }),
    );
    const store = new GovernanceStore(path);
    await store.load();
    expect(store.auditCount()).toBe(2);
    expect(store.verifyAuditIntegrity().ok).toBe(true); // chain rebuilt from entries
    await store.flush();
  });
});
