#!/usr/bin/env node
/**
 * scripts/authority-admission.cjs — fail-closed release-authority admission gate (np-authority/1.1, Model E).
 * NP-RELEASE-082: v1.1 = full-coverage signing envelope + closed field set + release-class governance.
 *
 * CLI
 *   node scripts/authority-admission.cjs --authority <path> --trust <path> --out <path>
 *        [--review <capture.json>] [--environment <capture.json>] [--deployment-time <ISO-8601>]
 *
 *   exit 0  ADMIT — only when scripts/lib/np-authority.cjs admitAuthority() returned ALLOW / AUTHORITY_ADMITTED
 *   exit 1  DENY  — verdict JSON written to --out listing EVERY deny code (UNKNOWN from the predicate is a DENY)
 *   exit 2  usage / I/O error — no verdict could be written (bad arguments, --out not writable)
 *
 * Library
 *   const { admitFromEnvironment } = require('./scripts/authority-admission.cjs');
 *   admitFromEnvironment({ authorityPath, trustPath, now, cwd, env, reviewPath, environmentPath, deploymentTime })
 *     => { verdict: 'ADMIT' | 'DENY', codes: string[], reasons: [{ code, summary, detail }],
 *          actual: { ...non-secret measured fields... }, authority_id, issuer_identity, authority_subject_digest, ... }
 *   Never throws for expected failures; every failure is a DENY carrying codes such as AUTHORITY_TRUST_ABSENT,
 *   AUTHORITY_ABSENT, AUTHORITY_MALFORMED, MEASUREMENT_FAILED. Resolution order for each input:
 *   option → environment variable → default:
 *     authorityPath    NP_AUTHORITY_PATH                 default certification/public-launch/PUBLIC_RELEASE_AUTHORIZATION.json
 *     trustPath        NP_AUTHORITY_TRUST_PATH           default release-policy/authority-trust.json
 *     reviewPath       NP_AUTHORITY_REVIEW_CAPTURE       (optional; absent => REVIEW_RECORD_UNCAPTURED => DENY)
 *     environmentPath  NP_AUTHORITY_ENVIRONMENT_CAPTURE  (optional; absent => ENVIRONMENT_UNCAPTURED => DENY)
 *     deploymentTime   NP_AUTHORITY_DEPLOYMENT_TIME      (optional ISO-8601; default = admission time)
 *
 * What is measured, and from where (never the working tree):
 *   repository id, ref, tag, run id/attempt, workflow ref, actors  ← GitHub Actions context (GITHUB_*)
 *   commit = HEAD^{commit}; tree = HEAD^{tree}; tag object → peeled commit (must equal HEAD)  ← git objects
 *   population policy  = release-policy/population-policy.json at HEAD (git cat-file -p HEAD:<path>)
 *   population         = every blob at HEAD selected by policy.include minus policy.exclude:
 *                        [{ path, blob: <git blob id>, sha256: <sha256 of git cat-file -p HEAD:<path>> }] sorted by path
 *   manifest bytes     = canonical JSON { schema:'np-b34-manifest/1', candidate_commit, candidate_tree, policy_digest, entries: population }
 *   build policy       = release-policy/build-policy.json at HEAD (optional; required once the authority carries build_policy_digest)
 *   admission time     = now
 * The deployment review record and the protected-environment state cannot be measured by this process; they are
 * accepted as verifier-captured JSON via --review / --environment. Without them the predicate returns
 * REVIEW_RECORD_UNCAPTURED / ENVIRONMENT_UNCAPTURED and the gate DENIES.
 *
 * This gate never signs, never generates or modifies the authority or trust files, never contacts the network,
 * never reads a secret, and never prints key or signature material.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const NP = require('./lib/np-authority.cjs');

const { H, canon, plain } = NP;

const CONTRACT = Object.freeze({
  schema_version: 'np-authority/1.1',
  subject_model: 'E',
  signature_algorithm: 'ed25519',
  signature_encoding: 'hex',
  manifest_schema: 'np-b34-manifest/1',
  predicate: 'scripts/lib/np-authority.cjs',
  predicate_source: 'NP-R34.2-B.38 scripts/b38-authority.cjs',
  predicate_source_sha256: 'dbb629b85eb7a48c00bb09fc699e2891cc11775b1c3e50041fb25a38dc727901',
});

const DEFAULTS = Object.freeze({
  authorityPath: 'certification/public-launch/PUBLIC_RELEASE_AUTHORIZATION.json',
  trustPath: 'release-policy/authority-trust.json',
});

const POPULATION_POLICY_PATH = 'release-policy/population-policy.json';
const BUILD_POLICY_PATH = 'release-policy/build-policy.json';

const REQUIRED_ENV = [
  'GITHUB_EVENT_NAME',
  'GITHUB_REF',
  'GITHUB_REF_NAME',
  'GITHUB_SHA',
  'GITHUB_REPOSITORY',
  'GITHUB_REPOSITORY_ID',
  'GITHUB_WORKFLOW_REF',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT',
  'GITHUB_ACTOR',
];

/** One-line human summary per code (gate-level codes first, then every predicate code). */
const SUMMARIES = Object.freeze({
  // ---- gate-level (this file) ----
  AUTHORITY_TRUST_ABSENT:
    'no usable trust list: the trust file is missing, is the template, or names no trusted issuer — a repo admin who is not the release subject must commit release-policy/authority-trust.json via reviewed PR',
  AUTHORITY_TRUST_MALFORMED: 'the trust file is not valid JSON',
  AUTHORITY_TRUST_INVALID:
    'the trust file parsed but is unusable (schema version, signature algorithm, scope or an issuer public key is wrong)',
  AUTHORITY_ABSENT: 'no authority object: the authority file is missing or is a template — nothing external authorizes this release',
  AUTHORITY_MALFORMED: 'the authority file is not a JSON object',
  MEASUREMENT_FAILED:
    'the candidate could not be measured (GitHub Actions context missing, a git command failed, or a policy file is unreadable at HEAD)',
  CANDIDATE_INCONSISTENT: 'the triggering ref, its annotated tag object, HEAD and GITHUB_SHA do not describe one single candidate',
  SYNTHETIC_AUTHORITY_REJECTED:
    'the authority is labelled FORENSIC_SYNTHETIC_ONLY / real_authority=false / production_validity=false and the trust list does not accept synthetic authorities',
  CAPTURE_MALFORMED: 'a --review / --environment capture file was given but is missing or is not a JSON object',
  // ---- predicate (scripts/lib/np-authority.cjs) ----
  ACTUAL_UNMEASURED: 'no measurement object was produced for the predicate',
  SYNTHETIC_MISLABELLED: 'the authority is labelled FORENSIC_SYNTHETIC_ONLY but does not carry real_authority: false',
  SCHEMA_VERSION_UNSUPPORTED: 'authority_schema_version is not the version this verifier supports (np-authority/1.1)',
  AUTHORITY_INCOMPLETE: 'a REQUIRED authority field is missing or empty',
  ISSUER_UNTRUSTED: 'issuer_identity is not on the trusted issuer list',
  ISSUER_IS_SUBJECT: 'the issuer is a subject principal (run initiator, tag pusher or workflow author) — circular authority',
  ISSUER_IS_REVIEWER: 'the issuer and the reviewer are the same identity',
  SIGNATURE_ALGORITHM_REJECTED: 'signature_algorithm is not the algorithm fixed by the verifier (ed25519)',
  VERIFIER_UNAVAILABLE: 'no signature verifier could be constructed from the trust list',
  SIGNATURE_INVALID: 'the signature does not verify over the canonical signed fields with the trusted issuer key',
  REPOSITORY_MISMATCH: 'subject_repository differs from the measured repository id (GITHUB_REPOSITORY_ID)',
  CANDIDATE_UNMEASURED: 'the candidate commit/tree were not measured from git objects',
  REF_MISMATCH: 'subject_ref differs from the ref that triggered this run',
  TAG_MISMATCH: 'candidate_tag differs from the triggering tag name',
  COMMIT_MISMATCH: 'subject_commit differs from the commit measured from the tag object / HEAD',
  TREE_MISMATCH: 'subject_tree differs from HEAD^{tree}',
  MANIFEST_MISMATCH: 'manifest_digest differs from the manifest recomputed from git objects and the population policy',
  POPULATION_MISMATCH: 'population_digest differs from the audited population recomputed from git objects',
  POLICY_MISMATCH: 'policy_digest differs from the population policy at HEAD',
  BUILD_POLICY_MISMATCH: 'build_policy_digest differs from the build policy at HEAD, or no build policy is present at HEAD',
  WORKFLOW_MISMATCH: 'allowed_workflow differs from GITHUB_WORKFLOW_REF',
  SCOPE_MISMATCH: 'the authority scope differs from the trust list scope',
  TEMPORAL_FIELDS_MALFORMED: 'effective_from / effective_until / decision_timestamp are not parseable timestamps',
  ADMISSION_TIME_UNMEASURED: 'the admission time was not measured',
  DECISION_AFTER_ADMISSION: 'decision_timestamp is after the admission time',
  AUTHORITY_NOT_VALID_AT_ADMISSION: 'the admission time is outside [effective_from, effective_until]',
  AUTHORITY_EXPIRED_BEFORE_DEPLOYMENT: 'the deployment time is outside [effective_from, effective_until]',
  NONCE_WEAK: 'decision_nonce is shorter than 16 characters',
  AUTHORITY_REPLAYED: 'decision_nonce has already been consumed (trust list consumed_nonces ledger)',
  REVIEWER_NOT_APPROVED: 'reviewer_decision is not "approved"',
  REVIEW_RECORD_UNCAPTURED: 'no deployment review record captured by a verifier (source deployment_review_api) was provided',
  REVIEWER_IDENTITY_MISMATCH: 'the review record approver differs from reviewer_identity',
  REVIEWER_IS_SUBJECT: 'the approver is a subject principal (run initiator, tag pusher or workflow author)',
  REVIEW_RUN_MISMATCH: 'the review record is for a different run id / run attempt',
  REVIEW_NOT_BOUND_TO_AUTHORITY_SUBJECT: 'the review record is not bound to this authority subject digest',
  REVIEWER_NOT_ALLOWED: 'the approver is not on the trust list allowed_reviewers',
  ENVIRONMENT_UNCAPTURED: 'no protected-environment capture by a verifier (source admin_api_capture) was provided',
  ENVIRONMENT_MISMATCH: 'the captured environment name differs from allowed_environment',
  ENVIRONMENT_ABSENT: 'the protected environment does not exist',
  ENVIRONMENT_UNPROTECTED: 'the environment lacks required reviewers and/or prevent-self-review',
  ENVIRONMENT_TAG_POLICY_MISMATCH: 'the environment deployment tag pattern differs from the trust list tag_pattern',
  EXCEPTION: 'the predicate threw; treated as a non-admit',
  AUTHORITY_ADMITTED: 'admitted',
});

