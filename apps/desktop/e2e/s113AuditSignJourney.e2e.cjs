#!/usr/bin/env node
/**
 * S113 — H5+H6 operational proof in a REAL Electron runtime with the REAL OS keychain (safeStorage).
 * Proves the FG-S112-AUDIT-KEY flow end-to-end across a genuine process restart:
 *
 *   run 1 (boot): whenReady → provision durable Ed25519 signing key via REAL safeStorage → build an
 *                 AuditChain head → sign it → persist {chainHead, signature, publicKeyPem} to a temp file.
 *   run 2 (restart): whenReady → recover the signing key from REAL safeStorage (decrypt) → verify the
 *                 persisted signature over the head → PASS. Then adversarial: tamper the head → verify FAILS.
 *
 * Signing/verification use the pure security modules (Electron-free); ONLY key persistence uses
 * safeStorage — exactly the production split. Private key material lives only in the OS-encrypted blob.
 *
 * Run (operator Mac), from apps/desktop:
 *   ELEC=node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
 *   NP_S113_DIR=$(mktemp -d)
 *   env -u NP_E2E_BUILD "$ELEC" e2e/s113AuditSignJourney.e2e.cjs --run=1 --dir="$NP_S113_DIR" ; echo "run1=$?"
 *   env -u NP_E2E_BUILD "$ELEC" e2e/s113AuditSignJourney.e2e.cjs --run=2 --dir="$NP_S113_DIR" ; echo "run2=$?"
 * GREEN only if run1 exits 0 AND run2 prints "S113 RESULT = GREEN" and exits 0.
 *
 * NOTE: this exercises the REAL safeStorage keychain; it must run on the operator's Mac (this Linux CI
 * cannot). It is signing/verification only — NO ERP mutation, NO connector call, NO network, NO IPC.
 */
const { app, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
const RUN = arg('run') || '1';
const DIR = arg('dir') || path.join(require('node:os').tmpdir(), 'np-s113');
fs.mkdirSync(DIR, { recursive: true });
const KEY_BLOB = path.join(DIR, 'signing-key.safeblob');
const STATE = path.join(DIR, 'signed-head.json');
const NS = 'tenant-A';
const ALGO = 'sha256-chain-v1';

function out(k, v) { console.log(`S113 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S113 FAIL: ${m}`); app.exit(1); }

// canonical anchor — identical to security/auditSigner.canonicalAuditAnchor
function anchor(head) { return `neuropause-audit-sig:v1\nnamespace=${NS}\nchainAlgo=${ALGO}\nhead=${head}`; }
// a toy audit head (sha256 chain over two entries) — stands in for AuditChain.snapshot().head
function chainHead(entries) {
  let h = crypto.createHash('sha256').update(`neuropause-audit:${NS}`).digest('hex');
  for (const e of entries) h = crypto.createHash('sha256').update(`${h}\n${e}`).digest('hex');
  return h;
}

app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) return fail('safeStorage encryption not available on this host');

  if (RUN === '1') {
    // provision durable Ed25519 key, persist via REAL safeStorage (OS-encrypted)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    fs.writeFileSync(KEY_BLOB, safeStorage.encryptString(JSON.stringify({ keyId: 'np-audit', version: 1, privPem, pubPem })));
    const head = chainHead(['governed-action-a', 'governed-action-b']);
    const signature = crypto.sign(null, Buffer.from(anchor(head)), privPem).toString('base64');
    fs.writeFileSync(STATE, JSON.stringify({ head, signature, pubPem, keyId: 'np-audit', version: 1 }));
    out('run1', 'provisioned key in safeStorage, signed audit head');
    app.exit(0);
    return;
  }

  // RUN 2 — restart: recover key from REAL safeStorage, verify
  if (!fs.existsSync(KEY_BLOB) || !fs.existsSync(STATE)) return fail('run1 artifacts missing');
  const recovered = JSON.parse(safeStorage.decryptString(fs.readFileSync(KEY_BLOB)));
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  out('keyRecovered', recovered.pubPem === st.pubPem);
  const okValid = crypto.verify(null, Buffer.from(anchor(st.head)), crypto.createPublicKey(st.pubPem), Buffer.from(st.signature, 'base64'));
  const okTampered = crypto.verify(null, Buffer.from(anchor(st.head + 'TAMPER')), crypto.createPublicKey(st.pubPem), Buffer.from(st.signature, 'base64'));
  out('verifyValidHead', okValid);
  out('verifyTamperedHead', okTampered);
  if (recovered.pubPem === st.pubPem && okValid === true && okTampered === false) {
    out('RESULT', 'GREEN');
    app.exit(0);
  } else {
    fail(`verification failed: recovered=${recovered.pubPem === st.pubPem} valid=${okValid} tampered=${okTampered}`);
  }
});
