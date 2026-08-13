import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayStore } from './gatewayStore';

/**
 * REP v2.0 cycle 3 — the API-gateway audit trail (auth / rate-limit outcomes) gains
 * tamper-evidence via the shared AuditChain primitive. It previously trimmed at
 * 10,000 with no integrity. These tests mirror the governance/workforce guarantees.
 */
let counter = 0;
const paths: string[] = [];
function tempPath(): string {
  counter += 1;
  const p = join(tmpdir(), `np-gw-test-${process.pid}-${counter}.json`);
  paths.push(p);
  return p;
}
afterEach(async () => {
  for (const p of paths.splice(0)) {
    await fs.rm(p, { force: true }).catch(() => undefined);
    await fs.rm(`${p}.tmp`, { force: true }).catch(() => undefined);
  }
});

/**
 * P13C ROUND 3 — H-3. The audit trail is now tenant-owned, so these tests name a
 * tenant and stamp their entries. The chain guarantees are unchanged and still
 * asserted install-wide: `verifyAuditIntegrity` and `totalAudit` are statements
 * about the CHAIN, and scoping them would make them weaker claims.
 */
const TENANT = { tenantId: 'org-gw-test', workspaceId: 'ws-gw-test' };
/** A SECOND organization on the same install. Only the cross-tenant cases use it. */
const NEIGHBOUR = { tenantId: 'org-gw-neighbour', workspaceId: 'ws-gw-neighbour' };
let active: typeof TENANT = TENANT;
const scope = (): typeof TENANT => active;
beforeEach(() => {
  active = TENANT;
});

function gwEntry(i: number, tenantId: string = TENANT.tenantId) {
  return {
    at: `2026-07-24T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    tenantId,
    keyId: i % 2 === 0 ? `key-${i}` : null,
    developerId: `dev-${i % 3}`,
    method: 'GET',
    path: `/v1/resource/${i}`,
    version: 'v1',
    status: 200,
    reason: 'ok',
    latencyMs: 10 + i,
  };
}

describe('GatewayStore — tamper-evident audit trail (REP v2.0)', () => {
  it('records and verifies the chain', async () => {
    const s = new GatewayStore(tempPath()).bindScope(scope);
    await s.load();
    for (let i = 0; i < 6; i++) s.record(gwEntry(i));
    expect(s.verifyAuditIntegrity().ok).toBe(true);
    expect(s.totalAudit()).toBe(6);
    await s.flush();
  });

  it('persists and reloads with integrity intact', async () => {
    const path = tempPath();
    const s = new GatewayStore(path).bindScope(scope);
    await s.load();
    for (let i = 0; i < 4; i++) s.record(gwEntry(i));
    await s.flush();

    const re = new GatewayStore(path).bindScope(scope);
    await re.load();
    expect(re.auditEntries(100)).toHaveLength(4);
    expect(re.verifyAuditIntegrity().ok).toBe(true);
  });

  it('DETECTS a mutated entry after reload', async () => {
    const path = tempPath();
    const s = new GatewayStore(path).bindScope(scope);
    await s.load();
    for (let i = 0; i < 4; i++) s.record(gwEntry(i));
    await s.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.audit[1].status = 999; // forge an outcome
    await fs.writeFile(path, JSON.stringify(raw));

    let violated = false;
    const re = new GatewayStore(path).bindScope(scope);
    re.on('integrity-violation', () => (violated = true));
    await re.load();
    expect(re.verifyAuditIntegrity().ok).toBe(false);
    expect(violated).toBe(true);
  });

  /**
   * P13C ROUND 9 — F13. `auditCap` is now the cap PER TENANT, so this test owns
   * its rows: all eight entries belong to one organization, which is why three
   * survive and five are dropped. The numbers are unchanged; what changed is
   * whose rows the five could possibly have been.
   */
  it('bounds retention honestly and still verifies across rotation', async () => {
    const s = new GatewayStore(tempPath(), { auditCap: 3 }).bindScope(scope);
    await s.load();
    for (let i = 0; i < 8; i++) s.record(gwEntry(i));
    expect(s.auditEntries(100)).toHaveLength(3);
    expect(s.totalAudit()).toBe(8);
    const r = s.verifyAuditIntegrity();
    expect(r.ok).toBe(true);
    expect(r.dropped).toBe(5);
    await s.flush();
  });

  /**
   * THE CROSS-TENANT CASE. Under the install-wide cap this test could not have
   * been written: with `auditCap: 3` and two tenants, the effective cap was 6 and
   * the neighbour's two entries — written first, therefore oldest — were the
   * first things the noisy tenant's traffic deleted.
   */
  it('a noisy tenant’s rotation does not touch the neighbour’s audit rows', async () => {
    const s = new GatewayStore(tempPath(), { auditCap: 3 }).bindScope(scope);
    await s.load();

    const neighbourIds = [100, 101].map((i) => s.record(gwEntry(i, NEIGHBOUR.tenantId)).id);
    for (let i = 0; i < 40; i++) s.record(gwEntry(i)); // 37 evictions, all the writer's own

    active = NEIGHBOUR;
    const theirs = s.auditEntries(100);
    expect(theirs).toHaveLength(2);
    expect(theirs.map((e) => e.id).sort()).toEqual([...neighbourIds].sort());

    active = TENANT;
    expect(s.auditEntries(100)).toHaveLength(3);
    expect(s.verifyAuditIntegrity().ok).toBe(true);
    expect(s.totalAudit()).toBe(42);
    await s.flush();
  });
});
