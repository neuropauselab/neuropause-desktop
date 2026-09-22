'use strict';
/**
 * scripts/authority-admission.test.cjs — run: node --test scripts/authority-admission.test.cjs
 *
 * Every authority, trust list, review record and environment capture built here is FORENSIC_SYNTHETIC_ONLY
 * (real_authority = false, production_validity = false). The Ed25519 key pair is generated in memory for this
 * run; only its PUBLIC half is written, into temp trust files under $TMPDIR. Nothing here touches the repository.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const NP = require('./lib/np-authority.cjs');
const CLI = path.join(__dirname, 'authority-admission.cjs');
const GATE = require(CLI);
const TEMPLATE = path.join(__dirname, '..', 'release-policy', 'authority-trust.template.json');

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'np-authority-admission-'));
fs.writeFileSync(path.join(TMP, 'gitconfig-empty'), '');
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const SYNTHETIC = 'FORENSIC_SYNTHETIC_ONLY';
const ISSUER = 'release-authority@forensic.invalid';
const REVIEWER = 'reviewer-2';
const ACTOR = 'dev-1';
const TAG = 'v9.9.9-forensic';
const KEYS = crypto.generateKeyPairSync('ed25519');
const PUBLIC_PEM = KEYS.publicKey.export({ type: 'spki', format: 'pem' });

// ---- minimal sign/verify helper (the role b38-fixture.cjs plays; Ed25519 replaces its forensic HMAC stand-in) ----
const sign = (a) => crypto.sign(null, NP.signingBytes(a), KEYS.privateKey).toString('hex');
const verify = (a) => crypto.verify(null, NP.signingBytes(a), KEYS.publicKey, Buffer.from(a.signature, 'hex'));

const iso = (ms) => new Date(ms).toISOString();
const hex = (n) => crypto.randomBytes(n / 2).toString('hex'); // n hex characters

// ---- git in a hermetic environment: no user/system config (no gpg signing, no hooks), fixed identities/dates ----
const CLEAN_ENV = (() => {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'SystemRoot', 'USERPROFILE', 'TEMP', 'TMP'];
  const e = {};
  for (const k of keep) if (process.env[k] !== undefined) e[k] = process.env[k];
  return {
    ...e,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(TMP, 'gitconfig-empty'),
    GIT_AUTHOR_NAME: 'dev-2',
    GIT_AUTHOR_EMAIL: 'dev-2@forensic.invalid',
    GIT_COMMITTER_NAME: 'dev-2',
    GIT_COMMITTER_EMAIL: 'dev-2@forensic.invalid',
    GIT_AUTHOR_DATE: '2026-09-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z',
  };
})();
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    env: CLEAN_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const gitBytes = (cwd, ...args) => execFileSync('git', args, { cwd, env: CLEAN_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

const POLICY = {
  id: 'np-release-population',
  version: '1',
  include: ['scripts/**/*.cjs', 'package.json', '.github/workflows/*.yml', 'release-policy/*.json'],
  exclude: ['scripts/**/*.test.cjs'],
};
const BUILD_POLICY = {
  id: 'np-build-policy',
  version: '1',
  generated: ['apps/desktop/THIRD-PARTY-NOTICES.md', 'apps/desktop/resources/build-info.json', 'apps/desktop/out/**'],
  toolchain: { node: '20.x' },
};

/** A synthetic candidate repository: one commit, one annotated tag. */
function makeRepo(name, { withPolicy = true } = {}) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  const files = {
    'package.json': `${JSON.stringify({ name: 'np-synthetic', version: '9.9.9-forensic', origin: SYNTHETIC }, null, 2)}\n`,
    'scripts/build.cjs': `// ${SYNTHETIC}\nconsole.log('build');\n`,
    'scripts/lib/helper.cjs': `// ${SYNTHETIC}\nmodule.exports = {};\n`,
    'scripts/skip.test.cjs': '// excluded by the population policy\n',
    'README.md': `${SYNTHETIC} candidate repository\n`,
    '.github/workflows/release.yml': "name: release\non:\n  push:\n    tags: ['v*']\njobs: {}\n",
    'release-policy/build-policy.json': `${JSON.stringify(BUILD_POLICY, null, 2)}\n`,
  };
  if (withPolicy) files['release-policy/population-policy.json'] = `${JSON.stringify(POLICY, null, 2)}\n`;
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `${SYNTHETIC} candidate`);
  git(dir, 'tag', '-a', TAG, '-m', `${SYNTHETIC} tag`);
  return dir;
}

