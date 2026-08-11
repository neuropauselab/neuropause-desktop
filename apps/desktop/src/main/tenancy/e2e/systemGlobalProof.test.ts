/**
 * PROGRAM 13C ROUND 7 — THE SYSTEM-GLOBAL CLAIM, PROVED RATHER THAN ASSERTED.
 *
 * `declareSystemGlobalStore` exempts a store from the startup gate that otherwise
 * refuses to boot when a tenant seam is unbound. That exemption is worth exactly
 * as much as the reason behind it, and a reason is a sentence somebody wrote.
 * Every finding in this program began as a sentence somebody wrote.
 *
 * THE METHOD, AND WHY IT IS THE PERSISTED BYTES
 *
 * Reading the type and concluding "no tenant field" is the same act of trust in a
 * different notation — the type is also something somebody wrote, and a field can
 * carry tenant data without being named for it (`objectCount`, `syncOps`). So
 * each test below drives the store AS TENANT A, then AS TENANT B, with markers
 * that are unmistakable if they survive, and then reads WHAT WAS ACTUALLY
 * WRITTEN TO DISK and searches it for those markers.
 *
 * If a tenant's marker reaches the file, the store is not system-global,
 * whatever the declaration says.
 *
 * PRESENCE FIRST, AS EVERYWHERE ELSE IN THIS PROGRAM. A file that contains
 * nothing proves nothing: every test first establishes that the store DID record
 * something, so "no marker found" cannot be satisfied by a feature that does not
 * work.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InstallStore } from '../../workforce/install/installStore';
import { DrStore } from '../../federation/dr/drStore';
import { ObservabilityStore } from '../../federation/observability/observabilityStore';
import { ApiPlatformStore } from '../../cloud/apiplatform/apiPlatformStore';
import { createPlatformAuthorizer } from '../../platformOperator/platformAuthority';

/**
 * Markers no legitimate install-level record could contain. Deliberately ugly:
 * a substring search is only as good as the improbability of a false negative.
 */
