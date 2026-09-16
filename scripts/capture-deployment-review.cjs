#!/usr/bin/env node
// Governed release — capture THIS run's deployment review from the GitHub API (machine evidence for the
// authority-admission predicate; never self-declared). Reads GITHUB_TOKEN from the environment only, never
// prints or writes it. Output shape is what scripts/lib/np-authority.cjs expects as `actual.review`:
//   { source: 'deployment_review_api', captured_by_verifier: true, approver, state, environments, comment,
//     run_id, run_attempt, approved_subject_digest, run_head_sha, captured_at }
// `approved_subject_digest` is the 64-hex SHA-256 the REVIEWER wrote in the approval comment — the digest of the
// authority's canonical signed bytes (printed by the issuer tooling). GitHub approves a job, not a digest, so the
// binding must be explicit; a missing/ambiguous digest fails closed (A20 REVIEW_NOT_BOUND_TO_AUTHORITY_SUBJECT).
// Usage: node scripts/capture-deployment-review.cjs --out <path> [--environment production-release]
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

function die(msg) { console.error('::error::capture-deployment-review: ' + msg); process.exit(1); }

/** Pure selection: given the approvals[] payload, pick the single approved review for `environment`. */
function selectApproval(approvals, environment) {
  if (!Array.isArray(approvals)) return { error: 'approvals payload is not an array' };
  const hits = approvals.filter((r) => r && r.state === 'approved' && Array.isArray(r.environments)
    && r.environments.some((e) => e && e.name === environment));
  if (hits.length === 0) return { error: `no approved deployment review for environment ${environment}` };
  const approvers = new Set(hits.map((r) => r.user && r.user.login).filter(Boolean));
  if (approvers.size !== 1) return { error: `ambiguous approvers for ${environment}: ${[...approvers].join(',') || '(none)'}` };
  const r = hits[hits.length - 1];
  const comment = typeof r.comment === 'string' ? r.comment : '';
  const digests = [...new Set((comment.match(/\b[0-9a-f]{64}\b/gi) || []).map((d) => d.toLowerCase()))];
  if (digests.length !== 1) return { error: `approval comment must contain exactly one 64-hex authority subject digest (found ${digests.length})` };
  return {
    approver: r.user.login,
    state: r.state,
    environments: r.environments.map((e) => e.name),
    comment,
    approved_subject_digest: digests[0],
  };
}

function apiGet(base, path, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base.endsWith('/') ? base : base + '/');
    const req = https.request(u, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'User-Agent': 'neuropause-release/capture-deployment-review',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u.pathname}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`non-JSON body for ${u.pathname}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main(argv) {
  const oi = argv.indexOf('--out'); const out = oi >= 0 ? argv[oi + 1] : null;
  const ei = argv.indexOf('--environment'); const environment = ei >= 0 ? argv[ei + 1] : 'production-release';
  if (!out) die('usage: --out <path> [--environment <name>]');
  const e = process.env;
  for (const k of ['GITHUB_API_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_TOKEN']) if (!e[k]) die('missing env ' + k);
  const base = e.GITHUB_API_URL;
  const repo = e.GITHUB_REPOSITORY;
  let approvals, run;
  try {
    approvals = await apiGet(base, `repos/${repo}/actions/runs/${e.GITHUB_RUN_ID}/approvals`, e.GITHUB_TOKEN);
    run = await apiGet(base, `repos/${repo}/actions/runs/${e.GITHUB_RUN_ID}`, e.GITHUB_TOKEN);
  } catch (err) { die(err.message); }
  const sel = selectApproval(approvals, environment);
  if (sel.error) die(sel.error);
  const capture = {
    source: 'deployment_review_api',
    captured_by_verifier: true,
    approver: sel.approver,
    state: sel.state,
    environments: sel.environments,
    comment: sel.comment,
    run_id: String(e.GITHUB_RUN_ID),
    run_attempt: Number(e.GITHUB_RUN_ATTEMPT),
    approved_subject_digest: sel.approved_subject_digest,
    run_head_sha: run && run.head_sha ? run.head_sha : null,
    captured_at: new Date().toISOString(),
  };
  fs.writeFileSync(out, JSON.stringify(capture, null, 2) + '\n');
  console.log(JSON.stringify({ written: out, approver: capture.approver, run_id: capture.run_id, run_attempt: capture.run_attempt, approved_subject_digest: capture.approved_subject_digest }));
}

module.exports = { selectApproval };
if (require.main === module) main(process.argv.slice(2)).catch((err) => die(String(err && err.message || err)));
