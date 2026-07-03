import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InstallsStore } from './installsStore';
import { PacksStore } from './packsStore';
import { PartnersStore } from './partnersStore';
import { PARTNER_TYPES } from '@neuropause/shared';

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
  it('seeds community packs, publishes local, and imports', async () => {
    const s = new PacksStore(tempPath('pack'), 'org-default', 'NeuroPause');
    await s.load();
    const seeded = s.list();
    expect(seeded.length).toBeGreaterThanOrEqual(4);
    expect(seeded.every((p) => !p.isLocal)).toBe(true);

    const local = s.publish({ name: 'My Pack', summary: 'x', kind: 'knowledge', items: [{ kind: 'document', name: 'Doc', detail: '1' }] });
    expect(local.isLocal).toBe(true);
    expect(local.installed).toBe(true);

    const target = seeded[0];
    const imported = s.importPack(target.id);
    expect(imported?.installed).toBe(true);
    expect(imported?.installs).toBe(target.installs + 1);

    const stats = s.stats();
    expect(stats.published).toBe(1);
    expect(stats.imported).toBeGreaterThanOrEqual(2);
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
