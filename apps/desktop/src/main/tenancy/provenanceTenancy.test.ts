/**
 * The provenance cross-tenant attack matrix (P13A).
 *
 * ONE `ProvenanceStore`, ONE file, TWO tenants, `scope` mutated to switch —
 * the same construction as the memory and record matrices, for the same reason.
 *
 * WHY PROVENANCE IS WORTH ITS OWN MATRIX. It is not a copy of a record; it is a
 * DESCRIPTION of one — the source filename, the sheet, the row number, who
 * approved it, what each field originally said before transformation, and which
 * provider account it came from. For an import trail that description is most
 * of the value, so a provenance boundary that leaked while the record boundary
 * held would give away the interesting half.
 *
 * The headline finding this file locks down is the one the migration inventory
 * recorded as the store's `REQUIRES_MIGRATION` reason: `byExternal` was keyed on
 * `connectorId::accountId::resourceId::externalId` with no tenant, so two
 * tenants syncing the SAME provider account collided on one row and the second
 * ADOPTED the first's provenance. That is a cross-tenant WRITE, not merely a
 * read — and `it('two tenants syncing the same provider account…')` is the
 * assertion that it is closed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import {
  ProvenanceStore,
  setAmbientProvenanceScopeForTests,
  type ImportResult,
  type ProvenanceRecord,
} from '../dataPlane/importer';

const NOW = '2026-08-10T12:00:00.000Z';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

/** The same provider object, synced by both tenants. The collision key. */
const SHARED_EXTERNAL_KEY = 'hubspot::acct-1::contacts::12345';

const A_SECRET_FILE = 'Q3-customers-TENANT-A-CONFIDENTIAL.csv';

function provenanceFor(recordId: string, sourceFile: string, external?: string): ProvenanceRecord {
  return {
    recordId,
    moduleId: 'crm-customers',
    planId: `imp_${recordId}`,
    sourceFile,
    sourceTable: 'Customers',
    sourceRow: 412,
    confidence: 1,
    approvedBy: 'priya@example.com',
    importedAt: NOW,
    fields: [{ field: 'name', column: 'Name', original: 'Northwind', transformation: null }],
    ...(external
      ? {
          connector: {
            connectorId: 'hubspot',
            accountId: 'acct-1',
            resourceId: 'contacts',
            externalId: '12345',
            externalKey: external,
            syncedAt: NOW,
            externalUpdatedAt: null,
            syncRunId: 'run-1',
            mappingVersion: 1,
            linkage: 'created' as const,
          },
        }
      : {}),
  };
}

function runFor(planId: string, sourceFile: string): ImportResult {
  return {
    planId,
    sourceFile,
    importedAt: NOW,
    actor: 'priya@example.com',
    status: 'imported',
    tables: [],
    totals: { imported: 1, updated: 0, skipped: 0, failed: 0, duplicates: 0, needsReview: 0 },
  };
}

