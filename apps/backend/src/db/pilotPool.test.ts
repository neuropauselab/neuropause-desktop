import { afterEach, describe, expect, it } from 'vitest';
import { pilotPool, pilotStoreConfigured, PilotStoreNotConfigured, identityKey, resetPilotPool } from './pilotPool';

/* ENV04 — the properties that hold without a live database. The connected-identity proof
 * itself requires two real databases and is recorded in the evidence package. */

const ORIG = process.env.PILOT_DATABASE_URL;
afterEach(async () => { process.env.PILOT_DATABASE_URL = ORIG; await resetPilotPool(); });

describe('ENV04 — the pilot pool never falls back to the product pool', () => {
  it('THROWS when PILOT_DATABASE_URL is absent — it does not borrow DATABASE_URL', async () => {
    delete process.env.PILOT_DATABASE_URL;
    await resetPilotPool();
    expect(() => pilotPool()).toThrow(PilotStoreNotConfigured);
    expect(pilotStoreConfigured()).toBe(false);
  });
  it('an empty or whitespace value is absence, not a connection string', async () => {
    for (const v of ['', '   ']) {
      process.env.PILOT_DATABASE_URL = v;
      await resetPilotPool();
      expect(() => pilotPool()).toThrow(PilotStoreNotConfigured);
    }
  });
  it('the module contains no product-pool fallback at source level', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raw = readFileSync(join(__dirname, 'pilotPool.ts'), 'utf8');
    /*
     * COMMENTS ARE STRIPPED FIRST. The first version of this test FAILED against correct
     * code, because the module's own comment says 'there is deliberately no
     * `PILOT_DATABASE_URL ?? DATABASE_URL`' — a source-level check tripping over its own
     * documentation. A scanner that cannot tell code from prose reports the absence of a
     * thing as its presence.
     */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toContain('PILOT_DATABASE_URL');          // control: code survived stripping
    expect(raw).toContain('NO FALLBACK');                  // control: prose really was present
    expect(src).not.toMatch(/PILOT_DATABASE_URL\s*(\|\||\?\?)/);
    expect(src).not.toMatch(/from '\.\/pool'/);
  });
});

describe('ENV04 — identity keys distinguish databases, not URL strings', () => {
  const id = (database: string, host: string | null = '10.0.0.1', port: number | null = 5432) =>
    ({ database, user: 'u', host, port });
  it('same host+port, different database -> different key', () => {
    expect(identityKey(id('pilot'))).not.toBe(identityKey(id('product')));
  });
  it('SAME database -> same key, regardless of the URL that reached it', () => {
    // This is the case a string comparison misses: two different connection strings that
    // resolve to one database produce one identity.
    expect(identityKey(id('product'))).toBe(identityKey(id('product')));
  });
  it('different host or port -> different key', () => {
    expect(identityKey(id('p', '10.0.0.1'))).not.toBe(identityKey(id('p', '10.0.0.2')));
    expect(identityKey(id('p', '10.0.0.1', 5432))).not.toBe(identityKey(id('p', '10.0.0.1', 5433)));
  });
});
