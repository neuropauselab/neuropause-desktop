/**
 * GATE 7 — a failed provenance write must be REPORTED, not swallowed.
 *
 * `persist()` ended its serialised write chain in `.catch(() => undefined)` and
 * returned that swallowed promise, so `append()` resolved successfully even when
 * the disk write threw. An import then reported success with the provenance
 * trail only in memory — lost on the next restart, with the user believing an
 * audit trail existed. The fix keeps the chain from poisoning the NEXT writer
 * while letting THIS caller learn the true outcome.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { ProvenanceStore, type ImportResult, type ProvenanceRecord } from './importer';

const NOW = '2026-08-30T12:00:00.000Z';
const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };

function rec(recordId: string): ProvenanceRecord {
  return {
    recordId,
    moduleId: 'crm-customers',
    planId: `imp_${recordId}`,
    sourceFile: 'file.csv',
    sourceTable: 'Customers',
    sourceRow: 1,
    confidence: 1,
    approvedBy: 'a@example.test',
    importedAt: NOW,
    fields: [{ field: 'name', column: 'Name', original: 'Acme', transformation: null }],
  };
}

function run(planId: string): ImportResult {
  return {
    planId,
    sourceFile: 'file.csv',
    importedAt: NOW,
    actor: 'a@example.test',
    status: 'imported',
    tables: [],
    totals: { imported: 1, updated: 0, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
  };
}

describe('provenance write failure is propagated, not swallowed (Gate 7)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = join(tmpdir(), `np-prov-wf-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('append REJECTS when the file cannot be written — no false success', async () => {
    // The parent directory does not exist, so the atomic tmp write fails.
    const store = new ProvenanceStore(join(dir, 'missing-subdir', 'provenance.json'));
    store.bindScope(() => A);
    await store.load();

    await expect(store.append(run('imp_a1'), [rec('rec-a1')])).rejects.toThrow();
  });

  it('a later write still succeeds — one failed write does not poison the chain', async () => {
    const sub = join(dir, 'later');
    const store = new ProvenanceStore(join(sub, 'provenance.json'));
    store.bindScope(() => A);
    await store.load();

    // First write fails (subdir absent) and the caller is told.
    await expect(store.append(run('imp_a1'), [rec('rec-a1')])).rejects.toThrow();

    // The condition clears; the NEXT write must go through (chain not poisoned)
    // and persist everything held, so nothing accumulated in memory is lost.
    await fs.mkdir(sub, { recursive: true });
    await expect(store.append(run('imp_a2'), [rec('rec-a2')])).resolves.toBeUndefined();

    // Re-open from disk: both rows are durably persisted by the recovered write.
    const reopened = new ProvenanceStore(join(sub, 'provenance.json'));
    reopened.bindScope(() => A);
    await reopened.load();
    expect(reopened.forRecord('rec-a1')?.sourceFile).toBe('file.csv');
    expect(reopened.forRecord('rec-a2')?.sourceFile).toBe('file.csv');
  });

  it('a normal write resolves and persists (the fix does not break the happy path)', async () => {
    const store = new ProvenanceStore(join(dir, 'provenance.json'));
    store.bindScope(() => A);
    await store.load();
    await expect(store.append(run('imp_a1'), [rec('rec-a1')])).resolves.toBeUndefined();

    const reopened = new ProvenanceStore(join(dir, 'provenance.json'));
    reopened.bindScope(() => A);
    await reopened.load();
    expect(reopened.forRecord('rec-a1')).not.toBeNull();
  });
});
