#!/usr/bin/env node
/**
 * NP-GLOBAL-PUBLIC-LAUNCH — read-only final verification.
 *
 *   npm run neuropause:public-launch:verify [-- --code-set 002|001] [--json]
 *
 * Reads the launch evidence registers and returns ONE exit code. It never mutates
 * anything, never contacts the network, never reads a secret.
 *
 * Exit codes (NP-GLOBAL-PUBLIC-LAUNCH-002 §48, the superset):
 *   0 = PUBLIC RELEASE MACHINE-GREEN (every mandatory gate PASS or NOT_APPLICABLE,
 *       each PASS carrying evidence_id + execution_id, every locally present
 *       artifact matching its registered digest)
 *   1 = FAILED                      (a mandatory technical gate is FAIL/BLOCKED)
 *   2 = HUMAN AUTHORITY REQUIRED    (a mandatory gate is WAITING_FOR_HUMAN)
 *   3 = EVIDENCE MISSING            (a mandatory gate is NOT_MEASURED/NOT_STARTED/
 *                                    MEASURABLE/RUNNING/DEFERRED, or PASS without evidence ids)
 *   4 = PROVENANCE INVALID          (a PROVENANCE-class gate FAIL, or source binding broken)
 *   5 = DISTRIBUTION INVALID        (a DISTRIBUTION-class gate FAIL/BLOCKED, or a registered
 *                                    artifact present on disk whose digest does not match)
 *   6 = SECURITY BLOCK              (a SECURITY-class gate FAIL)
 *   7 = REGULATORY REVIEW REQUIRED  (a REGULATORY-class gate WAITING_FOR_HUMAN)
 *
 * Precedence when several apply (most blocking first): 6, 4, 5, 3, 1, 7, 2.
 * `--code-set 001` collapses to the NP-GLOBAL-PUBLIC-LAUNCH-001 §42 set:
 *   0 green · 1 failed · 2 human decision required · 3 evidence missing · 4 artifact invalid
 *   (5 → 4, 6 → 1, 7 → 2).
 *
 * The register of record is certification/public-launch-002/32_FINAL_GATE.json.
 * Gate statuses are never rewritten here; a status that is not one of the known
 * states is treated as EVIDENCE MISSING, never as PASS.
 */
'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FINAL_GATE = path.join(ROOT, 'certification/public-launch-002/32_FINAL_GATE.json');
const ARTIFACTS = path.join(ROOT, 'certification/public-launch-002/31_RELEASE_ARTIFACT_REGISTER.json');
const MASTER_001 = path.join(ROOT, 'certification/public-launch/01_MASTER_GATE_REGISTER.json');

const OK_STATES = new Set(['PASS', 'NOT_APPLICABLE']);
const FAIL_STATES = new Set(['FAIL', 'BLOCKED', 'WAITING_FOR_OPERATOR_SECRET']);
const HUMAN_STATES = new Set(['WAITING_FOR_HUMAN']);
const MISSING_STATES = new Set(['NOT_MEASURED', 'NOT_STARTED', 'MEASURABLE', 'RUNNING', 'DEFERRED']);

/** Gates that can NEVER be satisfied implicitly (NP-GLOBAL-PUBLIC-LAUNCH-001 §42). */
const HARD_BLOCK_GATES = [
  'HUMAN_RELEASE_AUTHORITY', 'REGULATORY_REVIEW', 'INTENDED_USE', 'APPLE', 'WINDOWS',
  'PROVENANCE', 'AI', 'AUTHORIZATION', 'EVIDENCE', 'ROLLBACK', 'INSTALLATION',
];

function sha256(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { __parse_error: String(e && e.message) }; }
}