const summaryFor = (code) => SUMMARIES[code] || 'non-admit code without a registered summary (treated as DENY)';

class MeasurementError extends Error {}
class UsageError extends Error {}

const describeError = (e) =>
  String((e && e.message) || e)
    .replace(/\s+/g, ' ')
    .slice(0, 240);

const isoOf = (ms) => new Date(ms).toISOString();

function toMillis(v) {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v);
  return NaN;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON inputs
// ---------------------------------------------------------------------------------------------------------------

function readJson(p) {
  let raw;
  try {
    raw = fs.readFileSync(p);
  } catch (e) {
    return { status: 'absent', error: describeError(e) };
  }
  try {
    return { status: 'ok', value: JSON.parse(raw.toString('utf8')) };
  } catch (e) {
    return { status: 'malformed', error: describeError(e) };
  }
}

function loadIssuerKey(spec) {
  const pem = typeof spec === 'string' ? spec : plain(spec) ? spec.public_key_pem : undefined;
  if (typeof pem !== 'string' || !pem.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error('not a PEM (SPKI) public key');
  }
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== CONTRACT.signature_algorithm) throw new Error(`not an ${CONTRACT.signature_algorithm} key`);
  return key;
}

const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

/** Loads the admin-committed trust file and turns it into the predicate's trust object. Never throws. */
function loadTrust(trustPath) {
  const codes = [];
  const summary = { path: trustPath, present: false };
  const r = readJson(trustPath);
  if (r.status === 'absent') {
    codes.push({ code: 'AUTHORITY_TRUST_ABSENT', detail: `trust file not readable: ${r.error}` });
    return { codes, trust: null, trustFile: null, summary };
  }
  summary.present = true;
  if (r.status === 'malformed' || !plain(r.value)) {
    codes.push({ code: 'AUTHORITY_TRUST_MALFORMED', detail: r.status === 'malformed' ? r.error : 'not a JSON object' });
    return { codes, trust: null, trustFile: null, summary };
  }
  const t = r.value;
  if (t._template === true) codes.push({ code: 'AUTHORITY_TRUST_ABSENT', detail: 'trust file is the template (_template: true)' });
  if (!Array.isArray(t.trusted_issuers) || t.trusted_issuers.length === 0) {
    codes.push({ code: 'AUTHORITY_TRUST_ABSENT', detail: 'trusted_issuers is empty' });
  }
  if (codes.length) return { codes, trust: null, trustFile: t, summary };

  const problems = [];
  if (t.schema_version !== CONTRACT.schema_version) problems.push(`schema_version must be ${CONTRACT.schema_version}`);
  if (t.signature_algorithm !== CONTRACT.signature_algorithm) {
    problems.push(`signature_algorithm must be ${CONTRACT.signature_algorithm}`);
  }
  if (!isStringList(t.trusted_issuers)) problems.push('trusted_issuers must be a list of non-empty identity strings');
  if (typeof t.scope !== 'string' || !t.scope) problems.push('scope must be a non-empty string');
  for (const k of ['allowed_reviewers', 'consumed_nonces']) {
    if (t[k] !== undefined && !(Array.isArray(t[k]) && t[k].every((s) => typeof s === 'string'))) {
      problems.push(`${k} must be a list of strings when present`);
    }
  }
  if (t.tag_pattern !== undefined && typeof t.tag_pattern !== 'string') problems.push('tag_pattern must be a string');
  if (
    t.expected_release_class !== undefined &&
    t.expected_release_class !== null &&
    !['PILOT', 'PRODUCTION'].includes(t.expected_release_class)
  ) {
    problems.push("expected_release_class must be 'PILOT' or 'PRODUCTION' when present");
  }
  const keys = new Map();
  if (isStringList(t.trusted_issuers)) {
    for (const issuer of t.trusted_issuers) {
      try {
        keys.set(issuer, loadIssuerKey(plain(t.issuer_keys) ? t.issuer_keys[issuer] : undefined));
      } catch (e) {
        problems.push(`issuer_keys[${issuer}]: ${describeError(e)}`);
      }
    }
  }
  if (problems.length) {
    codes.push({ code: 'AUTHORITY_TRUST_INVALID', detail: problems });
    return { codes, trust: null, trustFile: t, summary };
  }

  const verifySignature = (issuer, bytes, sig) => {
    try {
      const key = keys.get(issuer);
      if (!key || !Buffer.isBuffer(bytes)) return false;
      if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return false;
      return crypto.verify(null, bytes, key, Buffer.from(sig, 'hex')) === true;
    } catch {
      return false;
    }
  };
  const trust = {
    schemaVersion: t.schema_version,
    trustedIssuers: t.trusted_issuers.slice(),
    signatureAlgorithm: t.signature_algorithm,
    verifySignature,
    scope: t.scope,
    tagPattern: t.tag_pattern,
    allowedReviewers: Array.isArray(t.allowed_reviewers) ? t.allowed_reviewers.slice() : undefined,
    consumedNonces: Array.isArray(t.consumed_nonces) ? t.consumed_nonces.slice() : [],
    deploymentTimeValidity: t.deployment_time_validity !== false,
    releaseClass: t.expected_release_class === undefined ? null : t.expected_release_class,
  };
  Object.assign(summary, {
    trusted_issuers: trust.trustedIssuers,
    scope: trust.scope,
    tag_pattern: trust.tagPattern === undefined ? null : trust.tagPattern,
    allowed_reviewers: trust.allowedReviewers === undefined ? null : trust.allowedReviewers,
    consumed_nonces_count: trust.consumedNonces.length,
    deployment_time_validity: trust.deploymentTimeValidity,
    accept_synthetic_authorities: t.accept_synthetic_authorities === true,
  });
  return { codes, trust, trustFile: t, summary };
}

