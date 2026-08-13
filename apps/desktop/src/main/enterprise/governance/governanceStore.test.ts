import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GovernanceStore } from './governanceStore';

/**
 * P13C ROUND 5 — governance audit reads now fall back to the store's own bound
 * scope when the argument is omitted (it previously meant "every workspace"), so
 * this suite binds one. The chain guarantees below are unchanged and still
 * asserted install-wide.
 */
const GOV_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const asGovScope = (): typeof GOV_SCOPE => GOV_SCOPE;

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
  return { actor: `user-${i % 3}`, action: 'policy.update', target: `rule-${i}`, summary: `change ${i}`, workspaceId: GOV_SCOPE.workspaceId };
}

describe('GovernanceStore — tamper-evident audit trail (REP v2.0)', () => {
  it('records audit entries and verifies the chain', async () => {
    const store = new GovernanceStore(tempPath()).bindScope(asGovScope);
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
    const store = new GovernanceStore(path).bindScope(asGovScope);
    await store.load();
    for (let i = 0; i < 4; i++) store.record(auditEntry(i));
    await store.flush();

    const reopened = new GovernanceStore(path).bindScope(asGovScope);
    await reopened.load();
    expect(reopened.auditCount()).toBe(4);
    expect(reopened.verifyAuditIntegrity().ok).toBe(true);
  });

  it('DETECTS a mutated audit entry after reload', async () => {
    const path = tempPath();
    const store = new GovernanceStore(path).bindScope(asGovScope);
    await store.load();
    for (let i = 0; i < 4; i++) store.record(auditEntry(i));
    await store.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.audit[1].summary = 'FORGED';
    await fs.writeFile(path, JSON.stringify(raw));

    let violated = false;
    const reopened = new GovernanceStore(path).bindScope(asGovScope);
    reopened.on('integrity-violation', () => (violated = true));
    await reopened.load();
    expect(reopened.verifyAuditIntegrity().ok).toBe(false);
    expect(violated).toBe(true);
  });

  it('bounds retention honestly and still verifies across rotation', async () => {
    const store = new GovernanceStore(tempPath(), { auditCap: 3 }).bindScope(asGovScope);
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
    // P13C Round 6 — legacy rows have no `tenantId`, so the store needs to know
    // whether attribution is ambiguous. One organization ⇒ unambiguous ⇒ visible.
    const store = new GovernanceStore(path).bindScope(asGovScope).bindOrganizationCount(() => 1);
    await store.load();
    expect(store.auditCount()).toBe(2);
    expect(store.verifyAuditIntegrity().ok).toBe(true); // chain rebuilt from entries
    await store.flush();
  });

  /**
   * P13C ROUND 6 — THE UPGRADE MUST NOT BREAK THE CHAIN.
   *
   * `tenantId` is a new canonical field. If it were hashed unconditionally, every
   * pre-upgrade row's canonical string would change and the first launch after
   * the upgrade would report the whole trail as tampered. Asserted directly,
   * because "integrity still verifies" is precisely the claim a reviewer would
   * take on trust.
   */
  it('a legacy row and a new attributed row verify in the SAME chain', async () => {
    const path = tempPath();
    await fs.writeFile(
      path,
      JSON.stringify({
        approvalChains: [],
        complianceRules: [],
        audit: [{ id: 'ea_1', at: '2026-07-24T00:00:00.000Z', ...auditEntry(1) }],
        seeded: true,
      }),
    );
    const store = new GovernanceStore(path).bindScope(asGovScope).bindOrganizationCount(() => 1);
    await store.load();
    const fresh = store.record({ ...auditEntry(2) });
    expect(fresh.tenantId).toBe(asGovScope().tenantId); // resolved, not caller-supplied
    expect(store.verifyAuditIntegrity().ok).toBe(true);
    expect(store.auditCount()).toBe(2);
    await store.flush();
  });

  /**
   * WITHHELD, NOT SHARED. With a second organization present, a row nobody can be
   * shown to own goes to nobody — and is COUNTED, so it is visibly withheld.
   */
  it('withholds unattributed legacy rows once a second organization exists', async () => {
    const path = tempPath();
    await fs.writeFile(
      path,
      JSON.stringify({
        approvalChains: [],
        complianceRules: [],
        audit: [{ id: 'ea_1', at: '2026-07-24T00:00:00.000Z', ...auditEntry(1) }],
        seeded: true,
      }),
    );
    let orgs = 1;
    const store = new GovernanceStore(path).bindScope(asGovScope).bindOrganizationCount(() => orgs);
    await store.load();
    expect(store.auditCount()).toBe(1); // visible while unambiguous

    orgs = 2;
    expect(store.auditCount()).toBe(0); // ambiguous ⇒ withheld from EVERYONE
    expect(store.unattributedAudit()).toBe(1); // and accounted for, not vanished

    // A row written now IS attributed, so it survives the ambiguity.
    store.record({ ...auditEntry(2) });
    expect(store.auditCount()).toBe(1);
    await store.flush();
  });
});
