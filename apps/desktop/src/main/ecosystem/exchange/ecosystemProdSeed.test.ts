/**
 * Product Integrity v1.0 — ecosystem authenticity guardrails. With demo seeds OFF (production default), the
 * ecosystem exchange stores must be empty of fabricated community packs (invented install counts) and the
 * sample partner directory (invented listing counts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PacksStore } from './packsStore';
import { PartnersStore } from './partnersStore';

beforeAll(() => { delete process.env.NP_DEMO_SEEDS; });

const tmp = (name: string): string => join(tmpdir(), `np-prod-${randomUUID()}-${name}`);

describe('ecosystem exchange stores — production seed (no demo data)', () => {
  it('PacksStore seeds NO community packs (no fabricated install counts)', async () => {
    const s = new PacksStore(tmp('packs.json'), 'org-x', 'Acme');
    await s.load();
    expect(s.list()).toHaveLength(0);
  });

  it('PartnersStore seeds NO partner directory (no fabricated listing counts)', async () => {
    const s = new PartnersStore(tmp('partners.json'));
    await s.load();
    expect(s.list()).toHaveLength(0);
  });
});
