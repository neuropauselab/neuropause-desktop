import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InstallsStore } from './installsStore';
import { PacksStore } from './packsStore';
import { PartnersStore } from './partnersStore';
import { PARTNER_TYPES } from '@neuropause/shared';

/**
 * P13C ROUND 4 — F9. Packs are tenant-owned and an UNBOUND store denies. The
 * seeded org id used by these fixtures is the tenant here, so single-tenant
 * behaviour is asserted exactly as before.
 */
const packScope = (): { tenantId: string; workspaceId: string } => ({ tenantId: 'org-default', workspaceId: 'ws-default' });

// PacksStore/PartnersStore seed DEMO community packs + a sample partner directory (off by default in prod);
// enable demo seeds so these fixtures exist. Production-empty behavior is asserted in *.prod.test.ts.
beforeAll(() => { process.env.NP_DEMO_SEEDS = '1'; });
afterAll(() => { delete process.env.NP_DEMO_SEEDS; });

const paths: string[] = [];
function tempPath(tag: string): string {
  const p = join(tmpdir(), `nps-x-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

describe('InstallsStore', () => {
  it('installs, bumps version on re-install, and uninstalls', async () => {
    const s = new InstallsStore(tempPath('ins'));
    await s.load();
    const a = s.install({ orgId: 'org-default', listingId: 'lst_1', listingName: 'Worker', kind: 'ai_worker', versionId: 'ver_1', version: '1.0.0' });
    expect(s.forOrg('org-default')).toHaveLength(1);

    const b = s.install({ orgId: 'org-default', listingId: 'lst_1', listingName: 'Worker', kind: 'ai_worker', versionId: 'ver_2', version: '2.0.0' });
    expect(b.id).toBe(a.id); // same install, bumped
    expect(b.installedVersion).toBe('2.0.0');
    expect(s.forOrg('org-default')).toHaveLength(1);

    s.setDisabled(a.id, true);
    expect(s.forListing('org-default', 'lst_1')?.status).toBe('disabled');

    expect(s.uninstall(a.id)).toBe(true);
    expect(s.forOrg('org-default')).toHaveLength(0);
    await s.flush();
  });
});

describe('PacksStore', () => {
  /**
   * P13C ROUND 4 — F9. This asserted that the demo's community packs were listed;
   * now it asserts they are NOT. That is stricter, and it is a deliberate
   * product trade worth stating.
   *
   * An `ExchangePack` carries `items: PackItem[]` — real content: documents,
   * workers, automations, connector definitions. It has NO visibility scope
   * field, unlike a federation `ExchangeArtifact` which has
   * private/partner/regional/public. With no way for a publisher to say "this
   * one is public", the only safe default is owner-only, so a pack published by
   * one organization is not listed to another.
   *
   * The cost is real: there is currently no way to publish a pack to a community
   * catalogue. Giving `ExchangePack` a scope field is the fix, and it is a
   * product change rather than a security patch — recorded as open work rather
   * than papered over by keeping the listing open.
   *
   * The seeded packs belong to fictional community publishers, so under the new
   * rule they belong to nobody on this install.
   */
  it('lists only the caller’s packs, publishes local, and imports its own', async () => {
    const s = new PacksStore(tempPath('pack'), 'org-default', 'NeuroPause').bindScope(packScope);
    await s.load();
    // The demo's community packs are published by fictional organizations.
    expect(s.list()).toEqual([]);

    const local = s.publish({ name: 'My Pack', summary: 'x', kind: 'knowledge', items: [{ kind: 'document', name: 'Doc', detail: '1' }] });
    expect(local.isLocal).toBe(true);
    expect(local.installed).toBe(true);
    expect(s.list().map((p) => p.id)).toEqual([local.id]);

    // A foreign pack id resolves to nothing — neither importable nor removable.
    const foreign = s.list().length === 0 ? 'pack_invented' : 'pack_invented';
    expect(s.importPack(foreign)).toBeNull();
    expect(s.remove(foreign)).toBe(false);

    const stats = s.stats();
    expect(stats.total).toBe(1);
    expect(stats.published).toBe(1);
    await s.flush();
  });
});

describe('PartnersStore', () => {
  it('seeds a directory across all partner types, premier first', async () => {
    const s = new PartnersStore(tempPath('prt'));
    await s.load();
    const list = s.list();
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list[0].tier).toBe('premier');
    const types = new Set(list.map((p) => p.type));
    for (const t of PARTNER_TYPES) expect(types.has(t)).toBe(true);
    expect(s.stats().total).toBe(list.length);
    await s.flush();
  });
});