/** Loads the externally issued authority object. Never throws; never modifies the file. */
function loadAuthority(authorityPath) {
  const codes = [];
  const r = readJson(authorityPath);
  if (r.status === 'absent') {
    codes.push({ code: 'AUTHORITY_ABSENT', detail: `authority file not readable: ${r.error}` });
    return { codes, authority: null };
  }
  if (r.status === 'malformed' || !plain(r.value)) {
    codes.push({ code: 'AUTHORITY_MALFORMED', detail: r.status === 'malformed' ? r.error : 'not a JSON object' });
    return { codes, authority: null };
  }
  if (r.value._template === true) {
    codes.push({ code: 'AUTHORITY_ABSENT', detail: 'authority file is a template (_template: true), not an issued authority' });
    return { codes, authority: null };
  }
  return { codes, authority: r.value };
}

/** Optional verifier-captured record (deployment review / protected environment). Absent => undefined. */
function loadCapture(capturePath, label) {
  if (capturePath === undefined || capturePath === null) return { codes: [], value: undefined };
  const r = readJson(capturePath);
  if (r.status !== 'ok' || !plain(r.value)) {
    const why = r.status === 'ok' ? 'not a JSON object' : r.error;
    return { codes: [{ code: 'CAPTURE_MALFORMED', detail: `${label} capture: ${why}` }], value: undefined };
  }
  return { codes: [], value: r.value };
}