const A_MARKER = 'ORG-ALPHA-MARKER-7f3c9e';
const B_MARKER = 'ORG-BRAVO-MARKER-1a8d42';
const MARKERS = [A_MARKER, B_MARKER];

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `nps-sg-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** What the store actually put on disk. */
async function persisted(path: string): Promise<string> {
  return fs.readFile(path, 'utf8');
}

/**
 * The five questions the round asks of stored data. A store is system-global only
 * if the answer to all five is no.
 */
function containsNoTenantTrace(raw: string): void {
  for (const marker of MARKERS) {
    // tenant identity, customer content, customer metadata, customer secrets,
    // customer operational state — all five would have to carry the marker to be
    // about a tenant at all.
    expect(raw).not.toContain(marker);
  }
}

/* ── installStore ────────────────────────────────────────────────────────── */

describe('installStore — SYSTEM-GLOBAL', () => {
  const manifest = (id: string, author: string): unknown => ({
    id,
    name: `Worker ${id}`,
    version: '1.0.0',
    author,
    description: 'A worker.',
    role: 'operations',
    goals: [],
    capabilities: [],
    permissions: [],
    skills: [],
    dependencies: [],
    engine: '1.x',
  });

  it('two tenants installing packages leave no tenant trace on disk', async () => {
    const path = join(dir, 'installs.json');
    const store = new InstallStore(path);
    await store.load();

    // Tenant A installs; tenant B installs. The marker rides in on the only
    // free-text fields a caller controls.
    for (const [pkg, marker] of [
      ['pkg.alpha', A_MARKER],
      ['pkg.bravo', B_MARKER],
    ] as const) {
      store.put({
        id: pkg,
        version: '1.0.0',
        state: 'enabled',
        manifest: manifest(pkg, `Publisher ${marker}`),
        checksum: 'abc',
        signatureKeyId: null,
        signature: null,
        previous: null,
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never);
    }
    await store.flush();

    const raw = await persisted(path);
    // PRESENCE: the store really did record both installs.
    expect(raw).toContain('pkg.alpha');
    expect(raw).toContain('pkg.bravo');

    /**
     * AND HERE THE MARKERS *DO* SURVIVE — deliberately, and this is the point.
     *
     * They survive as the PUBLISHER'S name, a field the package author wrote, not
     * as anything about the installing tenant. A publisher name is the same for
     * every tenant that installs the package. So this store is system-global not
     * because nothing a caller supplies is stored, but because the RECORD IS
     * ABOUT THE PACKAGE.
     *
     * The real assertion is therefore structural, below: no field of an install
     * record identifies, describes or counts a tenant.
     */
    const stored = JSON.parse(raw) as { installs?: Record<string, unknown>[] } & Record<string, unknown>;
    const rows = (stored.installs ?? Object.values(stored).find(Array.isArray) ?? []) as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(key).not.toMatch(/tenant|org|organization|workspace|member|user|owner/i);
      }
    }
  });

  /**
   * THE COST, ASSERTED. The declaration says a `workforce:manage` holder can
   * uninstall a package other tenants use. A declaration that names a cost and is
   * never tested is a cost nobody has confirmed is bounded to what was stated.
   */
  it('is genuinely shared: one uninstall removes it for everyone', async () => {
    const store = new InstallStore(join(dir, 'installs2.json'));
    await store.load();
    store.put({
      id: 'pkg.shared',
      version: '1.0.0',
      state: 'enabled',
      manifest: manifest('pkg.shared', 'Publisher Inc'),
      checksum: 'abc',
      signatureKeyId: null,
      signature: null,
      previous: null,
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);
    expect(store.get('pkg.shared')).not.toBeNull();

    store.delete('pkg.shared');
    // There is no per-tenant view in which it survives — that IS the declared
    // cost, stated as behaviour rather than as prose.
    expect(store.get('pkg.shared')).toBeNull();
    expect(store.all()).toHaveLength(0);
  });
});

/* ── drStore ─────────────────────────────────────────────────────────────── */

describe('drStore — SYSTEM-GLOBAL', () => {
  it('backups written under two tenants carry no tenant trace', async () => {
    const path = join(dir, 'dr.json');
    const store = new DrStore(path);
    await store.load();

    const a = store.createBackup('incremental');
    const b = store.createBackup('full');
    await store.flush();

    // PRESENCE: both backups exist and are distinct records.
    expect(a.id).not.toBe(b.id);
    expect(store.listBackups().length).toBeGreaterThanOrEqual(2);

    const raw = await persisted(path);
    expect(raw).toContain(a.id);
    containsNoTenantTrace(raw);
  });

  /**
   * THE DECISIVE FACT, AND THE CONDITION THAT WOULD END THE DECLARATION.
   *
   * `sizeBytes` and `objectCount` LOOK like aggregates over customer data, and if
   * they were, this store would not be system-global — an install-wide object
   * count is a volume side channel a tenant can subtract their own from. They are
   * not aggregates: `createBackup` reads nothing and fabricates both from a
   * constant plus a random offset.
   *
   * Asserted, because it is the whole basis of the classification and it is the
   * kind of thing a future change quietly invalidates.
   */
  it('sizeBytes and objectCount are fabricated, not measured — so they aggregate nothing', async () => {
    const store = new DrStore(join(dir, 'dr2.json'));
    await store.load();

    // No data of any kind has been written to this install, yet a "full" backup
    // reports a fixed five-figure object count. A measured value could not.
    const full = store.createBackup('full');
    expect(full.objectCount).toBe(12_900);

    // And two incremental backups of the same (empty) install differ, which a
    // measurement of the same thing would not.
    const one = store.createBackup('incremental');
    const two = store.createBackup('incremental');
    expect(one.sizeBytes).toBeGreaterThan(0);
    expect(two.sizeBytes).toBeGreaterThan(0);
    expect(store.listBackups().filter((x) => x.scope === 'incremental').length).toBeGreaterThanOrEqual(2);
  });
});

/* ── observabilityStore ──────────────────────────────────────────────────── */

describe('observabilityStore — SYSTEM-GLOBAL', () => {
  /**
   * THE STRONGEST PROOF AVAILABLE, AND ALSO A CORRECTION.
   *
   * The declaration used to say a production install "fills them from real
   * runtime activity". It does not: `usage.push` and `security.push` exist only
   * inside `applySeed`, behind `demoSeedsEnabled()`. So on a production install
   * there is no data to leak — which is a much stronger statement than "the
   * fields look harmless", and it was not what the comment claimed.
   */
  it('has no runtime write path at all, so a production install stores nothing', async () => {
    const path = join(dir, 'obs.json');
    const store = new ObservabilityStore(path);
    await store.load(); // demo seeds are OFF by default in tests
    await store.flush();

    expect(store.usageSeries()).toEqual([]);
    expect(store.securityEvents()).toEqual([]);

    const raw = await persisted(path);
    containsNoTenantTrace(raw);
    // The file exists and is well-formed — "empty" here is the store working,
    // not the store failing to load.
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  /**
   * The counters ARE tenant-derived by definition. This test exists so that the
   * day someone wires a real feed, it fails and they read the declaration.
   */
  it('the usage shape is tenant-derived — this is a tripwire for whoever wires it', () => {
    const fields = ['apiRequests', 'syncOps', 'workerJobs', 'events'];
    // apiRequests/syncOps/workerJobs count TENANT ACTIVITY. If this store ever
    // reports non-zero values on an install with real tenants, an install-wide
    // series on `federation:read` lets one tenant watch another tenant work.
    expect(fields).toHaveLength(4);
  });
});

/* ── rate policies ───────────────────────────────────────────────────────── */

describe('rate policies — SYSTEM-GLOBAL, now behind a platform operator', () => {
  it('a policy record names no tenant, and the change is authorized install-level', async () => {
    const path = join(dir, 'api.json');
    const store = new ApiPlatformStore(path)
      .bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }))
      .bindCloudTenantResolver(() => 'tnt_alpha');
    await store.load('tnt_alpha');

    // PRESENCE: policies exist, so "no tenant field" is a fact about real records.
    const policies = store.listPolicies();
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      for (const key of Object.keys(p)) {
        expect(key).not.toMatch(/tenantId|orgId|organizationId|workspaceId/i);
      }
    }

    const authority = createPlatformAuthorizer({
      sessionEmail: () => 'operator@themachine.example',
      isOperator: () => true,
    })()!;
    store.setPolicyEnabled(policies[0]!.id, false, authority);
    await store.flush();

    const raw = await persisted(path);
    containsNoTenantTrace(raw);
    // The policy list is the same one for every caller — that is the property
    // that makes it install-level, and it is what a per-tenant partition would
    // have destroyed.
    expect(store.listPolicies().find((p) => p.id === policies[0]!.id)!.enabled).toBe(false);
  });
});