// ---- independent re-derivation of what an ISSUER measures (other git commands, other glob matcher than the gate) ----
function globToRegExp(g) {
  const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = g
    .split('**/')
    .map((part) => esc(part).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('(?:.*/)?');
  return new RegExp(`^${body}$`);
}
function issuerMeasure(dir) {
  const commit = git(dir, 'rev-parse', 'HEAD');
  const tree = git(dir, 'rev-parse', 'HEAD^{tree}');
  const tagObject = git(dir, 'rev-parse', `refs/tags/${TAG}^{tag}`);
  const policy = JSON.parse(git(dir, 'show', `HEAD:${GATE.POPULATION_POLICY_PATH}`));
  const buildPolicy = JSON.parse(git(dir, 'show', `HEAD:${GATE.BUILD_POLICY_PATH}`));
  const inc = policy.include.map(globToRegExp);
  const exc = (policy.exclude || []).map(globToRegExp);
  const entries = git(dir, 'ls-tree', '-r', 'HEAD')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [meta, p] = l.split('\t');
      const [, type, sha] = meta.split(' ');
      return { type, sha, path: p };
    });
  const population = entries
    .filter((e) => e.type === 'blob' && inc.some((r) => r.test(e.path)) && !exc.some((r) => r.test(e.path)))
    .map((e) => ({ path: e.path, blob: e.sha, sha256: NP.H(gitBytes(dir, 'cat-file', 'blob', e.sha)) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const policy_digest = NP.H(Buffer.from(NP.canon(policy)));
  const manifest = Buffer.from(
    NP.canon({ schema: 'np-b34-manifest/1', candidate_commit: commit, candidate_tree: tree, policy_digest, entries: population }),
  );
  return {
    commit,
    tree,
    tagObject,
    population,
    policy_digest,
    population_digest: NP.H(Buffer.from(NP.canon(population))),
    manifest_digest: NP.H(manifest),
    build_policy_digest: NP.H(Buffer.from(NP.canon(buildPolicy))),
  };
}

function ciEnv(m, overrides = {}) {
  return {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: `refs/tags/${TAG}`,
    GITHUB_REF_NAME: TAG,
    GITHUB_SHA: m.commit,
    GITHUB_REPOSITORY: 'forensic/np-synthetic',
    GITHUB_REPOSITORY_ID: '000000001',
    GITHUB_WORKFLOW_REF: `forensic/np-synthetic/.github/workflows/release.yml@refs/tags/${TAG}`,
    GITHUB_RUN_ID: '4242424242',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_ACTOR: ACTOR,
    ...overrides,
  };
}

/** Synthetic authority (signed), review record, environment capture and trust list for a measured candidate. */
function fixture(m, env, { authority = {}, trust = {}, review = {}, environment = {} } = {}) {
  const now = Date.now();
  const a = {
    authority_origin: SYNTHETIC,
    real_authority: false,
    production_validity: false,
    authority_id: `AUTH-${hex(8)}`,
    authority_schema_version: 'np-authority/1.1',
    release_class: 'PRODUCTION',
    distribution_class: 'PUBLIC_PRODUCTION',
    public_feed_permission: 'ALLOW_SIGNED_ONLY',
    signing_requirement: 'REQUIRED',
    issuer_identity: ISSUER,
    subject_repository: env.GITHUB_REPOSITORY_ID,
    subject_ref: env.GITHUB_REF,
    subject_commit: m.commit,
    subject_tree: m.tree,
    candidate_tag: env.GITHUB_REF_NAME,
    manifest_digest: m.manifest_digest,
    population_digest: m.population_digest,
    policy_digest: m.policy_digest,
    build_policy_digest: m.build_policy_digest,
    allowed_workflow: env.GITHUB_WORKFLOW_REF,
    allowed_environment: 'production-release',
    allowed_channels: ['beta'],
    allowed_artifact_classes: ['installer', 'feed'],
    scope: 'production-release',
    effective_from: iso(now - 3600e3),
    effective_until: iso(now + 3600e3),
    reviewer_identity: REVIEWER,
    reviewer_decision: 'approved',
    decision_timestamp: iso(now - 1800e3),
    decision_nonce: `NONCE-${hex(24)}`,
    signature_algorithm: 'ed25519',
    ...authority,
  };
  a.signature = sign(a);
  const rv = {
    fixture: SYNTHETIC,
    source: 'deployment_review_api',
    captured_by_verifier: true,
    approver: a.reviewer_identity,
    state: 'approved',
    run_id: env.GITHUB_RUN_ID,
    run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
    approved_subject_digest: NP.H(NP.signingBytes(a)),
    ...review,
  };
  const ev = {
    fixture: SYNTHETIC,
    source: 'admin_api_capture',
    captured_by_verifier: true,
    name: 'production-release',
    exists: true,
    required_reviewers: true,
    prevent_self_review: true,
    deployment_tag_pattern: 'v*',
    ...environment,
  };
  const t = {
    _template: false,
    _fixture: SYNTHETIC,
    schema_version: 'np-authority/1.1',
    signature_algorithm: 'ed25519',
    scope: 'production-release',
    tag_pattern: 'v*',
    trusted_issuers: [ISSUER],
    issuer_keys: { [ISSUER]: { public_key_pem: PUBLIC_PEM } },
    allowed_reviewers: [REVIEWER, 'reviewer-3'],
    consumed_nonces: [],
    deployment_time_validity: true,
    accept_synthetic_authorities: true,
    ...trust,
  };
  return { a, rv, ev, t };
}
const std = (f) => ({ authority: f.a, trust: f.t, review: f.rv, environment: f.ev });

let seq = 0;
/** files: name -> object (JSON) | string (raw bytes) | undefined (path passed, file absent); key omitted => flag omitted. */
function runCli({ repo, env, files, args = [] }) {
  const dir = path.join(TMP, `case-${String(++seq).padStart(2, '0')}`);
  fs.mkdirSync(dir);
  const p = {};
  for (const [name, body] of Object.entries(files)) {
    p[name] = path.join(dir, `${name}.json`);
    if (body === undefined) continue;
    fs.writeFileSync(p[name], typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  const out = path.join(dir, 'verdict.json');
  const argv = [CLI, '--authority', p.authority, '--trust', p.trust, '--out', out];
  if (p.review) argv.push('--review', p.review);
  if (p.environment) argv.push('--environment', p.environment);
  const r = spawnSync(process.execPath, [...argv, ...args], { cwd: repo, env: { ...CLEAN_ENV, ...env }, encoding: 'utf8' });
  const verdict = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, verdict, paths: p, out };
}

function expectDeny(r, code) {
  assert.equal(r.status, 1, `exit code must be 1\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(r.verdict, 'verdict JSON must be written on DENY');
  assert.equal(r.verdict.verdict, 'DENY');
  assert.ok(r.verdict.codes.includes(code), `codes ${JSON.stringify(r.verdict.codes)} must include ${code}`);
  assert.match(r.stdout, new RegExp(`::error::authority-admission: DENY ${code} — `));
  assert.ok(r.verdict.reasons.every((x) => typeof x.summary === 'string' && x.summary.length > 0), 'every code has a summary');
}

const REPO = makeRepo('candidate');
const M = issuerMeasure(REPO);
const now = Date.now();

test('issuer-side measurement selects exactly the policy population', () => {
  assert.deepEqual(
    M.population.map((e) => e.path),
    [
      '.github/workflows/release.yml',
      'package.json',
      'release-policy/build-policy.json',
      'release-policy/population-policy.json',
      'scripts/build.cjs',
      'scripts/lib/helper.cjs',
    ],
  );
});

test('ADMIT: signed synthetic authority over the measured candidate (exit 0, verdict ADMIT, files untouched)', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  assert.ok(verify(f.a), 'fixture signature verifies');
  const r = runCli({ repo: REPO, env, files: std(f) });
  assert.equal(r.status, 0, `exit code must be 0\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const v = r.verdict;
  assert.equal(v.verdict, 'ADMIT');
  assert.deepEqual(v.codes, []);
  assert.equal(v.admission.verdict, 'ALLOW');
  assert.equal(v.admission.code, 'AUTHORITY_ADMITTED');
  assert.equal(v.authority_subject_digest, NP.H(NP.signingBytes(f.a)));
  assert.equal(v.authority_id, f.a.authority_id);
  assert.equal(v.issuer_identity, ISSUER);
  assert.equal(v.authority_origin, SYNTHETIC);
  // the gate's git-object measurement equals the independent issuer-side measurement
  assert.equal(v.actual.measured_from, 'git_objects');
  assert.equal(v.actual.commit, M.commit);
  assert.equal(v.actual.peeled_commit, M.commit);
  assert.equal(v.actual.tree, M.tree);
  assert.equal(v.actual.tag_object, M.tagObject);
  assert.equal(v.actual.tag_ref_type, 'tag');
  assert.equal(v.actual.population_count, M.population.length);
  assert.equal(v.actual.population_digest, M.population_digest);
  assert.equal(v.actual.manifest_digest, M.manifest_digest);
  assert.equal(v.actual.policy_digest, M.policy_digest);
  assert.equal(v.actual.build_policy_digest, M.build_policy_digest);
  assert.equal(v.actual.workflow_author, 'dev-2@forensic.invalid');
  assert.equal(v.actual.initiator, ACTOR);
  assert.match(r.stdout, /^authority-admission: ADMIT authority_id=AUTH-/m);
  // never modifies its inputs
  assert.equal(fs.readFileSync(r.paths.authority, 'utf8'), JSON.stringify(f.a, null, 2));
  assert.equal(fs.readFileSync(r.paths.trust, 'utf8'), JSON.stringify(f.t, null, 2));
  // never prints key or signature material
  const printed = r.stdout + r.stderr + JSON.stringify(v);
  assert.ok(!printed.includes(f.a.signature), 'signature must not be echoed');
  assert.ok(!printed.includes('BEGIN PUBLIC KEY'), 'key material must not be echoed');
});

test('DENY AUTHORITY_TRUST_ABSENT: trust file missing', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  expectDeny(runCli({ repo: REPO, env, files: { ...std(f), trust: undefined } }), 'AUTHORITY_TRUST_ABSENT');
});

test('DENY AUTHORITY_TRUST_ABSENT: trust file is the shipped template', () => {
  const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  assert.equal(template._template, true);
  assert.deepEqual(template.trusted_issuers, []);
  assert.equal(template.accept_synthetic_authorities, false);
  const env = ciEnv(M);
  const f = fixture(M, env);
  const r = runCli({ repo: REPO, env, files: { ...std(f), trust: fs.readFileSync(TEMPLATE, 'utf8') } });
  expectDeny(r, 'AUTHORITY_TRUST_ABSENT');
});

test('DENY AUTHORITY_TRUST_ABSENT: trusted_issuers empty', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { trust: { trusted_issuers: [] } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'AUTHORITY_TRUST_ABSENT');
});

test('DENY AUTHORITY_TRUST_INVALID: issuer key is not an Ed25519 public key', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { trust: { issuer_keys: { [ISSUER]: { public_key_pem: 'not a key' } } } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'AUTHORITY_TRUST_INVALID');
});

