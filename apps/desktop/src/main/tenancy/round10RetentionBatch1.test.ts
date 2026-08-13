/**
 * P13C ROUND 10 — RETENTION AND REMOVAL ISOLATION, BATCH 1.
 *
 * WHAT THIS SUITE IS FOR
 *
 * Round 9's red team proved three HIGH findings that were one bug: `inboxStore`,
 * `webhookStore` and `runStore` each capped a SINGLE SHARED ARRAY, so one
 * tenant's volume silently deleted another tenant's notifications, dead-letter
 * queue and certification history. Every READ above those caps was correctly
 * filtered, which is why they survived four rounds of review — a filter HIDES a
 * row, a cap DELETES one, and only the read had ever been examined.
 *
 * All three passed the store-scope gate, because `registerTenantStore(name,
 * hasScope)` satisfies it and takes no retention argument at all. Round 10 added
 * `retentionScope` / `retentionAuthority`, which `declareStoreScope` can CHECK:
 * a `TENANT`/`WORKSPACE`/`USER` store whose removal reaches `INSTALL` now throws
 * at construction rather than shipping behind a correct read.
 *
 * Making twenty stores answer that question turned up two removals in this batch
 * that genuinely crossed an owner boundary, and this file is the proof that both
 * are closed. Each case is asserted the way this program has settled on:
 *
 *   THREE OWNERS WITH THREE DIFFERENT, NAMED ROW COUNTS — 3, 7 and 11 — the
 *   attacker driven hard through the removal path, and the other two asserted
 *   to hold EXACTLY their own number AND their own row identities afterwards.
 *
 * An isolation test whose victims are empty proves nothing: zero equals zero,
 * and this program has already shipped one assertion that passed vacuously for
 * exactly that reason. Nothing here is asserted with `A !== B`, no fixture is
 * empty, and every survivor is checked by identity as well as by count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectedAccount, TenantScope } from '@neuropause/shared';

/**
 * `connectorStore` and `connectorControlStore` import `electron` at module load
 * for `app.getPath('userData')`. The mock points both at a temp directory, so
 * the durable half of each assertion (reopen the file, read it back) is real
 * disk I/O rather than an in-memory illusion.
 */
const mockState = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: () => mockState.userDataDir,
    getAppPath: () => mockState.userDataDir,
    getVersion: () => '0.0.0-test',
    getName: () => 'neuropause-test',
    isPackaged: false,
    on: () => undefined,
    once: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import { RelationshipStore } from '../dataPlane/relationshipStore';
import { ConnectorControlStore } from '../connectors/connectorControlStore';
import { connectorStore } from '../connectors/connectorStore';

/* ── the three owners, and their three different numbers ────────────────── */

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-alpha' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-bravo' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-charlie' };

const A_ROWS = 3;
const B_ROWS = 7;
const C_ROWS = 11;

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-r10-batch1-'));
  mockState.userDataDir = dir;
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW FINDING 1 — dataPlane/relationshipStore.ts
 *
 * `linkIndex` and `pendingIndex` were keyed `slot(sourceRecordId,
 * relationshipKey)` WITH NO TENANT IN THE KEY. The file said so itself, in the
 * comment on `linkFor`: "a bare lookup would resolve another tenant's edge — an
 * index is a lookup structure, not a boundary." That was written about the READ,
 * which was hardened. The three WRITES underneath went on using the raw index:
 *
 *   link()  → this.links[indexOf(existing)] = link   OVERWRITES another org's edge
 *   link()  → dropPending(key)                        DELETES another org's parked row
 *   park()  → this.pending[indexOf(existing)] = entry OVERWRITES another org's row
 *                                                     with THIS caller's record title
 *                                                     and field value, in place,
 *                                                     under the victim's tenantId
 *
 * Round 10 puts the owner in the key. These tests drive the collision directly.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The one slot every tenant collides on: same record id, same relationship. */
const SHARED_RECORD = 'rec_shared_identifier';
const SHARED_KEY = 'payment.invoice';

/**
 * Sequential, not `Promise.all`: `RelationshipStore.persist` writes one fixed
 * `.tmp` path and renames it, with no write chain, so concurrent parks race on
 * the temp file. Serialising here keeps the test about ownership rather than
 * about that (real, separate, and out of this batch's scope) sharp edge.
 */