/** run_id is a string and run_attempt a number in the measured run; normalise the capture the same way. */
function normalizeReview(review) {
  if (!plain(review)) return review;
  return {
    ...review,
    run_id: review.run_id === undefined ? undefined : String(review.run_id),
    run_attempt: review.run_attempt === undefined ? undefined : Number(review.run_attempt),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Git-object measurement
// ---------------------------------------------------------------------------------------------------------------

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
    });
  } catch (e) {
    const stderr = e && e.stderr ? e.stderr.toString('utf8').trim() : '';
    throw new MeasurementError(`git ${args.join(' ')} failed${stderr ? ': ' + stderr : ': ' + describeError(e)}`);
  }
}

const gitText = (cwd, args) => git(cwd, args).toString('utf8').trim();

const gitBlobId = (bytes) =>
  crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');

function listTree(cwd) {
  const out = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).toString('utf8');
  return out
    .split('\0')
    .filter(Boolean)
    .map((rec) => {
      const tab = rec.indexOf('\t');
      const [mode, type, sha] = rec.slice(0, tab).split(' ');
      return { mode, type, sha, path: rec.slice(tab + 1) };
    });
}

/**
 * Segment-wise glob matcher ported from the B.34 reference model (b34-reference.cjs `wildcard`):
 * `**` spans zero or more path segments, `*` and `?` never cross a `/`.
 */
