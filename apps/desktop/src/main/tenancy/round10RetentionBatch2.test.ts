/**
 * A RETENTION CAP IS A WRITE — ROUND 10, BATCH 2.
 *
 * Round 9's red team proved three HIGH findings that were all one bug: a cap
 * over a single shared array, deleting another tenant's rows while every read
 * above it stayed correctly filtered. This suite covers four more, found by
 * asking the SAME question of nineteen stores whose retention had never been
 * classified — because `registerTenantStore(name, hasScope)` and
 * `new TenantOwnership(name)` both satisfy the scope gate and neither takes a
 * retention argument.
 *
 * THREE OF THE FOUR ARE A VARIANT THIS PROGRAM HAD NOT SEEN, and it is worth
 * naming precisely, because two of them were introduced BY an earlier fix:
 *
 *     THE VICTIM WAS SCOPED AND THE TRIGGER WAS NOT.
 *
 * `enterpriseRecordStore.evictOldest(scope)` and `traceStore.evictOldest()` were
 * both hardened in Round 7 to choose a victim from the WRITING tenant's rows.
 * Neither call site was touched:
 *
 *     if (this.records.size > this.maxRecords) this.evictOldest(scope);
 *     if (this.edges.length  > this.maxEdges)  this.evictOldest();
 *
 * `size` and `length` are every tenant's rows. So the moment ONE tenant filled
 * the cap, the store sat permanently at the trigger and every subsequent write
 * by ANY tenant evicted — from the writer's own rows, oldest-first, with the
 * writer's row set often being just the row it had that instant created. A
 * second organization arriving on a filled install could not store a record at
 * all: `create()` returned the entity, the store persisted, and the row was
 * already gone. Silent, hard, no `deleted` status, no audit line, no recovery.
 *
 * `enterpriseRecordStore` is the backing store for all 106 ERP/CRM/HR/finance
 * modules — the largest data surface in the product. `traceStore` holds
 * regulated lot-and-shipment movement: the evidence a medical-device recall is
 * built from.
 *
 * The fourth is the classic shape in its last hiding place — the PERSIST call:
 *
 *     audit: this.audit.slice(0, 500)      // globalGovStore.persist()
 *
 * Round 8 replaced the two IN-MEMORY `slice(0, 500)` calls in this store with a
 * per-organization cap and left the one that decides what actually survives on
 * disk. A busy federating organization erased every other organization's
 * federated audit trail from the file, permanently, while `listAudit()` filtered
 * correctly the whole time.
 *
 * And one ownership defect of the other proven class — a delete resolved from a
 * caller-supplied id with no owner check (`resourceStore.upsertMany`).
 *
 * THE SHAPE OF THE PROOF
 *
 * Real stores, real temp files, three real organizations with DIFFERENT, NAMED
 * volumes — A 3, B 7, C 11 — and assertions on COUNT and on ROW IDENTITY, in
 * memory and in the bytes on disk. A is then driven far past the cap, and B and
 * C are asserted to hold exactly what they held; then B and C write again while
 * the store is still full, because that is the write the old code annihilated. A
 * suite asserting only `A !== B`, or mocking a store as `() => []`, would pass
 * against every broken version of this code.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloudResource, TenantScope, TraceEdge } from '@neuropause/shared';
import { makeResource } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { TraceEdgeStore } from '../medicalDevice/traceStore';
import { GlobalGovStore } from '../federation/governance/globalGovStore';
import { ResourceStore } from '../infrastructure/resourceStore';

/**
 * Three organizations. Deliberately NOT `TEST_TENANT_SCOPE`: the node setup
 * installs that as an AMBIENT fallback for `EnterpriseRecordStore`, and a
 * fixture reusing it could pass because the fallback answered rather than
 * because the boundary held. Every store below is also explicitly bound, so the
 * fallback is never consulted.
 */
const A: TenantScope = { tenantId: 'org-r10b2-a', workspaceId: 'ws-r10b2-a' };
const B: TenantScope = { tenantId: 'org-r10b2-b', workspaceId: 'ws-r10b2-b' };
const C: TenantScope = { tenantId: 'org-r10b2-c', workspaceId: 'ws-r10b2-c' };
/**
 * A fourth organization, used ONLY as the counterparty in the federation
 * fixtures. A federated audit row names two organizations and both are parties
 * to it, so if A federated WITH B then B could read A's rows and "B's trail"
 * would stop meaning "the rows B wrote". Each of A, B and C federates with this
 * one instead, which keeps the three trails disjoint and the assertions honest.
 */
