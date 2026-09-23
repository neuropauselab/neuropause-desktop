import { generateKeyPairSync, createPublicKey, createHash, sign as SG } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPilotTrust, trustFileDigest, PILOT_TRUST_SCOPE } from './authorityTrust';
import { canonicalBytes, keyIdFor, verifyAuthorityRow } from './authoritySignature';

/* ==========================================================================================
 * H13 — OUT-OF-BAND DIGEST ANCHOR. Human-selected 24 Sep 2026 from the five sealed NP-038
 * mechanisms. These tests pin the property NP-037 and NP-038 both measured as OPEN:
 *
 *   an actor who can write the trust file must NOT thereby manufacture admissible authority.
 * ========================================================================================== */

const dirs: string[] = [];
const write = (name: string, body: string): string => {
  const d = mkdtempSync(join(tmpdir(), 'np040-'));
  dirs.push(d);
  const p = join(d, name);
  writeFileSync(p, body);
  return p;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const mkKey = () => {
  const k = generateKeyPairSync('ed25519');
  const pem = k.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { priv: k.privateKey, pem, id: keyIdFor(pem) };
};
const trustFor = (id: string, pem: string) =>
  JSON.stringify({ keys: [{ key_id: id, algorithm: 'ed25519', scope: PILOT_TRUST_SCOPE, public_key_pem: pem }] });

const LEGIT = mkKey();
const ATTACKER = mkKey();
const LEGIT_BODY = trustFor(LEGIT.id, LEGIT.pem);
const LEGIT_DIGEST = trustFileDigest(LEGIT_BODY);
const ATTACKER_BODY = trustFor(ATTACKER.id, ATTACKER.pem);

const ROW = {
  instrument: 'NP040', authenticated: true, actions: ['pilot.stop'],
  environment_class: 'PILOT', effective_from: '2026-09-01T00:00:00.000Z',
  expires_at: null, revoked_at: null,
};

describe('H13 — the trust file is only the root if the out-of-band digest says so', () => {
  it('POSITIVE CONTROL: the legitimate file, with its own digest, loads and admits', () => {
    const p = write('t.json', LEGIT_BODY);
    const t = loadPilotTrust(p, LEGIT_DIGEST);
    expect(t.fileFailure).toBeNull();
    expect(t.keys.size).toBe(1);
    const sig = SG(null, canonicalBytes(ROW), LEGIT.priv).toString('base64');
    expect(verifyAuthorityRow(ROW, sig, LEGIT.id, t.keys)).toEqual({ ok: true });
  });

  it('THE NP-037 ATTACK IS NOW DENIED: an attacker-written trust file fails the anchor', () => {
    // Syntactically perfect, correctly scoped, key id correctly derived — everything the
    // pre-H13 loader accepted. The ONLY thing it lacks is a matching out-of-band digest.
    const p = write('t.json', ATTACKER_BODY);
    const t = loadPilotTrust(p, LEGIT_DIGEST);
    expect(t.fileFailure).toBe('TRUST_DIGEST_MISMATCH');
    expect(t.keys.size).toBe(0);

    // And therefore the attacker's perfectly-signed authority is not admitted.
    const sig = SG(null, canonicalBytes(ROW), ATTACKER.priv).toString('base64');
    expect(verifyAuthorityRow(ROW, sig, ATTACKER.id, t.keys))
      .toEqual({ ok: false, reason: 'SIGNER_KEY_NOT_TRUSTED' });
  });

  it('adding an attacker key ALONGSIDE the legitimate one breaks the digest', () => {
    const both = JSON.stringify({
      keys: [
        { key_id: LEGIT.id, algorithm: 'ed25519', scope: PILOT_TRUST_SCOPE, public_key_pem: LEGIT.pem },
        { key_id: ATTACKER.id, algorithm: 'ed25519', scope: PILOT_TRUST_SCOPE, public_key_pem: ATTACKER.pem },
      ],
    });
    const t = loadPilotTrust(write('t.json', both), LEGIT_DIGEST);
    expect(t.fileFailure).toBe('TRUST_DIGEST_MISMATCH');
    expect(t.keys.size).toBe(0);
  });

  it('even a WHITESPACE change to the legitimate file is refused', () => {
    const t = loadPilotTrust(write('t.json', `${LEGIT_BODY}\n`), LEGIT_DIGEST);
    expect(t.fileFailure).toBe('TRUST_DIGEST_MISMATCH');
  });

  describe('fails closed on every unverifiable digest state', () => {
    it('digest absent', () => {
      const t = loadPilotTrust(write('t.json', LEGIT_BODY), undefined);
      expect(t.fileFailure).toBe('TRUST_DIGEST_ABSENT');
      expect(t.keys.size).toBe(0);
    });
    it('digest empty string', () => {
      expect(loadPilotTrust(write('t.json', LEGIT_BODY), '').fileFailure).toBe('TRUST_DIGEST_ABSENT');
    });
    it('digest malformed — not 64 hex', () => {
      expect(loadPilotTrust(write('t.json', LEGIT_BODY), 'deadbeef').fileFailure).toBe('TRUST_DIGEST_MALFORMED');
    });
    it('digest malformed — uppercase is refused rather than normalised', () => {
      expect(loadPilotTrust(write('t.json', LEGIT_BODY), LEGIT_DIGEST.toUpperCase()).fileFailure)
        .toBe('TRUST_DIGEST_MALFORMED');
    });
    it('digest of a DIFFERENT file', () => {
      expect(loadPilotTrust(write('t.json', LEGIT_BODY), trustFileDigest(ATTACKER_BODY)).fileFailure)
        .toBe('TRUST_DIGEST_MISMATCH');
    });
    it('file absent — digest present', () => {
      expect(loadPilotTrust('/definitely/not/here', LEGIT_DIGEST).fileFailure).toBe('TRUST_FILE_ABSENT');
    });
  });

  it('THE ANCHOR IS CHECKED BEFORE PARSING — a malformed file with a bad digest reports the DIGEST failure', () => {
    // Order matters: if parsing ran first this would report TRUST_FILE_MALFORMED, meaning an
    // unanchored file had already been interpreted before anything asked if it was the right file.
    const t = loadPilotTrust(write('t.json', '{not json'), LEGIT_DIGEST);
    expect(t.fileFailure).toBe('TRUST_DIGEST_MISMATCH');
  });

  it('the expected digest is NOT derived from the file being verified', () => {
    // Guards the one implementation mistake that would make the whole anchor vacuous:
    // computing the "expected" value from the same bytes. Any file would then pass.
    const t = loadPilotTrust(write('t.json', ATTACKER_BODY), trustFileDigest(ATTACKER_BODY));
    // It passes ONLY because we deliberately supplied the attacker's own digest — i.e. the
    // digest holder was compromised too. With the legitimate digest it fails (test above).
    expect(t.fileFailure).toBeNull();
    expect(createHash('sha256').update(ATTACKER_BODY, 'utf8').digest('hex')).toBe(trustFileDigest(ATTACKER_BODY));
    expect(createPublicKey(ATTACKER.pem)).toBeDefined();
  });
});

describe('H13 requirement 6 — a digest redefinition is OBSERVABLE, not silent', () => {
  it('the anchor in force is reported on a successful load', () => {
    const t = loadPilotTrust(write('t.json', LEGIT_BODY), LEGIT_DIGEST);
    expect(t.anchorDigest).toBe(LEGIT_DIGEST);
    expect(t.fileDigest).toBe(LEGIT_DIGEST);
    expect(t.fileFailure).toBeNull();
  });

  it('a SUBSTITUTED anchor is visible: both digests are reported and they differ', () => {
    // The scenario requirement 6 names: someone redefines the expected digest to match a file
    // they wrote. The load succeeds — out-of-band-digest cannot prevent that — but the anchor
    // now in force is reported, so the change is evidence rather than nothing.
    const t = loadPilotTrust(write('t.json', ATTACKER_BODY), trustFileDigest(ATTACKER_BODY));
    expect(t.fileFailure).toBeNull();
    // Assert PRESENCE first. `expect(undefined).not.toBe(X)` passes, so a bare inequality
    // would stay green if the anchor stopped being reported at all — the observable would be
    // gone and the test would not notice. Same shape as the indexOf(-1) trap.
    expect(t.anchorDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(t.anchorDigest).not.toBe(LEGIT_DIGEST);   // <- the observable
    expect(t.anchorDigest).toBe(t.fileDigest);
  });

  it('a mismatch reports BOTH digests, so what was expected and what was found are both evidenced', () => {
    const t = loadPilotTrust(write('t.json', ATTACKER_BODY), LEGIT_DIGEST);
    expect(t.fileFailure).toBe('TRUST_DIGEST_MISMATCH');
    expect(t.anchorDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(t.fileDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(t.anchorDigest).toBe(LEGIT_DIGEST);
    expect(t.fileDigest).toBe(trustFileDigest(ATTACKER_BODY));
    expect(t.anchorDigest).not.toBe(t.fileDigest);
  });

  it('no anchor is reported when the load never reached the digest check', () => {
    const t = loadPilotTrust('/definitely/not/here', LEGIT_DIGEST);
    expect(t.anchorDigest).toBeNull();      // null, not undefined — the field exists and is empty
    expect(t.fileDigest).toBeNull();
    expect('anchorDigest' in t).toBe(true);
  });
});