function matchGlob(glob, p) {
  const gs = glob.split('/');
  const ps = p.split('/');
  const seg = (a, b) => {
    let i = 0;
    let j = 0;
    let star = -1;
    let mark = 0;
    while (j < b.length) {
      if (i < a.length && (a[i] === '?' || a[i] === b[j])) {
        i++;
        j++;
      } else if (i < a.length && a[i] === '*') {
        star = i++;
        mark = j;
      } else if (star >= 0) {
        i = star + 1;
        j = ++mark;
      } else return false;
    }
    while (i < a.length && a[i] === '*') i++;
    return i === a.length;
  };
  const rec = (gi, pi) => {
    if (gi === gs.length) return pi === ps.length;
    if (gs[gi] === '**') {
      for (let k = pi; k <= ps.length; k++) if (rec(gi + 1, k)) return true;
      return false;
    }
    if (pi >= ps.length) return false;
    return seg(gs[gi], ps[pi]) && rec(gi + 1, pi + 1);
  };
  return rec(0, 0);
}

const anyGlob = (globs, p) => Array.isArray(globs) && globs.some((g) => typeof g === 'string' && matchGlob(g, p));

function parseJsonObject(bytes, label) {
  let v;
  try {
    v = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    throw new MeasurementError(`${label} at HEAD is not valid JSON: ${describeError(e)}`);
  }
  if (!plain(v)) throw new MeasurementError(`${label} at HEAD is not a JSON object`);
  return v;
}

