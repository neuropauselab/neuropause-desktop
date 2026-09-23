import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalBytes, keyIdFor, type SignableAuthorityRow } from './authoritySignature';
import { PILOT_TRUST_SCOPE } from './authorityTrust';

/* ==========================================================================================
 * OPTION_B's THIRD NAMED CHANGE: "verify in `loadAuthorityDecisions` BEFORE the snapshot is
 * built." This pins the PLACEMENT, which is the part that makes the control unskippable:
 * an unverified row must never become an AuthorityDecisionArtifact at all.
 * ========================================================================================== */

const rows: Record<string, unknown>[] = [];
vi.mock('../db/pool', () => ({
  query: vi.fn(async () => ({ rows, rowCount: rows.length })),
  withTransaction: vi.fn(),
}));

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_ID = keyIdFor(PUB);

const dirs: string[] = [];
const trustFile = (scope = PILOT_TRUST_SCOPE): string => {
  const d = mkdtempSync(join(tmpdir(), 'np036-trust-'));
  dirs.push(d);
  const p = join(d, 'trust.json');
  writeFileSync(p, JSON.stringify({
    keys: [{ key_id: KEY_ID, algorithm: 'ed25519', scope, public_key_pem: PUB }],
  }));
  return p;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const BASE: SignableAuthorityRow = {
  instrument: 'NP-PILOT-FIRST-EXEC-AUTH-001',
  authenticated: true,
  actions: ['pilot.stop'],
  environment_class: 'PILOT',
  effective_from: '2026-09-01T00:00:00.000Z',
  expires_at: null,
  revoked_at: null,
};
const dbRow = (over: Partial<Record<string, unknown>> = {}, signed = true) => {
  const r = { ...BASE, ...over } as SignableAuthorityRow;
  return {
    instrument: r.instrument, authenticated: r.authenticated, actions: r.actions,
    environment_class: r.environment_class,
    effective_from: r.effective_from, expires_at: r.expires_at, revoked_at: r.revoked_at,
    signature: signed ? cryptoSign(null, canonicalBytes(r), privateKey).toString('base64') : null,
    signer_key_id: signed ? KEY_ID : null,
    ...over,
  };
};

const ENV = process.env.PILOT_AUTHORITY_TRUST_FILE;
beforeEach(() => { rows.length = 0; vi.resetModules(); });
afterEach(() => { process.env.PILOT_AUTHORITY_TRUST_FILE = ENV; });

const load = async () => (await import('./authorityStore')).loadAuthorityDecisions();
const refusals = async () => (await import('./authorityStore')).lastAuthorityVerificationRefusals();

describe('loadAuthorityDecisions verifies BEFORE building artifacts', () => {
  it('POSITIVE CONTROL — a correctly signed row IS admitted', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile();
    rows.push(dbRow());
    const out = await load();
    expect(out).toHaveLength(1);
    expect(out[0].instrument).toBe('NP-PILOT-FIRST-EXEC-AUTH-001');
  });

  it('an UNSIGNED row never becomes an artifact', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile();
    rows.push(dbRow({}, false));
    expect(await load()).toEqual([]);
  });

  it('a row signed over DIFFERENT values is excluded — the DB value is what gets verified', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile();
    const r = dbRow();
    r.environment_class = 'PRODUCTION'; // tampered after signing
    rows.push(r);
    expect(await load()).toEqual([]);
  });

  it('WITH NO TRUST FILE the loader admits nothing — the no-ceremony posture', async () => {
    delete process.env.PILOT_AUTHORITY_TRUST_FILE;
    rows.push(dbRow());
    expect(await load()).toEqual([]);
  });

  it('a production-release scoped trust file admits nothing', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile('production-release');
    rows.push(dbRow());
    expect(await load()).toEqual([]);
  });

  it('mixed rows: only the verified one survives', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile();
    rows.push(dbRow({ instrument: 'GOOD' }), dbRow({ instrument: 'BAD' }, false));
    const out = await load();
    expect(out.map((a) => a.instrument)).toEqual(['GOOD']);
  });

  it('refusals are recorded with a reason, so an empty result is explicable', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile();
    rows.push(dbRow({ instrument: 'UNSIGNED' }, false));
    await load();
    expect(await refusals()).toEqual([{ instrument: 'UNSIGNED', reason: 'SIGNATURE_ABSENT' }]);
  });

  it('THERE IS NO PARTIALLY-VERIFIED ARTIFACT — rows are filtered, not flagged', async () => {
    process.env.PILOT_AUTHORITY_TRUST_FILE = trustFile();
    rows.push(dbRow({}, false));
    const out = await load();
    // Nothing downstream can receive an artifact and forget to check a `verified` field,
    // because no such field and no such artifact exists.
    expect(out).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('verified');
  });
});
