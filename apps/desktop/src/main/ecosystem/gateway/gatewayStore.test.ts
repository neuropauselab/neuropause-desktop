import { describe, it, expect, afterEach } from 'vitest';
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

function gwEntry(i: number) {
  return {
    at: `2026-07-24T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
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
    const s = new GatewayStore(tempPath());
    await s.load();
    for (let i = 0; i < 6; i++) s.record(gwEntry(i));
    expect(s.verifyAuditIntegrity().ok).toBe(true);
    expect(s.totalAudit()).toBe(6);
    await s.flush();
  });

  it('persists and reloads with integrity intact', async () => {
    const path = tempPath();
    const s = new GatewayStore(path);
    await s.load();
    for (let i = 0; i < 4; i++) s.record(gwEntry(i));
    await s.flush();

    const re = new GatewayStore(path);
    await re.load();
    expect(re.auditEntries(100)).toHaveLength(4);
    expect(re.verifyAuditIntegrity().ok).toBe(true);
  });

  it('DETECTS a mutated entry after reload', async () => {
    const path = tempPath();
    const s = new GatewayStore(path);
    await s.load();
    for (let i = 0; i < 4; i++) s.record(gwEntry(i));
    await s.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.audit[1].status = 999; // forge an outcome
    await fs.writeFile(path, JSON.stringify(raw));

    let violated = false;
    const re = new GatewayStore(path);
    re.on('integrity-violation', () => (violated = true));
    await re.load();
    expect(re.verifyAuditIntegrity().ok).toBe(false);
    expect(violated).toBe(true);
  });

  it('bounds retention honestly and still verifies across rotation', async () => {
    const s = new GatewayStore(tempPath(), { auditCap: 3 });
    await s.load();
    for (let i = 0; i < 8; i++) s.record(gwEntry(i));
    expect(s.auditEntries(100)).toHaveLength(3);
    expect(s.totalAudit()).toBe(8);
    const r = s.verifyAuditIntegrity();
    expect(r.ok).toBe(true);
    expect(r.dropped).toBe(5);
    await s.flush();
  });
});
