#!/usr/bin/env node
// Governed release — assemble the control receipt from MACHINE evidence only (no self-declared PASS).
// Every gate is PASS only when its evidence file exists and is non-empty; otherwise ABSENT. The receipt
// is then judged by validate-release-evidence.cjs (PASS without evidence => DENY). Nothing here can
// invent evidence: it only hashes what earlier jobs uploaded.
// Usage: node scripts/compose-release-receipt.cjs <receipts-dir> <out.json>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: compose-release-receipt.cjs <receipts-dir> <out.json>'); process.exit(2); }

function evidenceFor(file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  if (!b.length) return null;
  return { file, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
function gate(file) {
  const ev = evidenceFor(file);
  return ev ? { status: 'PASS', evidence: ev } : { status: 'ABSENT' };
}
function signingGate(file) {
  const ev = evidenceFor(file);
  if (!ev) return { status: 'ABSENT' };
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return r.result === 'PASS' ? { status: 'PASS', evidence: ev } : { status: 'DENY', evidence: ev };
  } catch { return { status: 'UNKNOWN', evidence: ev }; }
}
const e = process.env;
const receipt = {
  schema: 'np-release-receipt/1',
  candidate: { sha: e.CANDIDATE_SHA || null, tag: e.CANDIDATE_TAG || null, version: e.CANDIDATE_VERSION || null },
  workflow_run: { id: e.GITHUB_RUN_ID || null, attempt: e.GITHUB_RUN_ATTEMPT || null, repository: e.GITHUB_REPOSITORY || null },
  gates: {
    provenance: gate('provenance.json'),
    signing_windows: signingGate('signing-receipt-windows/signing-receipt.json'),
    signing_macos: signingGate('signing-receipt-macos/signing-receipt.json'),
    staged_publication: gate('staged-listing.txt'),
    backend_image_published: gate('backend-digest.txt'),
    backend_promoted: gate('previous-image.txt'),
    public_verification: gate('backend-health.json'),
  },
  human_gates_outside_this_receipt: [
    'authority issuance (np-authority/1) by an issuer who is not the subject',
    'candidate designation (RELEASE_CANDIDATE_TAG/SHA) and the annotated tag push',
    'production-release environment approval by a reviewer who is not the tagger',
    'independent public verification on a second machine (scripts/independent-public-release-verifier.sh --full)',
  ],
};
// merge-multiple downloads flatten same-named files; look for both layouts of the signing receipts
for (const k of ['signing_windows', 'signing_macos']) {
  if (receipt.gates[k].status === 'ABSENT') {
    const alt = signingGate('signing-receipt.json');
    if (alt.status !== 'ABSENT') receipt.gates[k] = { ...alt, note: 'flattened download; per-platform file name not preserved' };
  }
}
fs.writeFileSync(out, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ written: out, gates: Object.fromEntries(Object.entries(receipt.gates).map(([k, v]) => [k, v.status])) }));