/** `owner/repo/.github/workflows/x.yml@refs/tags/v1` -> `.github/workflows/x.yml` */
function workflowPathFromRef(workflowRef, repository) {
  if (typeof workflowRef !== 'string' || !workflowRef) return null;
  const at = workflowRef.lastIndexOf('@');
  let p = at > 0 ? workflowRef.slice(0, at) : workflowRef;
  const prefix = `${repository}/`;
  if (typeof repository === 'string' && repository && p.startsWith(prefix)) p = p.slice(prefix.length);
  return p || null;
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Builds the predicate's `actual` from GitHub Actions context + git objects. Never throws. */
function measure({ env, cwd, now, deploymentTime }) {
  const codes = [];
  const measured = { measured_from: 'git_objects' };
  const fail = (detail) => codes.push({ code: 'MEASUREMENT_FAILED', detail });
  const inconsistent = (detail) => codes.push({ code: 'CANDIDATE_INCONSISTENT', detail });

  if (!Number.isFinite(now)) fail('admission time is not measurable (now is not a finite timestamp)');
  else measured.admission_time = isoOf(now);
  if (deploymentTime !== undefined) {
    if (!Number.isFinite(deploymentTime)) fail('deployment time is not a finite timestamp');
    else measured.deployment_time = isoOf(deploymentTime);
  }

  const missing = REQUIRED_ENV.filter((k) => typeof env[k] !== 'string' || env[k] === '');
  if (missing.length) {
    fail(`missing GitHub Actions context variable(s): ${missing.join(', ')}`);
    return { codes, actual: null, measured };
  }
  Object.assign(measured, {
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    tag: env.GITHUB_REF_NAME,
    github_sha: env.GITHUB_SHA,
    repository: env.GITHUB_REPOSITORY,
    repository_id: env.GITHUB_REPOSITORY_ID,
    workflow_ref: env.GITHUB_WORKFLOW_REF,
    run_id: String(env.GITHUB_RUN_ID),
    run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
    initiator: env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR,
    tag_pusher: env.GITHUB_ACTOR,
  });
  if (!Number.isInteger(measured.run_attempt) || measured.run_attempt < 1) fail('GITHUB_RUN_ATTEMPT is not a positive integer');

  let head;
  let tree;
  let entries;
  try {
    measured.repo_root = gitText(cwd, ['rev-parse', '--show-toplevel']);
    head = gitText(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
    tree = gitText(cwd, ['rev-parse', '--verify', 'HEAD^{tree}']);
    if (!NP.hex40(head) || !NP.hex40(tree)) throw new MeasurementError('HEAD commit/tree are not 40-hex object ids');
    measured.commit = head;
    measured.tree = tree;
    entries = listTree(cwd);
  } catch (e) {
    fail(describeError(e));
    return { codes, actual: null, measured };
  }

  // ---- candidate: the triggering tag's OBJECT → peeled commit; must agree with HEAD and GITHUB_SHA ----
  const ref = env.GITHUB_REF;
  if (!ref.startsWith('refs/tags/')) {
    inconsistent(`GITHUB_REF ${ref} is not a tag ref; release admission requires a pushed tag`);
  } else {
    if (env.GITHUB_REF_NAME !== ref.slice('refs/tags/'.length)) inconsistent('GITHUB_REF_NAME does not match GITHUB_REF');
    try {
      const refType = gitText(cwd, ['cat-file', '-t', ref]);
      measured.tag_ref_type = refType;
      if (refType !== 'tag') {
        inconsistent(`${ref} is not an annotated tag object (type ${refType}); the workflow must fetch the tag object itself`);
      } else {
        measured.tag_object = gitText(cwd, ['rev-parse', '--verify', `${ref}^{tag}`]);
        measured.tagger = gitText(cwd, ['for-each-ref', '--format=%(taggername) %(taggeremail)', ref]) || null;
      }
      const peeled = gitText(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
      measured.peeled_commit = peeled;
      if (peeled !== head) inconsistent(`${ref} peels to ${peeled} but HEAD is ${head}`);
      if (env.GITHUB_SHA !== peeled && env.GITHUB_SHA !== measured.tag_object) {
        inconsistent(`GITHUB_SHA ${env.GITHUB_SHA} is neither the peeled commit nor the tag object of ${ref}`);
      }
    } catch (e) {
      fail(describeError(e));
    }
  }

  // ---- workflow file → last author (git objects), completing the subject-principal set ----
  const wf = workflowPathFromRef(env.GITHUB_WORKFLOW_REF, env.GITHUB_REPOSITORY);
  measured.workflow_path = wf;
  if (!wf || !entries.some((e) => e.path === wf && e.type === 'blob')) {
    fail(`workflow file from GITHUB_WORKFLOW_REF (${wf || '?'}) is not present at HEAD`);
  } else {
    try {
      const author = gitText(cwd, ['log', '-1', '--format=%ae', 'HEAD', '--', wf]);
      if (!author) throw new MeasurementError(`workflow author of ${wf} is unmeasurable (shallow clone? fetch full history)`);
      measured.workflow_author = author;
    } catch (e) {
      fail(describeError(e));
    }
  }

  // ---- population policy → population → manifest, all from git objects at HEAD ----
  let policy;
  let population;
  let manifestBytes;
  let buildPolicy;
  if (!entries.some((e) => e.path === POPULATION_POLICY_PATH && e.type === 'blob')) {
    fail(`population policy ${POPULATION_POLICY_PATH} is not present at HEAD`);
  } else {
    try {
      policy = parseJsonObject(git(cwd, ['cat-file', '-p', `HEAD:${POPULATION_POLICY_PATH}`]), POPULATION_POLICY_PATH);
      if (!isStringList(policy.include)) {
        throw new MeasurementError(`${POPULATION_POLICY_PATH}: include must be a non-empty list of glob strings`);
      }
      if (policy.exclude !== undefined && !(Array.isArray(policy.exclude) && policy.exclude.every((g) => typeof g === 'string'))) {
        throw new MeasurementError(`${POPULATION_POLICY_PATH}: exclude must be a list of glob strings when present`);
      }
      measured.policy_path = POPULATION_POLICY_PATH;
      measured.policy_digest = H(Buffer.from(canon(policy)));
      const selected = entries.filter(
        (e) => e.type === 'blob' && anyGlob(policy.include, e.path) && !anyGlob(policy.exclude || [], e.path),
      );
      if (!selected.length) throw new MeasurementError('the population policy selects no files at HEAD');
      population = selected
        .map((e) => {
          const bytes = git(cwd, ['cat-file', '-p', `HEAD:${e.path}`]);
          if (gitBlobId(bytes) !== e.sha) throw new MeasurementError(`object store inconsistency for ${e.path}`);
          return { path: e.path, blob: e.sha, sha256: H(bytes) };
        })
        .sort(byPath);
      measured.population_count = population.length;
      measured.population_digest = H(Buffer.from(canon(population)));
      manifestBytes = Buffer.from(
        canon({
          schema: CONTRACT.manifest_schema,
          candidate_commit: head,
          candidate_tree: tree,
          policy_digest: measured.policy_digest,
          entries: population,
        }),
      );
      measured.manifest_schema = CONTRACT.manifest_schema;
      measured.manifest_digest = H(manifestBytes);
    } catch (e) {
      fail(describeError(e));
    }
  }
  measured.build_policy_path = BUILD_POLICY_PATH;
  measured.build_policy_present = entries.some((e) => e.path === BUILD_POLICY_PATH && e.type === 'blob');
  if (measured.build_policy_present) {
    try {
      buildPolicy = parseJsonObject(git(cwd, ['cat-file', '-p', `HEAD:${BUILD_POLICY_PATH}`]), BUILD_POLICY_PATH);
      measured.build_policy_digest = H(Buffer.from(canon(buildPolicy)));
    } catch (e) {
      fail(describeError(e));
    }
  }

  if (codes.length) return { codes, actual: null, measured };
  const actual = {
    repository_id: env.GITHUB_REPOSITORY_ID,
    candidate: { ref, tag: env.GITHUB_REF_NAME, commit: head, tree, measured_from: 'git_objects' },
    manifest_bytes: manifestBytes,
    population,
    policy,
    build_policy: buildPolicy,
    run: {
      run_id: measured.run_id,
      run_attempt: measured.run_attempt,
      workflow_ref: env.GITHUB_WORKFLOW_REF,
      initiator: measured.initiator,
      tag_pusher: measured.tag_pusher,
      workflow_author: measured.workflow_author,
    },
    admission_time: now,
    deployment_time: deploymentTime,
  };
  return { codes, actual, measured };
}

// ---------------------------------------------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------------------------------------------

const isSynthetic = (a) =>
  a.authority_origin === 'FORENSIC_SYNTHETIC_ONLY' || a.real_authority === false || a.production_validity === false;

/**
 * The gate. Returns a verdict record; never throws for expected failures.
 * @param {object} [opts]
 * @param {string} [opts.authorityPath]   (or NP_AUTHORITY_PATH) default certification/public-launch/PUBLIC_RELEASE_AUTHORIZATION.json
 * @param {string} [opts.trustPath]       (or NP_AUTHORITY_TRUST_PATH) default release-policy/authority-trust.json
 * @param {string} [opts.reviewPath]      (or NP_AUTHORITY_REVIEW_CAPTURE) verifier-captured deployment review record
 * @param {string} [opts.environmentPath] (or NP_AUTHORITY_ENVIRONMENT_CAPTURE) verifier-captured protected-environment state
 * @param {number|string|Date} [opts.now] admission time (default: Date.now())
 * @param {number|string|Date} [opts.deploymentTime] (or NP_AUTHORITY_DEPLOYMENT_TIME) latest planned publication time
 * @param {string} [opts.cwd]             repository checkout (default: process.cwd())
 * @param {object} [opts.env]             GitHub Actions context (default: process.env)
 */
function admitFromEnvironment(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const env = opts.env || process.env;
  const given = (v) => v !== undefined && v !== null && v !== '';
  const input = (optValue, envKey) => (given(optValue) ? optValue : given(env[envKey]) ? env[envKey] : undefined);
  const authorityPath = path.resolve(cwd, input(opts.authorityPath, 'NP_AUTHORITY_PATH') || DEFAULTS.authorityPath);
  const trustPath = path.resolve(cwd, input(opts.trustPath, 'NP_AUTHORITY_TRUST_PATH') || DEFAULTS.trustPath);
  const reviewInput = input(opts.reviewPath, 'NP_AUTHORITY_REVIEW_CAPTURE');
  const environmentInput = input(opts.environmentPath, 'NP_AUTHORITY_ENVIRONMENT_CAPTURE');
  const reviewPath = reviewInput ? path.resolve(cwd, reviewInput) : undefined;
  const environmentPath = environmentInput ? path.resolve(cwd, environmentInput) : undefined;
  const now = opts.now === undefined ? Date.now() : toMillis(opts.now);
  const deploymentTime = toMillis(input(opts.deploymentTime, 'NP_AUTHORITY_DEPLOYMENT_TIME'));

  const reasons = [];
  const push = (list) => {
    for (const r of list) reasons.push({ code: r.code, summary: summaryFor(r.code), detail: r.detail === undefined ? null : r.detail });
  };

  const T = loadTrust(trustPath);
  push(T.codes);
  const Au = loadAuthority(authorityPath);
  push(Au.codes);
  const Rv = loadCapture(reviewPath, 'review');
  push(Rv.codes);
  const Ev = loadCapture(environmentPath, 'environment');
  push(Ev.codes);
  const M = measure({ env, cwd, now, deploymentTime });
  push(M.codes);
  if (Au.authority && isSynthetic(Au.authority) && !(T.trustFile && T.trustFile.accept_synthetic_authorities === true)) {
    push([{ code: 'SYNTHETIC_AUTHORITY_REJECTED', detail: 'authority carries FORENSIC_SYNTHETIC_ONLY / real_authority=false / production_validity=false' }]);
  }

  const a = Au.authority;
  const record = {
    schema: 'np-authority-admission/1',
    verdict: 'DENY',
    codes: [],
    reasons: [],
    admission: null,
    authority_id: a && typeof a.authority_id === 'string' ? a.authority_id : null,
    issuer_identity: a && typeof a.issuer_identity === 'string' ? a.issuer_identity : null,
    authority_origin: a && typeof a.authority_origin === 'string' ? a.authority_origin : null,
    authority_subject_digest: null,
    admission_time: Number.isFinite(now) ? isoOf(now) : null,
    inputs: { authority: authorityPath, trust: trustPath, review: reviewPath || null, environment: environmentPath || null },
    actual: M.measured,
    trust: T.summary,
    contract: CONTRACT,
  };
  const finish = (verdict, list, admission) => {
    record.verdict = verdict;
    record.reasons = list;
    record.codes = list.map((r) => r.code);
    record.admission = admission;
    if (verdict === 'ADMIT') record.authority_subject_digest = admission.detail.authority_subject_digest;
    return record;
  };
  if (reasons.length) return finish('DENY', reasons, null);

  const actual = { ...M.actual, review: normalizeReview(Rv.value), environment: Ev.value };
  let adm;
  try {
    adm = NP.admitAuthority(a, actual, T.trust);
  } catch (e) {
    adm = { verdict: 'UNKNOWN', code: 'EXCEPTION', detail: describeError(e) };
  }
  if (
    plain(adm) &&
    adm.verdict === 'ALLOW' &&
    adm.code === 'AUTHORITY_ADMITTED' &&
    plain(adm.detail) &&
    NP.hex64(adm.detail.authority_subject_digest)
  ) {
    return finish('ADMIT', [], adm);
  }
  const code = plain(adm) && typeof adm.code === 'string' ? adm.code : 'EXCEPTION';
  return finish('DENY', [{ code, summary: summaryFor(code), detail: plain(adm) && adm.detail !== undefined ? adm.detail : null }], adm);
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

const USAGE = `usage: node scripts/authority-admission.cjs --authority <path> --trust <path> --out <path>
            [--review <capture.json>] [--environment <capture.json>] [--deployment-time <ISO-8601>]
exit 0 = ADMIT · 1 = DENY (verdict written to --out) · 2 = usage/I-O error
`;

function parseArgs(argv) {
  const spec = {
    '--authority': 'authorityPath',
    '--trust': 'trustPath',
    '--out': 'outPath',
    '--review': 'reviewPath',
    '--environment': 'environmentPath',
    '--deployment-time': 'deploymentTime',
  };
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    const key = spec[flag];
    if (!key) throw new UsageError(`unknown argument ${flag}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} requires a value`);
    if (o[key] !== undefined) throw new UsageError(`${flag} given twice`);
    o[key] = v;
    i++;
  }
  for (const [flag, key] of [['--authority', 'authorityPath'], ['--trust', 'trustPath'], ['--out', 'outPath']]) {
    if (!o[key]) throw new UsageError(`${flag} is required`);
  }
  if (o.deploymentTime !== undefined && !Number.isFinite(Date.parse(o.deploymentTime))) {
    throw new UsageError('--deployment-time must be an ISO-8601 timestamp');
  }
  return o;
}

const detailText = (d) => {
  const s = typeof d === 'string' ? d : JSON.stringify(d);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
};

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`::error::authority-admission: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stderr.write(USAGE);
    return 2; // exit 0 is reserved for ADMIT
  }
  const result = admitFromEnvironment({
    authorityPath: args.authorityPath,
    trustPath: args.trustPath,
    reviewPath: args.reviewPath,
    environmentPath: args.environmentPath,
    deploymentTime: args.deploymentTime === undefined ? undefined : Date.parse(args.deploymentTime),
  });
  const outPath = path.resolve(args.outPath);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`::error::authority-admission: cannot write --out ${outPath}: ${describeError(e)}\n`);
    return 2;
  }
  if (result.verdict === 'ADMIT') {
    const m = result.actual;
    console.log(
      `authority-admission: ADMIT authority_id=${result.authority_id} issuer=${result.issuer_identity} ` +
        `subject=${m.tag}@${m.commit} tree=${m.tree} authority_subject_digest=${result.authority_subject_digest}`,
    );
    return 0;
  }
  for (const r of result.reasons) {
    console.log(`::error::authority-admission: DENY ${r.code} — ${r.summary}${r.detail ? ` [${detailText(r.detail)}]` : ''}`);
  }
  console.log(`authority-admission: DENY (${result.codes.length} code${result.codes.length === 1 ? '' : 's'}) — verdict written to ${outPath}`);
  return 1;
}

module.exports = {
  admitFromEnvironment,
  measure,
  loadTrust,
  loadAuthority,
  matchGlob,
  workflowPathFromRef,
  SUMMARIES,
  CONTRACT,
  DEFAULTS,
  POPULATION_POLICY_PATH,
  BUILD_POLICY_PATH,
  REQUIRED_ENV,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