function evaluate({ finalGate, artifacts, master001 }) {
  const reasons = [];
  const codes = new Set();
  const push = (code, why) => { codes.add(code); reasons.push({ code, why }); };

  if (!finalGate || finalGate.__parse_error) {
    push(3, `final gate register unreadable: ${FINAL_GATE}${finalGate && finalGate.__parse_error ? ` (${finalGate.__parse_error})` : ''}`);
    return { codes, reasons, gates: [] };
  }
  const gates = Array.isArray(finalGate.gates) ? finalGate.gates : [];
  if (gates.length === 0) push(3, 'final gate register lists no gates');

  const seen = new Set();
  for (const g of gates) {
    seen.add(g.gate);
    const status = String(g.status || '').toUpperCase();
    const cls = String(g.class || 'TECHNICAL').toUpperCase();
    // HARD_BLOCK_GATES can never be opted out with `mandatory:false`.
    const mandatory = g.mandatory !== false || HARD_BLOCK_GATES.includes(String(g.gate).toUpperCase());
    if (!mandatory) continue;
    if (OK_STATES.has(status)) {
      if (status === 'PASS' && (!g.evidence_id || !g.execution_id)) push(3, `${g.gate}: PASS without evidence_id/execution_id`);
      continue;
    }
    if (FAIL_STATES.has(status)) {
      if (cls === 'SECURITY') push(6, `${g.gate}: ${status} — ${g.reason || ''}`);
      else if (cls === 'PROVENANCE') push(4, `${g.gate}: ${status} — ${g.reason || ''}`);
      else if (cls === 'DISTRIBUTION') push(5, `${g.gate}: ${status} — ${g.reason || ''}`);
      else push(1, `${g.gate}: ${status} — ${g.reason || ''}`);
      continue;
    }
    if (HUMAN_STATES.has(status)) {
      if (cls === 'REGULATORY') push(7, `${g.gate}: ${status} — ${g.reason || ''}`);
      else push(2, `${g.gate}: ${status} — ${g.reason || ''}`);
      continue;
    }
    if (MISSING_STATES.has(status)) { push(3, `${g.gate}: ${status} — ${g.reason || ''}`); continue; }
    push(3, `${g.gate}: unknown status "${g.status}" treated as EVIDENCE MISSING`);
  }
  for (const hb of HARD_BLOCK_GATES) {
    if (!seen.has(hb)) push(3, `hard-block gate ${hb} is absent from the register — cannot be implicitly PASS`);
  }

  // Release artifact identity: every registered artifact present locally must match its digest.
  if (artifacts && !artifacts.__parse_error && Array.isArray(artifacts.artifacts)) {
    for (const a of artifacts.artifacts) {
      if (!a.sha256) { push(4, `artifact ${a.filename || '?'} has no sha256 — identity unknown`); continue; }
      const lp = a.local_path ? path.resolve(ROOT, a.local_path) : null;
      if (lp && fs.existsSync(lp)) {
        const got = sha256(lp);
        if (got !== a.sha256) push(5, `artifact ${a.filename}: on-disk sha256 ${got.slice(0, 16)}… != registered ${String(a.sha256).slice(0, 16)}…`);
      }
      if (a.signing_status && String(a.signing_status).toUpperCase() !== 'SIGNED' && a.public !== false) push(5, `artifact ${a.filename}: signing_status=${a.signing_status} (public artifact must be signed)`);
      if (a.platform === 'macos' && a.notarization_status && String(a.notarization_status).toUpperCase() !== 'NOTARIZED' && a.public !== false) push(5, `artifact ${a.filename}: notarization_status=${a.notarization_status}`);
    }
  } else if (artifacts === null) {
    push(3, `artifact register absent: ${ARTIFACTS}`);
  }

  // Source binding between the two register namespaces must agree.
  if (master001 && !master001.__parse_error && finalGate.source && master001.source) {
    if (master001.source.commit && finalGate.source.commit && master001.source.commit !== finalGate.source.commit) {
      push(4, `source commit disagreement: 001=${master001.source.commit} 002=${finalGate.source.commit}`);
    }
  }
  return { codes, reasons, gates };
}

function finalCode(codes, codeSet) {
  const order = [6, 4, 5, 3, 1, 7, 2];
  let code = 0;
  for (const c of order) if (codes.has(c)) { code = c; break; }
  if (codeSet === '001') return { 5: 4, 6: 1, 7: 2 }[code] ?? code;
  return code;
}

function main() {
  const argv = process.argv.slice(2);
  const codeSet = argv.includes('--code-set') ? argv[argv.indexOf('--code-set') + 1] : '002';
  const asJson = argv.includes('--json');
  const finalGate = readJson(FINAL_GATE);
  const artifacts = readJson(ARTIFACTS);
  const master001 = readJson(MASTER_001);
  const { codes, reasons, gates } = evaluate({ finalGate, artifacts, master001 });
  const code = finalCode(codes, codeSet);
  const LABEL = { 0: 'PUBLIC RELEASE MACHINE-GREEN', 1: 'FAILED', 2: 'HUMAN AUTHORITY REQUIRED', 3: 'EVIDENCE MISSING', 4: 'PROVENANCE INVALID', 5: 'DISTRIBUTION INVALID', 6: 'SECURITY BLOCK', 7: 'REGULATORY REVIEW REQUIRED' };
  const out = {
    verifier: 'neuropause:public-launch:verify', code_set: codeSet, exit_code: code, verdict: LABEL[code],
    register: FINAL_GATE, launch_status: finalGate && finalGate.launch_status, source: finalGate && finalGate.source,
    gate_count: gates.length,
    gate_summary: gates.reduce((m, g) => { const s = String(g.status || 'UNKNOWN').toUpperCase(); m[s] = (m[s] || 0) + 1; return m; }, {}),
    reasons,
  };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); }
  else {
    console.log(`neuropause:public-launch:verify — code set ${codeSet}`);
    console.log(`register: ${path.relative(ROOT, FINAL_GATE)} (${gates.length} gates) launch_status=${out.launch_status}`);
    for (const g of gates) console.log(`  ${String(g.status || 'UNKNOWN').padEnd(26)} ${String(g.class || 'TECHNICAL').padEnd(12)} ${g.gate}`);
    if (reasons.length) { console.log('reasons:'); for (const r of reasons) console.log(`  [${r.code}] ${r.why}`); }
    console.log(`VERDICT: ${LABEL[code]} (exit ${code})`);
  }
  process.exit(code);
}

if (require.main === module) main();
module.exports = { evaluate, finalCode, HARD_BLOCK_GATES };