test('DENY AUTHORITY_ABSENT: authority file missing', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  expectDeny(runCli({ repo: REPO, env, files: { ...std(f), authority: undefined } }), 'AUTHORITY_ABSENT');
});

test('DENY AUTHORITY_MALFORMED: authority file is not JSON', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  expectDeny(runCli({ repo: REPO, env, files: { ...std(f), authority: '{ "authority_id": ' } }), 'AUTHORITY_MALFORMED');
});

test('DENY ISSUER_IS_SUBJECT: the run actor is the issuer', () => {
  const env = ciEnv(M, { GITHUB_ACTOR: ISSUER });
  const f = fixture(M, env);
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'ISSUER_IS_SUBJECT');
});

test('DENY ISSUER_UNTRUSTED: issuer not on the trust list', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { issuer_identity: 'someone-else' } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'ISSUER_UNTRUSTED');
});

test('DENY SIGNATURE_INVALID: one byte of the signature flipped', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  const sig = Buffer.from(f.a.signature, 'hex');
  sig[7] ^= 0x01;
  f.a.signature = sig.toString('hex');
  assert.equal(verify(f.a), false);
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'SIGNATURE_INVALID');
});

test('DENY COMMIT_MISMATCH: authority names another commit (re-signed)', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { subject_commit: hex(40) } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'COMMIT_MISMATCH');
});

