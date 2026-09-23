#!/usr/bin/env node
/*
 * NP-036 §10 — ISOLATED NON-PRODUCTION KEY CEREMONY.
 *
 * OPTION_B requires "a human key ceremony THAT MUST FIRST BE BUILT ... plus a designated
 * issuer to hold the private half and a non-subject admin to merge the trust file."
 *
 * This builds the ceremony. It does NOT perform the governance half: no designated issuer
 * exists, and no non-subject admin has merged anything. A key this produces is a TEST key and
 * says so in its own metadata, in the trust file it emits, and in the filename of the private
 * half. It is not, and must not be presented as, an organizational authority root.
 *
 * WHY THIS IS A SEPARATE EXECUTABLE AND NOT A LIBRARY FUNCTION: nothing in the running
 * application can sign. If the server could mint a signature, the "external" in "external
 * cryptographic root" would be false and the machine could manufacture the authority it is
 * required to obey. Signing lives here, run by a human, out of process.
 *
 *   node np036-key-ceremony.mjs generate <out-dir>
 *   node np036-key-ceremony.mjs sign <private-key.pem> <row.json>
 */
import { generateKeyPairSync, createHash, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL_VERSION = 'np-pilot-authority-v1';
const PILOT_TRUST_SCOPE = 'np-pilot-first';

const keyIdFor = (pem) =>
  createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex');

export const canonicalBytes = (row) => {
  const part = (s) => (s === null ? '~' : `${Buffer.byteLength(String(s), 'utf8')}:${s}`);
  return Buffer.from([
    part(CANONICAL_VERSION), part(row.instrument), part(row.authenticated ? 'true' : 'false'),
    part(String(row.actions.length)), ...row.actions.map(part),
    part(row.environment_class), part(row.effective_from), part(row.expires_at), part(row.revoked_at),
  ].join(''), 'utf8');
};

function generate(outDir, createdAt) {
  mkdirSync(outDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keyId = keyIdFor(pubPem);

  // The private half is written 0600 and named so it cannot be mistaken for a real key.
  const privPath = join(outDir, `TEST-ONLY-pilot-issuer-${keyId.slice(0, 12)}.private.pem`);
  writeFileSync(privPath, privPem, { mode: 0o600 });
  chmodSync(privPath, 0o600);

  const trust = {
    note: 'NON-PRODUCTION TEST TRUST FILE. Not an organizational authority root.',
    scope_note: `Scoped to ${PILOT_TRUST_SCOPE}; production-release keys are refused by the loader.`,
    keys: [{
      key_id: keyId,
      algorithm: 'ed25519',
      scope: PILOT_TRUST_SCOPE,
      public_key_pem: pubPem,
      purpose: 'pilot authority decision signing',
      created_at: createdAt,
      key_owner: 'NOT_ESTABLISHED — no designated issuer exists',
      key_custody: 'NOT_ESTABLISHED — this private half is a disposable test key',
      rotation_policy: 'NOT_ESTABLISHED — pending human decision',
      revocation_policy: 'NOT_ESTABLISHED — pending human decision',
      compromise_response: 'NOT_ESTABLISHED — pending human decision',
      classification: 'TEST_KEY_NON_PRODUCTION',
    }],
  };
  const trustPath = join(outDir, 'pilot-authority-trust.TEST.json');
  writeFileSync(trustPath, `${JSON.stringify(trust, null, 2)}\n`);
  return { keyId, privPath, trustPath, publicKeyPem: pubPem };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'generate') {
  const r = generate(a ?? '.', new Date().toISOString());
  console.log(JSON.stringify({ ...r, publicKeyPem: undefined }, null, 2));
} else if (cmd === 'sign') {
  const row = JSON.parse(readFileSync(b, 'utf8'));
  console.log(cryptoSign(null, canonicalBytes(row), readFileSync(a, 'utf8')).toString('base64'));
} else if (cmd) {
  console.error('usage: np036-key-ceremony.mjs generate <out-dir> | sign <priv.pem> <row.json>');
  process.exit(2);
}
export { generate, keyIdFor };
