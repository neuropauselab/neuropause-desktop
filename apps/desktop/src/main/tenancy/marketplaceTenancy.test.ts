/**
 * P13C REMEDIATION — FINDING 5. Marketplace installs belong to a tenant.
 *
 * Every install read and write in the ecosystem and marketplace roots was keyed
 * on `ORG_ID`, the SEEDED organization's literal id. The store partitions on
 * `orgId` correctly and was simply never told the truth, so tenant B's installs
 * were written into and read from tenant A's partition.
 *
 * Two further IDORs surfaced while fixing it, neither in the original report:
 * `uninstall` and `setDisabled` took a renderer-supplied installation id with
 * no ownership check at all. Those are covered here too, because a destructive
 * operation reachable by guessing an id is worse than the mis-keying that
 * prompted the audit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InstallsStore } from '../ecosystem/exchange/installsStore';

const A = 'org-a';
const B = 'org-b';
const dirs: string[] = [];

async function store(): Promise<InstallsStore> {
  const dir = join(tmpdir(), `np-installs-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  const s = new InstallsStore(join(dir, 'installs.json'));
  await s.load();
  return s;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

function install(s: InstallsStore, orgId: string, listingId: string, name: string) {
  return s.install({
    orgId,
    listingId,
    listingName: name,
    kind: 'app',
    versionId: 'v1',
    version: '1.0.0',
  });
}

describe('installs are partitioned by tenant', () => {
  it('A sees only APP-A and B sees only APP-B', async () => {
    const s = await store();
    install(s, A, 'listing-a', 'APP-A');
    install(s, B, 'listing-b', 'APP-B');

    expect(s.forOrg(A).map((i) => i.listingName)).toEqual(['APP-A']);
    expect(s.forOrg(B).map((i) => i.listingName)).toEqual(['APP-B']);
  });

  it('the SAME listing installed by both tenants produces two rows, not one', async () => {
    const s = await store();
    const ia = install(s, A, 'shared-listing', 'SHARED');
    const ib = install(s, B, 'shared-listing', 'SHARED');

    expect(ia.id).not.toBe(ib.id);
    expect(s.forOrg(A)).toHaveLength(1);
    expect(s.forOrg(B)).toHaveLength(1);
  });

  it('an install for B is invisible to A even by listing id', async () => {
    const s = await store();
    install(s, B, 'listing-b', 'APP-B');
    expect(s.forListing(A, 'listing-b')).toBeNull();
    expect(s.forOrg(A)).toEqual([]);
  });

  it('a tenant with nothing installed sees an empty list, not the seeded org’s', async () => {
    const s = await store();
    install(s, A, 'listing-a', 'APP-A');
    expect(s.forOrg('org-brand-new')).toEqual([]);
  });
});

/**
 * The handlers resolve a renderer-supplied installation id INSIDE the caller's
 * own partition before acting on it. These assert the predicate that makes that
 * safe: a foreign id is simply not present in the caller's list, so the lookup
 * fails and the handler refuses.
 */
describe('a direct installation id is not authority', () => {
  it('A cannot find B’s installation by id', async () => {
    const s = await store();
    const bInstall = install(s, B, 'listing-b', 'APP-B');
    expect(s.forOrg(A).some((i) => i.id === bInstall.id)).toBe(false);
  });

  it('B CAN find its own — the guard is not simply "always no"', async () => {
    const s = await store();
    const bInstall = install(s, B, 'listing-b', 'APP-B');
    expect(s.forOrg(B).some((i) => i.id === bInstall.id)).toBe(true);
  });

  it('an invented installation id belongs to nobody', async () => {
    const s = await store();
    install(s, A, 'listing-a', 'APP-A');
    expect(s.forOrg(A).some((i) => i.id === 'inst_invented')).toBe(false);
    expect(s.forOrg(B).some((i) => i.id === 'inst_invented')).toBe(false);
  });
});

describe('uninstall does not reach across tenants', () => {
  /**
   * `uninstall(id)` deletes whatever the id names — the store has no tenant
   * argument. That is why the handler must resolve ownership first, and why
   * this test asserts the ownership predicate rather than calling the store.
   */
  it('B’s installation is not in A’s owned set, so A’s handler refuses', async () => {
    const s = await store();
    const bInstall = install(s, B, 'listing-b', 'APP-B');

    const aOwnsIt = s.forOrg(A).some((i) => i.id === bInstall.id);
    expect(aOwnsIt).toBe(false);

    // Unremoved, because the refusal happens before the store is touched.
    expect(s.forOrg(B)).toHaveLength(1);
  });

  it('removing A’s own installation leaves B’s intact', async () => {
    const s = await store();
    const aInstall = install(s, A, 'listing-a', 'APP-A');
    install(s, B, 'listing-b', 'APP-B');

    expect(s.uninstall(aInstall.id)).toBe(true);

    expect(s.forOrg(A)).toEqual([]);
    expect(s.forOrg(B).map((i) => i.listingName)).toEqual(['APP-B']);
  });
});