test('DENY TREE_MISMATCH: authority names another tree (re-signed)', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { subject_tree: hex(40) } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'TREE_MISMATCH');
});

test('DENY TAG_MISMATCH: authority names another tag (re-signed)', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { candidate_tag: 'vOTHER' } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'TAG_MISMATCH');
});

test('DENY AUTHORITY_NOT_VALID_AT_ADMISSION: effective_from is in the future', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { effective_from: iso(now + 3600e3), effective_until: iso(now + 7200e3) } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'AUTHORITY_NOT_VALID_AT_ADMISSION');
});

test('DENY AUTHORITY_EXPIRED_BEFORE_DEPLOYMENT: valid now, expired at --deployment-time', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { effective_until: iso(now + 1800e3) } });
  const r = runCli({ repo: REPO, env, files: std(f), args: ['--deployment-time', iso(now + 7200e3)] });
  expectDeny(r, 'AUTHORITY_EXPIRED_BEFORE_DEPLOYMENT');
  assert.equal(r.verdict.actual.deployment_time, iso(now + 7200e3));
});

test('DENY AUTHORITY_REPLAYED: nonce already in the consumed ledger', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  f.t.consumed_nonces = [f.a.decision_nonce];
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'AUTHORITY_REPLAYED');
});

test('DENY REVIEWER_IS_SUBJECT: the approver is the run actor', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { reviewer_identity: ACTOR } });
  assert.equal(f.rv.approver, ACTOR);
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'REVIEWER_IS_SUBJECT');
});

test('DENY REVIEW_RECORD_UNCAPTURED: predicate UNKNOWN is a DENY (no --review)', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  const r = runCli({ repo: REPO, env, files: { authority: f.a, trust: f.t, environment: f.ev } });
  expectDeny(r, 'REVIEW_RECORD_UNCAPTURED');
  assert.equal(r.verdict.admission.verdict, 'UNKNOWN');
});

test('DENY SYNTHETIC_AUTHORITY_REJECTED: trust list does not accept synthetic authorities', () => {
  const env = ciEnv(M);
  const f = fixture(M, env, { trust: { accept_synthetic_authorities: false } });
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'SYNTHETIC_AUTHORITY_REJECTED');
});

test('DENY CANDIDATE_INCONSISTENT: GITHUB_SHA is neither the peeled commit nor the tag object', () => {
  const env = ciEnv(M, { GITHUB_SHA: hex(40) });
  const f = fixture(M, env);
  expectDeny(runCli({ repo: REPO, env, files: std(f) }), 'CANDIDATE_INCONSISTENT');
});

test('DENY MEASUREMENT_FAILED: population policy absent at HEAD', () => {
  const repo = makeRepo('no-policy', { withPolicy: false });
  const env = ciEnv({ commit: git(repo, 'rev-parse', 'HEAD') });
  const f = fixture(M, env);
  const r = runCli({ repo, env, files: std(f) });
  expectDeny(r, 'MEASUREMENT_FAILED');
  assert.ok(r.verdict.reasons.some((x) => String(x.detail).includes(GATE.POPULATION_POLICY_PATH)));
});

test('DENY MEASUREMENT_FAILED: not a git repository', () => {
  const dir = path.join(TMP, 'not-a-repo');
  fs.mkdirSync(dir);
  const env = ciEnv(M);
  const f = fixture(M, env);
  expectDeny(runCli({ repo: dir, env, files: std(f) }), 'MEASUREMENT_FAILED');
});

test('DENY lists ALL gate-level codes at once (trust + authority + measurement)', () => {
  const r = runCli({ repo: REPO, env: {}, files: { authority: undefined, trust: undefined } });
  expectDeny(r, 'AUTHORITY_TRUST_ABSENT');
  for (const c of ['AUTHORITY_TRUST_ABSENT', 'AUTHORITY_ABSENT', 'MEASUREMENT_FAILED']) assert.ok(r.verdict.codes.includes(c), c);
  assert.equal(r.verdict.admission, null, 'predicate not consulted when inputs are unusable');
});