const PEER: TenantScope = { tenantId: 'org-r10b2-peer', workspaceId: 'ws-r10b2-peer' };

/** The counts every assertion in this file is written against. */
const A_ROWS = 3;
const B_ROWS = 7;
const C_ROWS = 11;
/** What B and C write AFTER A has filled the store. The annihilated writes. */
const B_LATE = 3;
const C_LATE = 4;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-r10-batch2-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A monotonically increasing ISO clock, so eviction order is deterministic. */
function clock(): () => string {
  let t = Date.parse('2026-01-01T00:00:00.000Z');
  return () => {
    t += 1000;
    return new Date(t).toISOString();
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   1 — EnterpriseRecordStore: the store behind all 106 business modules
   ════════════════════════════════════════════════════════════════════════════ */

describe('enterprise-module-records — the record cap is per owner in BOTH halves', () => {
  /** 25, not 50,000: the defect is in the arithmetic, and the arithmetic scales. */
  const CAP = 25;

  interface Fixture {
    store: EnterpriseRecordStore;
    path: string;
    as: (scope: TenantScope) => void;
    now: () => string;
  }

  async function fixture(): Promise<Fixture> {
    const path = join(dir, 'records.json');
    let scope: TenantScope = A;
    const store = new EnterpriseRecordStore(path, 'finance', 'invoice', CAP).bindScope(() => scope);
    await store.load();
    return { store, path, as: (s) => { scope = s; }, now: clock() };
  }

  /** Titles are the row identity: stable, readable, and asserted verbatim. */
  function write(f: Fixture, scope: TenantScope, prefix: string, n: number, from = 1): string[] {
    f.as(scope);
    const titles: string[] = [];
    for (let i = from; i < from + n; i += 1) {
      const title = `${prefix}-${i}`;
      f.store.create({ title, fields: {}, now: f.now() });
      titles.push(title);
    }
    return titles;
  }

  function titlesOf(f: Fixture, scope: TenantScope): string[] {
    f.as(scope);
    return f.store.list().map((r) => r.title).sort();
  }

  it("one tenant filling the module cap does not delete or refuse another tenant's records", async () => {
    const f = await fixture();

    // Baseline: three organizations, three different volumes, all under the cap.
    const aFirst = write(f, A, 'a', A_ROWS);
    const bTitles = write(f, B, 'b', B_ROWS);
    const cTitles = write(f, C, 'c', C_ROWS);
    expect(aFirst).toHaveLength(A_ROWS);
    expect(titlesOf(f, B)).toEqual([...bTitles].sort());
    expect(titlesOf(f, C)).toEqual([...cTitles].sort());

    // A is driven FAR past the cap — 100 creates against a 25-row budget, which
    // is the Data Plane importer's shape (it accepts 200,000 rows per table).
    write(f, A, 'a', 100, A_ROWS + 1);

    // A rotates its OWN history and is held to its own budget.
    expect(titlesOf(f, A)).toHaveLength(CAP);

    // B and C still hold exactly what they held — count AND identity.
    expect(titlesOf(f, B)).toHaveLength(B_ROWS);
    expect(titlesOf(f, B)).toEqual([...bTitles].sort());
    expect(titlesOf(f, C)).toHaveLength(C_ROWS);
    expect(titlesOf(f, C)).toEqual([...cTitles].sort());

    /**
     * THE WRITE THE OLD CODE ANNIHILATED.
     *
     * The store is now permanently over its install-wide size, so before the
     * fix every one of these creates evicted the writer's own oldest row: B
     * stayed at 7 while losing b-1..b-3, and a tenant arriving on an already
     * full module could hold nothing at all.
     */
    const bLate = write(f, B, 'b', B_LATE, B_ROWS + 1);
    const cLate = write(f, C, 'c', C_LATE, C_ROWS + 1);

    expect(titlesOf(f, B)).toHaveLength(B_ROWS + B_LATE);
    expect(titlesOf(f, B)).toEqual([...bTitles, ...bLate].sort());
    expect(titlesOf(f, C)).toHaveLength(C_ROWS + C_LATE);
    expect(titlesOf(f, C)).toEqual([...cTitles, ...cLate].sort());

    // And on disk, which is the copy that survives a restart.
    await f.store.flush();
    const persisted = JSON.parse(readFileSync(f.path, 'utf8')) as {
      records: { title: string; tenantId: string }[];
    };
    const onDisk = (t: TenantScope): string[] =>
      persisted.records.filter((r) => r.tenantId === t.tenantId).map((r) => r.title).sort();
    expect(onDisk(B)).toEqual([...bTitles, ...bLate].sort());
    expect(onDisk(C)).toEqual([...cTitles, ...cLate].sort());
    expect(onDisk(A)).toHaveLength(CAP);
  });

  it('a tenant arriving on a module another tenant has already filled can still write', async () => {
    const f = await fixture();
    // A alone fills the module past its own cap.
    write(f, A, 'a', CAP + 40);
    expect(titlesOf(f, A)).toHaveLength(CAP);

    // B and C arrive afterwards. Every one of these rows used to be deleted by
    // the create that made it.
    const bTitles = write(f, B, 'b', B_ROWS);
    const cTitles = write(f, C, 'c', C_ROWS);
    expect(titlesOf(f, B)).toEqual([...bTitles].sort());
    expect(titlesOf(f, C)).toEqual([...cTitles].sort());
    await f.store.flush();
  });

  it('a tenant over its OWN cap still rotates its own oldest — the cap is not disabled', async () => {
    const f = await fixture();
    const aTitles = write(f, A, 'a', CAP + 5);
    const kept = titlesOf(f, A);
    expect(kept).toHaveLength(CAP);
    // The five oldest are gone; the newest CAP survive. A cap that stopped
    // capping would be the opposite failure and is not what was fixed.
    for (const gone of aTitles.slice(0, 5)) expect(kept).not.toContain(gone);
    for (const held of aTitles.slice(5)) expect(kept).toContain(held);
    await f.store.flush();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2 — TraceEdgeStore: regulated recall evidence
   ════════════════════════════════════════════════════════════════════════════ */

describe('medical-device-trace-edges — the edge cap is per manufacturer in BOTH halves', () => {
  /** 30 keeps the 10% eviction batch (3) visible; the real cap is 500,000. */
  const CAP = 30;

  function fixture(): { store: TraceEdgeStore; path: string; now: () => string } {
    const path = join(dir, 'trace.json');
    return { store: new TraceEdgeStore(path, CAP), path, now: clock() };
  }

  function record(
    f: { store: TraceEdgeStore; now: () => string },
    tenant: TenantScope,
    prefix: string,
    n: number,
    from = 1,
  ): string[] {
    const ids: string[] = [];
    for (let i = from; i < from + n; i += 1) {
      const lot = `${prefix}-lot-${i}`;
      f.store.record({
        tenantId: tenant.tenantId,
        kind: 'lot_derived_from',
        from: { type: 'lot', id: lot, label: lot },
        to: { type: 'lot', id: `${prefix}-parent`, label: `${prefix}-parent` },
        at: f.now(),
      });
      ids.push(lot);
    }
    return ids;
  }

  function lotsOf(store: TraceEdgeStore, tenant: TenantScope): string[] {
    return store
      .forTenant(tenant.tenantId)
      .map((e: TraceEdge) => e.from.id)
      .sort();
  }

  it("one manufacturer's volume does not delete another manufacturer's traceability edges", async () => {
    const f = fixture();
    await f.store.load();

    record(f, A, 'a', A_ROWS);
    const bLots = record(f, B, 'b', B_ROWS);
    const cLots = record(f, C, 'c', C_ROWS);
    expect(lotsOf(f.store, B)).toEqual([...bLots].sort());
    expect(lotsOf(f.store, C)).toEqual([...cLots].sort());

    // A is driven far past the cap.
    record(f, A, 'a', 200, A_ROWS + 1);
    expect(f.store.count(A.tenantId)).toBeLessThanOrEqual(CAP);
    expect(f.store.count(A.tenantId)).toBeGreaterThan(CAP - Math.ceil(CAP * 0.1) - 1);

    // B and C are untouched by it.
    expect(lotsOf(f.store, B)).toHaveLength(B_ROWS);
    expect(lotsOf(f.store, B)).toEqual([...bLots].sort());
    expect(lotsOf(f.store, C)).toHaveLength(C_ROWS);
    expect(lotsOf(f.store, C)).toEqual([...cLots].sort());

    // The writes that used to be annihilated: recording into a store another
    // manufacturer has already filled.
    const bLate = record(f, B, 'b', B_LATE, B_ROWS + 1);
    const cLate = record(f, C, 'c', C_LATE, C_ROWS + 1);
    expect(lotsOf(f.store, B)).toEqual([...bLots, ...bLate].sort());
    expect(lotsOf(f.store, C)).toEqual([...cLots, ...cLate].sort());

    await f.store.flush();
    const persisted = JSON.parse(readFileSync(f.path, 'utf8')) as { edges: TraceEdge[] };
    const onDisk = (t: TenantScope): string[] =>
      persisted.edges.filter((e) => e.tenantId === t.tenantId).map((e) => e.from.id).sort();
    expect(onDisk(B)).toEqual([...bLots, ...bLate].sort());
    expect(onDisk(C)).toEqual([...cLots, ...cLate].sort());
  });

  it('a manufacturer over its OWN cap still rotates its own oldest edges', async () => {
    const f = fixture();
    await f.store.load();
    const lots = record(f, A, 'a', CAP + 10);
    const kept = lotsOf(f.store, A);
    expect(kept.length).toBeLessThanOrEqual(CAP);
    // The batch drop is 10% of the cap, so the very oldest are definitely gone
    // and the very newest are definitely held.
    expect(kept).not.toContain(lots[0]);
    expect(kept).toContain(lots[lots.length - 1]);
    await f.store.flush();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3 — GlobalGovStore: the federated audit trail, on disk
   ════════════════════════════════════════════════════════════════════════════ */

describe('federation-global-governance — the audit cap is per organization ON DISK', () => {
  /** The store's own per-organization budget. The install-wide slice was the same number. */
  const PER_ORG = 500;

  function fixture(): { store: GlobalGovStore; path: string; as: (s: TenantScope) => void } {
    const path = join(dir, 'fedgov.json');
    let scope: TenantScope = A;
    const store = new GlobalGovStore(path, A.tenantId, 'Org A')
      .bindScope(() => scope)
      // Every organization here federates with every other; the party check is
      // asserted elsewhere and is not what this test is about.
      .bindPeerResolver(() => true)
      .bindActorNameResolver(() => scope.tenantId);
    return { store, path, as: (s) => { scope = s; } };
  }

  function act(
    f: { store: GlobalGovStore; as: (s: TenantScope) => void },
    scope: TenantScope,
    peer: TenantScope,
    prefix: string,
    n: number,
  ): string[] {
    f.as(scope);
    const details: string[] = [];
    for (let i = 1; i <= n; i += 1) {
      const detail = `${prefix}-action-${i}`;
      f.store.recordAction({
        action: 'cross_org_run',
        peerOrg: peer.tenantId,
        peerOrgName: peer.tenantId,
        trustLevel: 'verified',
        detail,
      });
      details.push(detail);
    }
    return details;
  }

  it("a busy organization's federated actions do not erase another organization's audit trail from the file", async () => {
    const f = fixture();
    await f.store.load();

    // B and C act FIRST, so their rows sit at the OLD end of the newest-first
    // array — which is precisely what `slice(0, 500)` cut off.
    const bDetails = act(f, B, PEER, 'b', B_ROWS);
    const cDetails = act(f, C, PEER, 'c', C_ROWS);
    // A then federates hard: 520 actions, past its own 500-row budget and past
    // the install-wide 500 the persist used to apply.
    act(f, A, PEER, 'a', PER_ORG + 20);

    await f.store.flush();
    const persisted = JSON.parse(readFileSync(f.path, 'utf8')) as {
      audit: { actorOrg: string; detail: string }[];
    };
    const forOrg = (t: TenantScope): string[] =>
      persisted.audit.filter((e) => e.actorOrg === t.tenantId).map((e) => e.detail).sort();

    // B and C keep every row, by count and by identity.
    expect(forOrg(B)).toHaveLength(B_ROWS);
    expect(forOrg(B)).toEqual([...bDetails].sort());
    expect(forOrg(C)).toHaveLength(C_ROWS);
    expect(forOrg(C)).toEqual([...cDetails].sort());
    // A is held to its own per-organization budget, not to a share of a global one.
    expect(forOrg(A)).toHaveLength(PER_ORG);

    // And it survives the restart, which is the whole point of a file.
    const reloaded = new GlobalGovStore(f.path, A.tenantId, 'Org A')
      .bindScope(() => B)
      .bindPeerResolver(() => true)
      .bindActorNameResolver(() => B.tenantId);
    await reloaded.load();
    expect(reloaded.listAudit().filter((e) => e.actorOrg === B.tenantId).map((e) => e.detail).sort()).toEqual(
      [...bDetails].sort(),
    );
    await reloaded.flush();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4 — ResourceStore: a delete resolved from a caller-supplied id
   ════════════════════════════════════════════════════════════════════════════ */

describe('infrastructure-resources — a discovery deletion cannot reach another tenant', () => {
  const NOW = '2026-07-13T00:00:00.000Z';

  /**
   * Two organizations pointed at the SAME cloud account. That is the case the
   * old resolver could not tell apart: it narrowed a `nativeId` match on
   * platform + account, which are properties of the CLOUD account and not of
   * the organization, and its exact-id arm checked nothing at all.
   */
  function res(nativeId: string): CloudResource {
    return makeResource({
      platformId: 'aws',
      provider: 'aws',
      accountId: '111',
      domain: 'compute',
      resourceType: 'ec2_instance',
      nativeId,
      name: nativeId,
      now: NOW,
    });
  }

  function fixture(): { store: ResourceStore; as: (s: TenantScope) => void } {
    let scope: TenantScope = A;
    const store = new ResourceStore(null).bindScope(() => scope);
    return { store, as: (s) => { scope = s; } };
  }

  async function seed(
    f: { store: ResourceStore; as: (s: TenantScope) => void },
    scope: TenantScope,
    prefix: string,
    n: number,
  ): Promise<string[]> {
    f.as(scope);
    const natives = Array.from({ length: n }, (_, i) => `${prefix}-i-${i + 1}`);
    await f.store.upsertMany(natives.map(res));
    return natives;
  }

  function nativesOf(f: { store: ResourceStore; as: (s: TenantScope) => void }, scope: TenantScope): string[] {
    f.as(scope);
    return f.store.all().map((r) => r.nativeId).sort();
  }

  it("a discovery pass naming every id in the store deletes only the discovering tenant's rows", async () => {
    const f = fixture();
    await f.store.load();
    const aNatives = await seed(f, A, 'a', A_ROWS);
    const bNatives = await seed(f, B, 'b', B_ROWS);
    const cNatives = await seed(f, C, 'c', C_ROWS);

    expect(nativesOf(f, A)).toEqual([...aNatives].sort());
    expect(nativesOf(f, B)).toEqual([...bNatives].sort());
    expect(nativesOf(f, C)).toEqual([...cNatives].sort());

    /**
     * B runs a discovery pass claiming that EVERY resource on the machine has
     * disappeared at the source — both as resolved ids and as native ids, which
     * are the two arms of the resolver. Only B's own may go.
     */
    const everyResolvedId = [...aNatives, ...bNatives, ...cNatives].map(
      (n) => `aws:111:ec2_instance:${n}`,
    );
    const everyNativeId = [...aNatives, ...bNatives, ...cNatives];
    f.as(B);
    const byId = await f.store.upsertMany([], everyResolvedId, { platformId: 'aws', accountId: '111' });
    expect(byId.deleted).toBe(B_ROWS);

    expect(nativesOf(f, A)).toHaveLength(A_ROWS);
    expect(nativesOf(f, A)).toEqual([...aNatives].sort());
    expect(nativesOf(f, C)).toHaveLength(C_ROWS);
    expect(nativesOf(f, C)).toEqual([...cNatives].sort());
    expect(nativesOf(f, B)).toEqual([]);

    // The native-id arm, on a store where B now owns nothing: a second pass
    // must delete nothing at all rather than falling through to A's or C's.
    f.as(B);
    const byNative = await f.store.upsertMany([], everyNativeId, { platformId: 'aws', accountId: '111' });
    expect(byNative.deleted).toBe(0);
    expect(nativesOf(f, A)).toEqual([...aNatives].sort());
    expect(nativesOf(f, C)).toEqual([...cNatives].sort());
  });

  it("a tenant's own source-deletion still works, by resolved id and by native id", async () => {
    const f = fixture();
    await f.store.load();
    const aNatives = await seed(f, A, 'a', A_ROWS);
    f.as(A);
    const byId = await f.store.upsertMany([], [`aws:111:ec2_instance:${aNatives[0]}`], {
      platformId: 'aws',
      accountId: '111',
    });
    expect(byId.deleted).toBe(1);
    const byNative = await f.store.upsertMany([], [aNatives[1]], { platformId: 'aws', accountId: '111' });
    expect(byNative.deleted).toBe(1);
    expect(nativesOf(f, A)).toEqual([aNatives[2]]);
  });
});