async function parkFixture(store: RelationshipStore, owner: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await store.park({
        relationshipKey: i === 0 ? SHARED_KEY : `${owner}.rel.${i}`,
        sourceModuleId: 'sales.invoices',
        // The FIRST row of every owner lands on the shared slot; the rest are
        // that owner's own. So each owner has exactly one colliding row.
        sourceRecordId: i === 0 ? SHARED_RECORD : `${owner}_rec_${i}`,
        sourceTitle: `${owner} invoice ${i}`,
        sourceField: 'customerRef',
        sourceValue: `${owner}-secret-value-${i}`,
        targetModuleId: 'crm.customers',
        targetLabel: 'Customer',
        status: 'unresolved',
        candidates: [],
        reason: 'no match',
        lastCheckedAt: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
        correlationId: null,
    });
  }
}

describe('relationship queue — one organization resolving a slot cannot delete another organization\'s', () => {
  it('A hammering the shared slot leaves B with exactly 7 and C with exactly 11 parked references', async () => {
    let scope: TenantScope = A;
    const store = new RelationshipStore(join(dir, 'relationships.json'));
    store.bindScope(() => scope);
    await store.load();

    scope = A;
    await parkFixture(store, 'alpha', A_ROWS);
    scope = B;
    await parkFixture(store, 'bravo', B_ROWS);
    scope = C;
    await parkFixture(store, 'charlie', C_ROWS);

    // The fixture is non-empty for all three BEFORE anything is driven, so a
    // later "still 7" cannot be satisfied by a store that never held them.
    scope = A;
    expect(store.queue(1000)).toHaveLength(A_ROWS);
    scope = B;
    expect(store.queue(1000)).toHaveLength(B_ROWS);
    scope = C;
    expect(store.queue(1000)).toHaveLength(C_ROWS);

    // A drives the removal path hard: 40 resolve/park cycles over the shared
    // slot, each of which used to retire whichever tenant's row the tenant-less
    // index happened to be holding.
    scope = A;
    for (let round = 0; round < 40; round += 1) {
      await store.link({
        relationshipKey: SHARED_KEY,
        sourceModuleId: 'sales.invoices',
        sourceRecordId: SHARED_RECORD,
        sourceField: 'customerRef',
        sourceValue: 'alpha-secret-value-0',
        targetModuleId: 'crm.customers',
        targetRecordId: `alpha_target_${round}`,
        method: 'manual',
        confidence: 1,
        decidedBy: 'alpha@example.com',
        at: '2026-02-01T00:00:00.000Z',
        correlationId: null,
        reason: 'chosen by alpha',
      });
      await parkFixture(store, 'alpha', 1);
    }

    /* B: exactly 7, BY COUNT and BY IDENTITY. */
    scope = B;
    const bQueue = store.queue(1000);
    expect(bQueue).toHaveLength(B_ROWS);
    expect(bQueue.map((p) => p.sourceValue).sort()).toEqual(
      Array.from({ length: B_ROWS }, (_, i) => `bravo-secret-value-${i}`).sort(),
    );
    // The colliding row is still B's own, with B's value — not overwritten with
    // A's record title and field contents, which is what `park` used to do.
    const bShared = bQueue.find((p) => p.sourceRecordId === SHARED_RECORD);
    expect(bShared?.sourceValue).toBe('bravo-secret-value-0');
    expect(bShared?.sourceTitle).toBe('bravo invoice 0');
    expect(bShared?.tenantId).toBe(B.tenantId);

    /* C: exactly 11, BY COUNT and BY IDENTITY. */
    scope = C;
    const cQueue = store.queue(1000);
    expect(cQueue).toHaveLength(C_ROWS);
    expect(cQueue.map((p) => p.sourceValue).sort()).toEqual(
      Array.from({ length: C_ROWS }, (_, i) => `charlie-secret-value-${i}`).sort(),
    );
    const cShared = cQueue.find((p) => p.sourceRecordId === SHARED_RECORD);
    expect(cShared?.sourceValue).toBe('charlie-secret-value-0');
    expect(cShared?.tenantId).toBe(C.tenantId);

    /* And the same, from disk. A cap that only looks fixed in memory is not. */
    const raw = JSON.parse(readFileSync(join(dir, 'relationships.json'), 'utf8')) as {
      pending: { tenantId?: string; sourceValue: string }[];
    };
    expect(raw.pending.filter((p) => p.tenantId === B.tenantId)).toHaveLength(B_ROWS);
    expect(raw.pending.filter((p) => p.tenantId === C.tenantId)).toHaveLength(C_ROWS);
  });

  it('A resolving the shared slot cannot overwrite or steal B\'s and C\'s resolved edges', async () => {
    let scope: TenantScope = A;
    const store = new RelationshipStore(join(dir, 'relationships.json'));
    store.bindScope(() => scope);
    await store.load();

    const edge = (owner: string, i: number): Parameters<RelationshipStore['link']>[0] => ({
      relationshipKey: i === 0 ? SHARED_KEY : `${owner}.rel.${i}`,
      sourceModuleId: 'sales.invoices',
      sourceRecordId: i === 0 ? SHARED_RECORD : `${owner}_rec_${i}`,
      sourceField: 'customerRef',
      sourceValue: `${owner}-value-${i}`,
      targetModuleId: 'crm.customers',
      targetRecordId: `${owner}_target_${i}`,
      method: 'manual',
      confidence: 1,
      decidedBy: `${owner}@example.com`,
      at: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
      correlationId: null,
      reason: `${owner} resolved it`,
    });

    scope = A;
    for (let i = 0; i < A_ROWS; i += 1) await store.link(edge('alpha', i));
    scope = B;
    for (let i = 0; i < B_ROWS; i += 1) await store.link(edge('bravo', i));
    scope = C;
    for (let i = 0; i < C_ROWS; i += 1) await store.link(edge('charlie', i));

    scope = B;
    expect(store.counts().links).toBe(B_ROWS);
    scope = C;
    expect(store.counts().links).toBe(C_ROWS);

    // A re-resolves the shared slot 40 times to a target of its own choosing.
    scope = A;
    for (let round = 0; round < 40; round += 1) {
      await store.link({ ...edge('alpha', 0), targetRecordId: `alpha_hijack_${round}` });
    }

    scope = B;
    expect(store.counts().links).toBe(B_ROWS);
    // B's edge on the shared slot still points where B put it.
    expect(store.linkFor(SHARED_RECORD, SHARED_KEY)?.targetRecordId).toBe('bravo_target_0');
    expect(store.outgoing(SHARED_RECORD).map((l) => l.targetRecordId)).toEqual(['bravo_target_0']);

    scope = C;
    expect(store.counts().links).toBe(C_ROWS);
    expect(store.linkFor(SHARED_RECORD, SHARED_KEY)?.targetRecordId).toBe('charlie_target_0');

    // A sees only its own, and its own is the one it just rewrote.
    scope = A;
    expect(store.counts().links).toBe(A_ROWS);
    expect(store.linkFor(SHARED_RECORD, SHARED_KEY)?.targetRecordId).toBe('alpha_hijack_39');
  });

  it('skip() refuses a pending id belonging to another organization', async () => {
    let scope: TenantScope = B;
    const store = new RelationshipStore(join(dir, 'relationships.json'));
    store.bindScope(() => scope);
    await store.load();

    scope = B;
    await parkFixture(store, 'bravo', B_ROWS);
    const victim = store.queue(1000)[0];
    expect(victim).toBeDefined();
    expect(victim?.status).not.toBe('skipped');

    // A holds B's id — the shape a renderer payload has.
    scope = A;
    expect(await store.skip(victim!.id, 'alpha@example.com', '2026-03-01T00:00:00.000Z')).toBeNull();

    scope = B;
    const after = store.queue(1000).find((p) => p.id === victim!.id);
    expect(after?.status).toBe(victim!.status);
    expect(after?.reason).toBe(victim!.reason);
    expect(store.queue(1000)).toHaveLength(B_ROWS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW FINDING 2 — connectors/connectorControlStore.ts
 *
 * `setDisabled(connectorId, false)` ran TWO deletes:
 *
 *     this.disabled.delete(k);              // workspaceId::connectorId — its own
 *     this.disabled.delete(connectorId);    // the BARE key — everybody's
 *
 * The second removed the LEGACY, pre-boundary flag, which `legacyDisabled`
 * applies to every workspace on the machine. So one workspace pressing "enable"
 * restarted a connector another organization had deliberately switched off — a
 * cross-tenant SAFETY CONTROL mutation, and the exact removal Round 8 wrote down
 * in this store's own `retention` string ("cleared install-wide") and shipped,
 * because prose cannot be checked.
 *
 * Round 10 replaces the delete with a per-workspace CLEARANCE: the shared row
 * belongs to nobody, so nobody may delete it; each workspace may only record
 * that it does not apply to itself.
 * ═══════════════════════════════════════════════════════════════════════════ */

const LEGACY_CONNECTOR = 'legacy-github';

/** Connector ids owned by each workspace: 3, 7 and 11 of them. */
const A_CONNECTORS = Array.from({ length: A_ROWS }, (_, i) => `alpha-conn-${i}`);
const B_CONNECTORS = Array.from({ length: B_ROWS }, (_, i) => `bravo-conn-${i}`);
const C_CONNECTORS = Array.from({ length: C_ROWS }, (_, i) => `charlie-conn-${i}`);
const ALL_CONNECTORS = [...A_CONNECTORS, ...B_CONNECTORS, ...C_CONNECTORS];

describe('connector controls — one workspace re-enabling cannot clear another workspace\'s kill switch', () => {
  it('A disabling and re-enabling 3 connectors leaves B with exactly 7 and C with exactly 11, and neither loses the legacy flag', async () => {
    const file = join(dir, 'connector-controls.json');
    // A file written before the workspace boundary existed: one bare connector
    // id, which applies to every workspace.
    writeFileSync(
      file,
      JSON.stringify({ pausedAccounts: [], disabledConnectors: [LEGACY_CONNECTOR] }),
      { mode: 0o600 },
    );

    let workspace = A.workspaceId;
    const store = new ConnectorControlStore(file);
    store.bindWorkspace(() => workspace);
    await store.load();

    // Every workspace inherits the legacy kill switch. Non-empty by construction.
    for (const ws of [A, B, C]) {
      workspace = ws.workspaceId;
      expect(store.isDisabled(LEGACY_CONNECTOR)).toBe(true);
    }

    workspace = A.workspaceId;
    for (const id of A_CONNECTORS) await store.setDisabled(id, true);
    workspace = B.workspaceId;
    for (const id of B_CONNECTORS) await store.setDisabled(id, true);
    workspace = C.workspaceId;
    for (const id of C_CONNECTORS) await store.setDisabled(id, true);

    const disabledCountFor = (ws: string): number => {
      workspace = ws;
      return ALL_CONNECTORS.filter((id) => store.isDisabled(id)).length;
    };
    expect(disabledCountFor(A.workspaceId)).toBe(A_ROWS);
    expect(disabledCountFor(B.workspaceId)).toBe(B_ROWS);
    expect(disabledCountFor(C.workspaceId)).toBe(C_ROWS);

    // A drives the removal path hard: 40 disable/enable cycles over its own
    // three, plus the re-enable of the legacy connector that used to clear the
    // shared row for everybody.
    workspace = A.workspaceId;
    for (let round = 0; round < 40; round += 1) {
      for (const id of A_CONNECTORS) {
        await store.setDisabled(id, false);
        await store.setDisabled(id, true);
      }
      await store.setDisabled(LEGACY_CONNECTOR, false);
      await store.setDisabled(LEGACY_CONNECTOR, true);
    }
    await store.setDisabled(LEGACY_CONNECTOR, false);

    /* A got what it asked for: its own connector runs again. */
    workspace = A.workspaceId;
    expect(store.isDisabled(LEGACY_CONNECTOR)).toBe(false);

    /* B: exactly 7, BY COUNT and BY IDENTITY, and the kill switch still on. */
    workspace = B.workspaceId;
    expect(ALL_CONNECTORS.filter((id) => store.isDisabled(id))).toEqual(B_CONNECTORS);
    expect(store.isDisabled(LEGACY_CONNECTOR)).toBe(true);

    /* C: exactly 11, BY COUNT and BY IDENTITY, and the kill switch still on. */
    workspace = C.workspaceId;
    expect(ALL_CONNECTORS.filter((id) => store.isDisabled(id))).toEqual(C_CONNECTORS);
    expect(store.isDisabled(LEGACY_CONNECTOR)).toBe(true);

    /* The shared row is still ON DISK. A clearance is not a deletion. */
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { disabledConnectors: string[] };
    expect(raw.disabledConnectors).toContain(LEGACY_CONNECTOR);

    /* And all of it survives a restart. */
    let reopenedWorkspace = B.workspaceId;
    const reopened = new ConnectorControlStore(file);
    reopened.bindWorkspace(() => reopenedWorkspace);
    await reopened.load();
    expect(ALL_CONNECTORS.filter((id) => reopened.isDisabled(id))).toEqual(B_CONNECTORS);
    expect(reopened.isDisabled(LEGACY_CONNECTOR)).toBe(true);
    reopenedWorkspace = C.workspaceId;
    expect(ALL_CONNECTORS.filter((id) => reopened.isDisabled(id))).toEqual(C_CONNECTORS);
    expect(reopened.isDisabled(LEGACY_CONNECTOR)).toBe(true);
    reopenedWorkspace = A.workspaceId;
    expect(reopened.isDisabled(LEGACY_CONNECTOR)).toBe(false);
  });

  it('an unresolved workspace still sees the legacy kill switch, and cannot clear one', async () => {
    const file = join(dir, 'connector-controls.json');
    writeFileSync(
      file,
      JSON.stringify({ pausedAccounts: [], disabledConnectors: [LEGACY_CONNECTOR] }),
      { mode: 0o600 },
    );
    let workspace = '';
    const store = new ConnectorControlStore(file);
    store.bindWorkspace(() => workspace);
    await store.load();

    // No workspace resolved: the SAFETY control stands, and disabling is refused
    // outright rather than silently reported as done.
    expect(store.isDisabled(LEGACY_CONNECTOR)).toBe(true);
    await expect(store.setDisabled(LEGACY_CONNECTOR, false)).rejects.toThrow(/no workspace/i);

    workspace = B.workspaceId;
    expect(store.isDisabled(LEGACY_CONNECTOR)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * HARDENING — connectors/connectorStore.ts
 *
 * `remove(connectorId, accountId)` was `accounts.delete(connectorId::accountId)`
 * on a bare pair that arrives from a renderer payload. The ownership check
 * existed, in its ONE caller (`connectorService.disconnect` resolves through the
 * workspace-scoped `get()` first). That is the arrangement this program has
 * repeatedly watched become a cross-boundary delete one refactor later, so the
 * check is now the store's own.
 * ═══════════════════════════════════════════════════════════════════════════ */

function account(workspaceId: string, connectorId: string, id: string): ConnectedAccount {
  return {
    id,
    connectorId,
    workspaceId,
    label: `${workspaceId} ${id}`,
    externalId: null,
    avatarUrl: null,
    status: 'connected',
    health: 'healthy',
    grantedScopes: [],
    connectedAt: '2026-01-01T00:00:00.000Z',
    lastSyncAt: null,
    lastSyncState: 'idle',
    accessTokenExpiresAt: null,
    error: null,
  };
}

describe('connector accounts — remove() is workspace-scoped in the store, not only in its caller', () => {
  it('A cannot remove B\'s or C\'s accounts, and B keeps exactly 7 while C keeps exactly 11', async () => {
    let workspace = A.workspaceId;
    connectorStore.bindWorkspace(() => workspace);
    await connectorStore.load();

    const ids = (prefix: string, n: number): string[] =>
      Array.from({ length: n }, (_, i) => `${prefix}_acct_${i}`);
    const aIds = ids('alpha', A_ROWS);
    const bIds = ids('bravo', B_ROWS);
    const cIds = ids('charlie', C_ROWS);

    for (const id of aIds) await connectorStore.upsert(account(A.workspaceId, 'github', id));
    for (const id of bIds) await connectorStore.upsert(account(B.workspaceId, 'github', id));
    for (const id of cIds) await connectorStore.upsert(account(C.workspaceId, 'github', id));

    workspace = A.workspaceId;
    expect(connectorStore.all().map((a) => a.id).sort()).toEqual([...aIds].sort());
    workspace = B.workspaceId;
    expect(connectorStore.all()).toHaveLength(B_ROWS);
    workspace = C.workspaceId;
    expect(connectorStore.all()).toHaveLength(C_ROWS);

    // A, holding every id there is, tries to remove all of them.
    workspace = A.workspaceId;
    for (const id of [...bIds, ...cIds]) await connectorStore.remove('github', id);

    workspace = B.workspaceId;
    expect(connectorStore.all().map((a) => a.id).sort()).toEqual([...bIds].sort());
    workspace = C.workspaceId;
    expect(connectorStore.all().map((a) => a.id).sort()).toEqual([...cIds].sort());

    // A removing its OWN still works — the refusal is about ownership, not about
    // having broken the operation.
    workspace = A.workspaceId;
    await connectorStore.remove('github', aIds[0]!);
    expect(connectorStore.all().map((a) => a.id).sort()).toEqual([...aIds].slice(1).sort());

    // On disk, too.
    const raw = JSON.parse(readFileSync(join(dir, 'connectors.json'), 'utf8')) as ConnectedAccount[];
    expect(raw.filter((a) => a.workspaceId === B.workspaceId)).toHaveLength(B_ROWS);
    expect(raw.filter((a) => a.workspaceId === C.workspaceId)).toHaveLength(C_ROWS);
  });
});