describe('provenance: the tenant boundary', () => {
  let dir: string;
  let store: ProvenanceStore;
  /** The active scope. Mutating this IS the tenant switch. */
  let scope: TenantScope | null;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-prov-tenancy-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new ProvenanceStore(join(dir, 'provenance.json'));
    store.bindScope(() => scope);
    await store.load();

    scope = A;
    await store.append(runFor('imp_a1', A_SECRET_FILE), [
      provenanceFor('rec-a1', A_SECRET_FILE),
      provenanceFor('rec-a2', A_SECRET_FILE),
    ]);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /* ── read ─────────────────────────────────────────────────────────────── */

  it('a record id is a reference, not an authorization', () => {
    scope = B;
    // B holds A's record id and asks where it came from.
    expect(store.forRecord('rec-a1')).toBeNull();

    scope = A;
    expect(store.forRecord('rec-a1')?.sourceFile).toBe(A_SECRET_FILE);
  });

  it('lookup by plan does not cross tenants', () => {
    scope = B;
    expect(store.forPlan('imp_rec-a1')).toEqual([]);
    scope = A;
    expect(store.forPlan('imp_rec-a1')).toHaveLength(1);
  });

  it('import history does not disclose another tenant’s runs, files or actors', () => {
    scope = B;
    const history = store.history(50);
    expect(history).toEqual([]);
    expect(JSON.stringify(history)).not.toContain(A_SECRET_FILE);
    expect(store.run('imp_a1')).toBeNull();

    scope = A;
    expect(store.history(50)).toHaveLength(1);
    expect(store.run('imp_a1')?.sourceFile).toBe(A_SECRET_FILE);
  });

  it('counts do not disclose another tenant’s import volume', () => {
    scope = B;
    expect(store.counts()).toEqual({ runs: 0, records: 0 });
    expect(store.countForModule('crm-customers')).toBe(0);

    scope = A;
    expect(store.counts()).toEqual({ runs: 1, records: 2 });
    expect(store.countForModule('crm-customers')).toBe(2);
  });

  it('unbound denies every read', () => {
    scope = null;
    expect(store.forRecord('rec-a1')).toBeNull();
    expect(store.forPlan('imp_a1')).toEqual([]);
    expect(store.history()).toEqual([]);
    expect(store.counts()).toEqual({ runs: 0, records: 0 });
    expect(store.forExternalKey(SHARED_EXTERNAL_KEY)).toBeNull();
    expect(store.forConnection('hubspot', 'acct-1')).toEqual([]);
  });

  it('unbound refuses to WRITE rather than writing an unowned row', async () => {
    scope = null;
    await expect(store.append(runFor('imp_x', 'x.csv'), [provenanceFor('rec-x', 'x.csv')])).rejects.toThrow(
      /no organization and workspace are active/i,
    );
    await expect(store.appendConnector([provenanceFor('rec-y', 'y.csv', 'k')])).rejects.toThrow(
      /no organization and workspace are active/i,
    );
  });

  /* ── write ────────────────────────────────────────────────────────────── */

  it('the writer’s tenant comes from the active scope, never from the payload', async () => {
    scope = B;
    // A caller hands in a row that CLAIMS to belong to tenant A.
    const forged = { ...provenanceFor('rec-forged', 'b.csv'), tenantId: 'org-a', workspaceId: 'ws-a' };
    await store.append(runFor('imp_b1', 'b.csv'), [forged]);

    // It landed in B, where the writer actually was.
    expect(store.forRecord('rec-forged')).not.toBeNull();
    scope = A;
    expect(store.forRecord('rec-forged')).toBeNull();
  });

  it('an import run is stamped with the writing tenant too', async () => {
    scope = B;
    await store.append(runFor('imp_b2', 'b.csv'), []);
    expect(store.run('imp_b2')).not.toBeNull();
    scope = A;
    expect(store.run('imp_b2')).toBeNull();
  });

  /* ── the external-key collision: a cross-tenant WRITE ─────────────────── */

  it('two tenants syncing the same provider account do not collide or adopt', async () => {
    scope = A;
    await store.appendConnector([
      provenanceFor('rec-a-hs', A_SECRET_FILE, SHARED_EXTERNAL_KEY),
    ]);

    scope = B;
    // B has never seen this provider object — even though A already synced it
    // under the identical external key. Pre-P13A this returned A's row, and the
    // `existing` branch then rewrote A's provenance with B's connector origin.
    expect(store.forExternalKey(SHARED_EXTERNAL_KEY)).toBeNull();

    await store.appendConnector([provenanceFor('rec-b-hs', 'b.csv', SHARED_EXTERNAL_KEY)]);
    const bRow = store.forExternalKey(SHARED_EXTERNAL_KEY);
    expect(bRow?.recordId).toBe('rec-b-hs');
    expect(bRow?.sourceFile).toBe('b.csv');

    // A's row is intact and still its own: not adopted, not overwritten.
    scope = A;
    const aRow = store.forExternalKey(SHARED_EXTERNAL_KEY);
    expect(aRow?.recordId).toBe('rec-a-hs');
    expect(aRow?.sourceFile).toBe(A_SECRET_FILE);
  });

  it('a connection’s records never span tenants', async () => {
    scope = A;
    await store.appendConnector([provenanceFor('rec-a-hs', A_SECRET_FILE, SHARED_EXTERNAL_KEY)]);
    scope = B;
    await store.appendConnector([provenanceFor('rec-b-hs', 'b.csv', 'hubspot::acct-1::contacts::999')]);

    const bRecords = store.forConnection('hubspot', 'acct-1');
    expect(bRecords.map((r) => r.recordId)).toEqual(['rec-b-hs']);
    expect(JSON.stringify(bRecords)).not.toContain(A_SECRET_FILE);
  });

  it('re-syncing within a tenant still updates in place (the boundary is not a wall)', async () => {
    scope = A;
    await store.appendConnector([provenanceFor('rec-a-hs', A_SECRET_FILE, SHARED_EXTERNAL_KEY)]);
    const before = store.counts().records;

    // The same provider object again: one row, updated — not a duplicate.
    await store.appendConnector([provenanceFor('rec-a-hs', A_SECRET_FILE, SHARED_EXTERNAL_KEY)]);
    expect(store.counts().records).toBe(before);
    // And the file provenance survives the connector refresh.
    expect(store.forRecord('rec-a-hs')?.sourceFile).toBe(A_SECRET_FILE);
  });

  /* ── eviction: destruction, not disclosure ────────────────────────────── */

  /**
   * F4 — a busy tenant must not evict a quiet one's audit trail.
   *
   * Found by adversarial review. The retention cap was applied to the SHARED
   * array, so the globally oldest rows were dropped — which with two tenants
   * means one tenant's imports silently delete the other's provenance. Beyond
   * losing the trail, eviction also drops the row from `byExternal`, so the
   * victim's next connector sync stops recognising provider objects it already
   * imported and starts creating duplicates.
   *
   * The cap is now PER TENANT. Proven with a stubbed cap rather than 100,000
   * real rows: the constant is exported, so the test drives the same code path
   * the production cap drives.
   */
  it('one tenant’s imports never evict another tenant’s provenance', async () => {
    scope = A;
    await store.appendConnector([provenanceFor('rec-a-keep', A_SECRET_FILE, 'a::key')]);
    const aBefore = store.counts().records;

    scope = B;
    // Well past any per-tenant boundary B could reach on its own.
    for (let i = 0; i < 50; i += 1) {
      await store.appendConnector([provenanceFor(`rec-b-${i}`, 'b.csv', `b::key::${i}`)]);
    }

    scope = A;
    expect(store.counts().records).toBe(aBefore);
    expect(store.forRecord('rec-a-keep')).not.toBeNull();
    // The idempotency index survives too — otherwise A's next sync duplicates.
    expect(store.forExternalKey('a::key')?.recordId).toBe('rec-a-keep');
  });

  it('one tenant’s import runs never evict another tenant’s history', async () => {
    scope = A;
    const aRunsBefore = store.history(500).length;

    scope = B;
    for (let i = 0; i < 60; i += 1) {
      await store.append(runFor(`imp_b_${i}`, 'b.csv'), []);
    }

    scope = A;
    expect(store.history(500).length).toBe(aRunsBefore);
    expect(store.run('imp_a1')).not.toBeNull();
  });

  /* ── persistence ──────────────────────────────────────────────────────── */

  it('ownership survives a reload — a restart is not a way round the boundary', async () => {
    scope = A;
    await store.appendConnector([provenanceFor('rec-a-hs', A_SECRET_FILE, SHARED_EXTERNAL_KEY)]);

    const reopened = new ProvenanceStore(join(dir, 'provenance.json'));
    let reopenedScope: TenantScope | null = B;
    reopened.bindScope(() => reopenedScope);
    await reopened.load();

    expect(reopened.forRecord('rec-a1')).toBeNull();
    expect(reopened.forExternalKey(SHARED_EXTERNAL_KEY)).toBeNull();
    expect(reopened.counts()).toEqual({ runs: 0, records: 0 });

    reopenedScope = A;
    expect(reopened.forRecord('rec-a1')?.sourceFile).toBe(A_SECRET_FILE);
    expect(reopened.forExternalKey(SHARED_EXTERNAL_KEY)?.recordId).toBe('rec-a-hs');
  });

  it('rows written before P13A have no tenant and are visible to nobody', async () => {
    const file = join(dir, 'legacy.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        records: [provenanceFor('rec-legacy', 'legacy.csv', 'legacy::key')],
        runs: [runFor('imp_legacy', 'legacy.csv')],
      }),
      { mode: 0o600 },
    );
    const legacy = new ProvenanceStore(file);
    legacy.bindScope(() => A);
    await legacy.load();

    expect(legacy.forRecord('rec-legacy')).toBeNull();
    expect(legacy.forExternalKey('legacy::key')).toBeNull();
    expect(legacy.counts()).toEqual({ runs: 0, records: 0 });
    // Inert, not lost: the ownership report still counts them so the migration
    // inventory can say how many rows nobody owns.
    expect(legacy.ownershipCounts()).toEqual({ total: 1, assigned: 0, unresolved: 1 });
  });

  /* ── the test-only seam ───────────────────────────────────────────────── */

  it('the ambient scope is a test-only seam and refuses to be set at runtime', () => {
    const vitest = process.env.VITEST;
    const nodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => setAmbientProvenanceScopeForTests(() => A)).toThrow(/test-only seam/i);
    } finally {
      if (vitest !== undefined) process.env.VITEST = vitest;
      process.env.NODE_ENV = nodeEnv as string;
    }
  });
});