test('usage error exits 2 and writes no verdict', () => {
  const r = spawnSync(process.execPath, [CLI, '--authority', 'x'], { cwd: REPO, env: CLEAN_ENV, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--trust is required/);
});

test('library: admitFromEnvironment() is require()-able, admits directly, and never throws on failure', () => {
  const env = ciEnv(M);
  const f = fixture(M, env);
  const dir = path.join(TMP, 'lib-call');
  fs.mkdirSync(dir);
  const p = {};
  for (const [k, v] of Object.entries(std(f))) {
    p[k] = path.join(dir, `${k}.json`);
    fs.writeFileSync(p[k], JSON.stringify(v));
  }
  assert.equal(typeof GATE.admitFromEnvironment, 'function');
  const ok = GATE.admitFromEnvironment({
    authorityPath: p.authority,
    trustPath: p.trust,
    reviewPath: p.review,
    environmentPath: p.environment,
    cwd: REPO,
    env,
    now: Date.now(),
  });
  assert.equal(ok.verdict, 'ADMIT');
  assert.deepEqual(ok.codes, []);
  assert.equal(ok.authority_id, f.a.authority_id);
  assert.equal(ok.actual.tree, M.tree);
  assert.equal(ok.authority_subject_digest, NP.H(NP.signingBytes(f.a)));

  // defaults + failure path: no trust, no authority, no CI context, not a git repo — DENY, never throw
  const bare = path.join(TMP, 'lib-bare');
  fs.mkdirSync(bare);
  let res;
  assert.doesNotThrow(() => {
    res = GATE.admitFromEnvironment({ cwd: bare, env: {} });
  });
  assert.equal(res.verdict, 'DENY');
  for (const c of ['AUTHORITY_TRUST_ABSENT', 'AUTHORITY_ABSENT', 'MEASUREMENT_FAILED']) assert.ok(res.codes.includes(c), c);
  assert.equal(res.inputs.trust, path.join(bare, 'release-policy/authority-trust.json'));
  assert.equal(res.inputs.authority, path.join(bare, 'certification/public-launch/PUBLIC_RELEASE_AUTHORIZATION.json'));
  assert.doesNotThrow(() => GATE.admitFromEnvironment({ cwd: REPO, env, now: 'not a time', authorityPath: p.authority, trustPath: p.trust }));

  // the bare call candidate-admission.cjs makes — admitFromEnvironment({}) — configured only through the environment
  const viaEnv = GATE.admitFromEnvironment({
    cwd: REPO,
    env: {
      ...env,
      NP_AUTHORITY_PATH: p.authority,
      NP_AUTHORITY_TRUST_PATH: p.trust,
      NP_AUTHORITY_REVIEW_CAPTURE: p.review,
      NP_AUTHORITY_ENVIRONMENT_CAPTURE: p.environment,
      NP_AUTHORITY_DEPLOYMENT_TIME: iso(now + 600e3),
    },
  });
  assert.equal(viaEnv.verdict, 'ADMIT');
  assert.equal(viaEnv.inputs.review, p.review);
  assert.equal(viaEnv.actual.deployment_time, iso(now + 600e3));
  // ...and without the captures the same call DENIES (fail closed), never throws
  const noCaptures = GATE.admitFromEnvironment({ cwd: REPO, env: { ...env, NP_AUTHORITY_PATH: p.authority, NP_AUTHORITY_TRUST_PATH: p.trust } });
  assert.equal(noCaptures.verdict, 'DENY');
  assert.deepEqual(noCaptures.codes, ['REVIEW_RECORD_UNCAPTURED']);
});

// ---------------------------------------------------------------------------------------------------------------
// NP-116 (N1) — authority-metadata contract (Contract-B, Saurabh Patel 22/09/2026).
//   real_authority, production_validity : JSON boolean only
//   authority_origin                    : JSON string, exactly FORENSIC_SYNTHETIC_ONLY or HUMAN_GOVERNED_AUTHORITY
// Every envelope below is freshly and VALIDLY signed after its markers are set, so each DENY shows that a
// valid signature does not turn malformed metadata into authority. "live trust" is
// accept_synthetic_authorities:false, the value in release-policy/authority-trust.json.
// ---------------------------------------------------------------------------------------------------------------
const HUMAN = 'HUMAN_GOVERNED_AUTHORITY';
const REAL = { authority_origin: HUMAN, real_authority: true, production_validity: true };
const LIVE_TRUST = { accept_synthetic_authorities: false };
const CLASSES = {
  PRODUCTION: {},
  PILOT: { release_class: 'PILOT', distribution_class: 'CONTROLLED_PILOT', public_feed_permission: 'DENY' },
};
const ABSENT = Symbol('absent');

/** Signed contract-valid envelope for a class, with `marks` applied BEFORE signing (ABSENT deletes a key). */
function n1Fixture(cls, marks = {}, trust = LIVE_TRUST) {
  const env = ciEnv(M);
  const f = fixture(M, env, { authority: { ...REAL, ...CLASSES[cls] }, trust });
  for (const [k, v] of Object.entries(marks)) {
    if (v === ABSENT) delete f.a[k];
    else f.a[k] = v;
  }
  delete f.a.signature;
  f.a.signature = sign(f.a);
  f.rv.approved_subject_digest = NP.H(NP.signingBytes(f.a));
  return { f, env };
}

let n1seq = 0;
function n1Gate({ f, env }) {
  const dir = path.join(TMP, `n1-${String(++n1seq).padStart(3, '0')}`);
  fs.mkdirSync(dir);
  const p = {};
  for (const [k, v] of Object.entries(std(f))) {
    p[k] = path.join(dir, `${k}.json`);
    fs.writeFileSync(p[k], JSON.stringify(v));
  }
  return GATE.admitFromEnvironment({
    authorityPath: p.authority, trustPath: p.trust, reviewPath: p.review, environmentPath: p.environment,
    cwd: REPO, env, now: Date.now(),
  });
}

function n1Deny(cls, marks, code, trust = LIVE_TRUST) {
  const x = n1Fixture(cls, marks, trust);
  assert.equal(verify(x.f.a), true, 'premise: the envelope is validly signed');
  const v = n1Gate(x);
  assert.equal(v.verdict, 'DENY', `${cls} ${JSON.stringify(marks)} must be DENIED, got ${v.verdict}`);
  assert.deepEqual(v.codes, [code], `${cls} ${JSON.stringify(marks)}`);
  assert.equal(v.authority_subject_digest, null, 'no admitted subject digest on DENY');
  return v;
}

// Type-invalid encodings of a boolean (CASE-003..007, CASE-009..013 and the wider NP-115 set).
const NOT_BOOLEAN = ['true', 'false', 'TRUE', 'FALSE', 'True', '1', '0', ' false', 1, 0, -0, 2, [], {}, [true], [false], { value: true }];
// Contract-violating authority_origin values (CASE-016..020 and the wider NP-115 set).
const BAD_ORIGIN = [
  'forensic_synthetic_only', 'FORENSIC_SYNTHETIC_ONLY ', ' FORENSIC_SYNTHETIC_ONLY', ' HUMAN_GOVERNED_AUTHORITY',
  'HUMAN_GOVERNED_AUTHORITY ', 'human_governed_authority', 'Human_Governed_Authority', 'HUMAN_GOVERNED_AUTHORITY\n',
  '\tHUMAN_GOVERNED_AUTHORITY', 'HUMAN-GOVERNED-AUTHORITY', 'HUMAN_GOVERNED_AUTHORITY​', 'HUMAN_GOVERNED_АUTHORITY',
  'ＨUMAN_GOVERNED_AUTHORITY', 'HUMAN_GOVERNED_AUTHORITY\u0000', 'REAL', 'PRODUCTION', 'UNKNOWN_ORIGIN',
  // proper substrings, prefixes and concatenations of the literals: membership is equality, not containment
  'HUMAN', 'GOVERNED', 'AUTHORITY', 'HUMAN_GOVERNED', 'FORENSIC', 'SYNTHETIC_ONLY', 'Y|H', 'ONLY|HUMAN',
  'FORENSIC_SYNTHETIC_ONLY|HUMAN_GOVERNED_AUTHORITY', 'FORENSIC_SYNTHETIC_ONLYHUMAN_GOVERNED_AUTHORITY',
  'HUMAN_GOVERNED_AUTHORITYHUMAN_GOVERNED_AUTHORITY', 'HUMAN_GOVERNED_AUTHORIT', 'UMAN_GOVERNED_AUTHORITY',
  0, 1, true, false, [], {}, [HUMAN], { authority_origin: HUMAN },
];

for (const cls of Object.keys(CLASSES)) {
  test(`N1 CASE-001/015 ${cls}: contract-valid HUMAN_GOVERNED_AUTHORITY/true/true is ADMITTED under the live trust`, () => {
    const x = n1Fixture(cls);
    assert.equal(verify(x.f.a), true);
    const v = n1Gate(x);
    assert.equal(v.verdict, 'ADMIT', JSON.stringify(v.codes));
    assert.equal(v.authority_origin, HUMAN);
    assert.equal(v.authority_subject_digest, NP.H(NP.signingBytes(x.f.a)));
  });

  for (const field of ['real_authority', 'production_validity']) {
    const code = field === 'real_authority' ? 'REAL_AUTHORITY_TYPE_INVALID' : 'PRODUCTION_VALIDITY_TYPE_INVALID';

    test(`N1 ${cls}: validly signed ${field} that is not a JSON boolean is DENIED ${code} (both trusts)`, () => {
      for (const bad of NOT_BOOLEAN) {
        n1Deny(cls, { [field]: bad }, code);
        n1Deny(cls, { [field]: bad }, code, { accept_synthetic_authorities: true });
      }
    });

    test(`N1 ${cls}: ${field} null / absent / "" stays DENIED AUTHORITY_INCOMPLETE`, () => {
      for (const bad of [null, ABSENT, '']) {
        const v = n1Deny(cls, { [field]: bad }, 'AUTHORITY_INCOMPLETE');
        assert.deepEqual(v.reasons[0].detail, [field]);
      }
    });

    test(`N1 CASE-002/008 ${cls}: ${field}=false is type-valid but NOT authority — DENIED under the live trust`, () => {
      n1Deny(cls, { [field]: false }, 'SYNTHETIC_AUTHORITY_REJECTED');
    });
  }

  test(`N1 ${cls}: validly signed authority_origin outside the two exact literals is DENIED AUTHORITY_ORIGIN_INVALID (both trusts)`, () => {
    for (const bad of BAD_ORIGIN) {
      n1Deny(cls, { authority_origin: bad }, 'AUTHORITY_ORIGIN_INVALID');
      n1Deny(cls, { authority_origin: bad }, 'AUTHORITY_ORIGIN_INVALID', { accept_synthetic_authorities: true });
    }
  });

  test(`N1 ${cls}: authority_origin null / absent / "" stays DENIED AUTHORITY_INCOMPLETE`, () => {
    for (const bad of [null, ABSENT, '']) n1Deny(cls, { authority_origin: bad }, 'AUTHORITY_INCOMPLETE');
  });

  test(`N1 CASE-014 ${cls}: FORENSIC_SYNTHETIC_ONLY keeps the existing synthetic-path semantics`, () => {
    // labelled synthetic but claiming real authority: mislabelled, whatever the trust says
    n1Deny(cls, { authority_origin: 'FORENSIC_SYNTHETIC_ONLY' }, 'SYNTHETIC_AUTHORITY_REJECTED');
    n1Deny(cls, { authority_origin: 'FORENSIC_SYNTHETIC_ONLY' }, 'SYNTHETIC_MISLABELLED', { accept_synthetic_authorities: true });
    // a correctly labelled drill object is rejected by the live trust
    n1Deny(cls, { authority_origin: 'FORENSIC_SYNTHETIC_ONLY', real_authority: false, production_validity: false }, 'SYNTHETIC_AUTHORITY_REJECTED');
    // a drill label spelt as strings is no longer silently non-synthetic
    n1Deny(cls, { authority_origin: 'forensic_synthetic_only', real_authority: 'false', production_validity: 'false' }, 'REAL_AUTHORITY_TYPE_INVALID');
  });

  test(`N1 ${cls}: a HUMAN_GOVERNED origin cannot carry a single false marker into admission (live trust)`, () => {
    n1Deny(cls, { real_authority: true, production_validity: false }, 'SYNTHETIC_AUTHORITY_REJECTED');
    n1Deny(cls, { real_authority: false, production_validity: true }, 'SYNTHETIC_AUTHORITY_REJECTED');
    n1Deny(cls, { real_authority: false, production_validity: false }, 'SYNTHETIC_AUTHORITY_REJECTED');
  });

  test(`N1 ${cls}: the type contract does not depend on the synthetic path — every marker is checked in every label context`, () => {
    // Each malformed marker is paired with every well-formed setting of the OTHER markers, including the
    // synthetic ones, under both trusts. A check skipped when the object already looks synthetic (origin
    // FORENSIC, or a false marker) is exposed under the drill trust, where the gate's synthetic rejection
    // does not mask it.
    const DRILL = { accept_synthetic_authorities: true };
    for (const origin of ['FORENSIC_SYNTHETIC_ONLY', HUMAN]) {
      for (const other of [true, false]) {
        for (const bad of ['true', 'false', 0, 1, [], {}]) {
          for (const [field, sibling] of [['production_validity', 'real_authority'], ['real_authority', 'production_validity']]) {
            const x = n1Fixture(cls, { authority_origin: origin, [sibling]: other, [field]: bad }, DRILL);
            assert.equal(verify(x.f.a), true);
            const v = n1Gate(x);
            const label = `${cls} origin=${origin} ${sibling}=${other} ${field}=${JSON.stringify(bad)}`;
            assert.equal(v.verdict, 'DENY', label);
            // FORENSIC with a real_authority other than false stops one step earlier as SYNTHETIC_MISLABELLED
            // (existing semantics). Every other combination must name the malformed field.
            const mislabelled = origin === 'FORENSIC_SYNTHETIC_ONLY' && x.f.a.real_authority !== false;
            const code = field === 'real_authority' ? 'REAL_AUTHORITY_TYPE_INVALID' : 'PRODUCTION_VALIDITY_TYPE_INVALID';
            assert.deepEqual(v.codes, [mislabelled ? 'SYNTHETIC_MISLABELLED' : code], label);
          }
        }
      }
    }
  });

  test(`N1 CASE-021 ${cls}: contract-valid metadata with an invalid signature is DENIED SIGNATURE_INVALID`, () => {
    const x = n1Fixture(cls);
    const sig = Buffer.from(x.f.a.signature, 'hex');
    sig[11] ^= 0x01;
    x.f.a.signature = sig.toString('hex');
    assert.equal(verify(x.f.a), false);
    const v = n1Gate(x);
    assert.equal(v.verdict, 'DENY');
    assert.deepEqual(v.codes, ['SIGNATURE_INVALID']);
  });
}

test('N1 CLI: a validly signed contract-invalid authority exits 1, so no `needs: authority-admission` job can run', () => {
  const x = n1Fixture('PRODUCTION', { real_authority: 'true' });
  assert.equal(verify(x.f.a), true);
  const r = runCli({ repo: REPO, env: x.env, files: std(x.f) });
  expectDeny(r, 'REAL_AUTHORITY_TYPE_INVALID');
  assert.equal(r.verdict.authority_subject_digest, null);
});

test('N1 LIB: the contract check is independent of the signature — an always-true verifier still DENIES', () => {
  const trustingEverything = { verifySignature: () => true };
  const lib = (marks) => {
    const { f, env } = n1Fixture('PRODUCTION', marks);
    const t = {
      schemaVersion: 'np-authority/1.1', trustedIssuers: [ISSUER], signatureAlgorithm: 'ed25519',
      scope: 'production-release', ...trustingEverything,
    };
    return NP.admitAuthority(f.a, { repository_id: env.GITHUB_REPOSITORY_ID }, t);
  };
  assert.equal(lib({ real_authority: 'false' }).code, 'REAL_AUTHORITY_TYPE_INVALID');
  assert.equal(lib({ production_validity: 0 }).code, 'PRODUCTION_VALIDITY_TYPE_INVALID');
  assert.equal(lib({ authority_origin: 'human_governed_authority' }).code, 'AUTHORITY_ORIGIN_INVALID');
  // control: a contract-valid object passes the contract and the (always-true) signature step and stops later
  assert.equal(lib({}).code, 'CANDIDATE_UNMEASURED');
});

test('N1 ORDERING PIN: contract-invalid metadata is DENIED before signature verification is reached', () => {
  const calls = [];
  const t = {
    schemaVersion: 'np-authority/1.1', trustedIssuers: [ISSUER], signatureAlgorithm: 'ed25519', scope: 'production-release',
    verifySignature: (i, b, s) => { calls.push(1); return verify({ ...JSON.parse(b.toString()), signature: s }); },
  };
  const run = (marks) => {
    calls.length = 0;
    const { f } = n1Fixture('PRODUCTION', marks);
    return { v: NP.admitAuthority(f.a, { repository_id: 'x' }, t), n: calls.length };
  };
  for (const marks of [{ real_authority: 0 }, { production_validity: 'true' }, { authority_origin: ' HUMAN_GOVERNED_AUTHORITY' }]) {
    const { v, n } = run(marks);
    assert.equal(v.verdict, 'DENY', JSON.stringify(marks));
    assert.equal(n, 0, `verifySignature must not be reached for ${JSON.stringify(marks)}`);
  }
  const ctrl = run({});
  assert.equal(ctrl.n, 1, 'control: a contract-valid object DOES reach verification exactly once');
  assert.equal(ctrl.v.code, 'REPOSITORY_MISMATCH', 'control passes the signature and stops at subject binding');
});

test('N1 DETAIL: the DENY names the JSON type only and never echoes the marker value', () => {
  const v = n1Deny('PRODUCTION', { authority_origin: 'HUMAN_GOVERNED_AUTHORITY-SECRET-LOOKALIKE' }, 'AUTHORITY_ORIGIN_INVALID');
  assert.deepEqual(v.reasons[0].detail, { type: 'string' });
  assert.deepEqual(n1Deny('PRODUCTION', { real_authority: [] }, 'REAL_AUTHORITY_TYPE_INVALID').reasons[0].detail, { type: 'array' });
  assert.deepEqual(n1Deny('PRODUCTION', { production_validity: {} }, 'PRODUCTION_VALIDITY_TYPE_INVALID').reasons[0].detail, { type: 'object' });
});

test('N1 SIGNING BOUNDARY: changing any signed marker after signing invalidates the signature', () => {
  const tampers = {
    'real_authority true->"true"': (a) => { a.real_authority = 'true'; },
    'real_authority true->false': (a) => { a.real_authority = false; },
    'production_validity true->1': (a) => { a.production_validity = 1; },
    'production_validity true->false': (a) => { a.production_validity = false; },
    'authority_origin HUMAN->FORENSIC': (a) => { a.authority_origin = 'FORENSIC_SYNTHETIC_ONLY'; },
    'authority_origin trailing space': (a) => { a.authority_origin = `${HUMAN} `; },
    'release_class PRODUCTION->PILOT (+class fields)': (a) => Object.assign(a, CLASSES.PILOT),
    'issuer_identity': (a) => { a.issuer_identity = 'someone-else@forensic.invalid'; },
    'subject_commit': (a) => { a.subject_commit = 'f'.repeat(40); },
    'scope': (a) => { a.scope = 'other'; },
  };
  for (const [name, tamper] of Object.entries(tampers)) {
    const x = n1Fixture('PRODUCTION');
    assert.equal(verify(x.f.a), true, `${name}: signed`);
    tamper(x.f.a);
    assert.equal(verify(x.f.a), false, `${name}: the signature must no longer verify`);
    const v = n1Gate(x);
    assert.equal(v.verdict, 'DENY', `${name}: must be DENIED`);
  }
  // canonicalization, not a bypass: reordering keys leaves the signing bytes (and the signature) intact
  const x = n1Fixture('PRODUCTION');
  const reordered = Object.fromEntries(Object.entries(x.f.a).reverse());
  assert.equal(NP.signingBytes(reordered).equals(NP.signingBytes(x.f.a)), true);
  assert.equal(verify(reordered), true);
});
