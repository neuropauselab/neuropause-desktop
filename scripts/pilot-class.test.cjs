'use strict';
/**
 * scripts/pilot-class.test.cjs — run: node --test scripts/pilot-class.test.cjs
 *
 * NP-RELEASE-082 adversarial matrix for the np-authority/1.1 envelope repair and the
 * PILOT-CLASS governance rules. Everything here is FORENSIC_SYNTHETIC_ONLY: the Ed25519
 * key pair is generated in memory for this run, nothing touches the repository, the
 * network, or any secret.
 *
 * The matrix re-tests, as permanent regressions:
 *   1. the sealed SIGNED_FIELDS defect — deleting the three unsigned rehearsal markers
 *      (authority_origin / real_authority / production_validity) from a validly signed
 *      rehearsal instrument must now invalidate the signature (FAIL CLOSED);
 *   2. unknown-field tamper — adding any field outside the closed schema must DENY;
 *   3. pilot → production escalation — mutating release_class after signing must DENY;
 *   4. pilot → public-feed escalation — mutating public_feed_permission must DENY;
 *   5. controlled → public distribution escalation must DENY;
 *   6. unsigned PRODUCTION must DENY even when freshly and validly signed;
 *   7. a well-formed PILOT authority (controlled distribution, feed DENY, unsigned
 *      pilot exception) with a valid signature over the FULL object is ADMITTED.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const NP = require('./lib/np-authority.cjs');

const SYNTHETIC = 'FORENSIC_SYNTHETIC_ONLY';
const ISSUER = 'pilot-issuer@forensic.invalid';
const REVIEWER = 'pilot-reviewer';
const KEYS = crypto.generateKeyPairSync('ed25519');
const sign = (a) => crypto.sign(null, NP.signingBytes(a), KEYS.privateKey).toString('hex');
const iso = (ms) => new Date(ms).toISOString();
const hex = (n) => crypto.randomBytes(n / 2).toString('hex');

const NOW = Date.now();
const COMMIT = hex(40);
const TREE = hex(40);
const POLICY = { id: 'np-synthetic-policy', version: '1', include: ['**'], exclude: [] };
const POPULATION = [{ path: 'a.txt', blob: hex(40), sha256: hex(64) }];
const MANIFEST = Buffer.from(NP.canon({ schema: 'np-b34-manifest/1', entries: POPULATION }));

function authority(overrides = {}, cls = 'PILOT') {
  const classFields =
    cls === 'PILOT'
      ? {
          release_class: 'PILOT',
          distribution_class: 'CONTROLLED_PILOT',
          public_feed_permission: 'DENY',
          signing_requirement: 'UNSIGNED_PILOT_EXCEPTION',
        }
      : {
          release_class: 'PRODUCTION',
          distribution_class: 'PUBLIC_PRODUCTION',
          public_feed_permission: 'ALLOW_SIGNED_ONLY',
          signing_requirement: 'REQUIRED',
        };
  const a = {
    authority_origin: SYNTHETIC,
    real_authority: false,
    production_validity: false,
    authority_id: `AUTH-${hex(8)}`,
    authority_schema_version: 'np-authority/1.1',
    issuer_identity: ISSUER,
    subject_repository: '000000001',
    subject_commit: COMMIT,
    subject_tree: TREE,
    manifest_digest: NP.H(MANIFEST),
    population_digest: NP.H(Buffer.from(NP.canon(POPULATION))),
    policy_digest: NP.H(Buffer.from(NP.canon(POLICY))),
    allowed_workflow: 'forensic/np-synthetic/.github/workflows/release.yml@refs/tags/v9',
    allowed_environment: 'production-release',
    scope: 'production-release',
    effective_from: iso(NOW - 3600e3),
    effective_until: iso(NOW + 3600e3),
    reviewer_identity: REVIEWER,
    reviewer_decision: 'approved',
    decision_timestamp: iso(NOW - 1800e3),
    decision_nonce: `NONCE-${hex(24)}`,
    signature_algorithm: 'ed25519',
    ...classFields,
    ...overrides,
  };
  a.signature = sign(a);
  return a;
}

function actualFor(a) {
  return {
    repository_id: a.subject_repository,
    candidate: { commit: COMMIT, tree: TREE, measured_from: 'git_objects' },
    manifest_bytes: MANIFEST,
    population: POPULATION,
    policy: POLICY,
    run: {
      run_id: '4242424242',
      run_attempt: 1,
      workflow_ref: a.allowed_workflow,
      initiator: 'dev-1',
      tag_pusher: 'dev-1',
      workflow_author: 'dev-1',
    },
    admission_time: NOW,
    deployment_time: NOW,
    review: {
      source: 'deployment_review_api',
      captured_by_verifier: true,
      approver: REVIEWER,
      run_id: '4242424242',
      run_attempt: 1,
      approved_subject_digest: NP.H(NP.signingBytes(a)),
    },
    environment: {
      source: 'admin_api_capture',
      captured_by_verifier: true,
      name: 'production-release',
      exists: true,
      required_reviewers: true,
      prevent_self_review: true,
      deployment_tag_pattern: 'v*',
    },
  };
}

const TRUST = {
  schemaVersion: 'np-authority/1.1',
  trustedIssuers: [ISSUER],
  signatureAlgorithm: 'ed25519',
  verifySignature: (issuer, bytes, sig) => {
    try {
      return issuer === ISSUER && crypto.verify(null, bytes, KEYS.publicKey, Buffer.from(sig, 'hex')) === true;
    } catch {
      return false;
    }
  },
  scope: 'production-release',
  tagPattern: 'v*',
  allowedReviewers: [REVIEWER],
  consumedNonces: [],
  deploymentTimeValidity: true,
  releaseClass: null,
};

const admit = (a, trust = TRUST) => NP.admitAuthority(a, actualFor(a), trust);
const rebind = (a) => actualFor(a); // review digest recomputed over the CURRENT object

test('baseline: well-formed signed PILOT authority is ADMITTED', () => {
  const r = admit(authority());
  assert.equal(r.verdict, 'ALLOW');
  assert.equal(r.code, 'AUTHORITY_ADMITTED');
});

test('baseline: well-formed signed PRODUCTION authority is ADMITTED', () => {
  const r = admit(authority({}, 'PRODUCTION'));
  assert.equal(r.verdict, 'ALLOW');
});

test('FIELD-DELETION TAMPER (sealed defect): deleting the three rehearsal markers now invalidates the signature', () => {
  const a = authority(); // validly signed rehearsal instrument
  delete a.authority_origin;
  delete a.real_authority;
  delete a.production_validity;
  const r = NP.admitAuthority(a, rebind(authority()), TRUST); // review bound to ORIGINAL subject
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'SIGNATURE_INVALID');
});

for (const field of ['authority_origin', 'real_authority', 'production_validity', 'release_class', 'public_feed_permission']) {
  test(`FIELD-DELETION TAMPER: deleting ${field} alone fails closed`, () => {
    const a = authority();
    delete a[field];
    const r = NP.admitAuthority(a, rebind(a), TRUST);
    assert.equal(r.verdict, 'DENY');
    assert.ok(
      // SYNTHETIC_MISLABELLED: deleting real_authority alone leaves authority_origin =
      // FORENSIC_SYNTHETIC_ONLY with real_authority !== false, which the earlier synthetic
      // guard DENIES before the signature is even consulted — equally fail-closed.
      ['SIGNATURE_INVALID', 'AUTHORITY_INCOMPLETE', 'SYNTHETIC_MISLABELLED'].includes(r.code),
      `expected fail-closed, got ${r.code}`,
    );
  });
}

test('UNKNOWN-FIELD TAMPER: adding a field outside the closed schema is DENIED before signature use', () => {
  const a = authority();
  a.emergency_production_override = true; // unknown security-relevant field
  const r = NP.admitAuthority(a, rebind(a), TRUST);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'UNKNOWN_FIELD_REJECTED');
});

test('UNKNOWN-FIELD TAMPER: even a re-signed object with an unknown field is DENIED', () => {
  const a = authority();
  a.emergency_production_override = true;
  a.signature = sign(a); // attacker with signing oracle still cannot smuggle unknown fields
  const r = NP.admitAuthority(a, rebind(a), TRUST);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'UNKNOWN_FIELD_REJECTED');
});

test('PILOT→PRODUCTION TAMPER: mutating release_class after signing invalidates the signature', () => {
  const a = authority(); // signed PILOT
  a.release_class = 'PRODUCTION';
  a.distribution_class = 'PUBLIC_PRODUCTION';
  a.public_feed_permission = 'ALLOW_SIGNED_ONLY';
  a.signing_requirement = 'REQUIRED';
  const r = NP.admitAuthority(a, rebind(a), TRUST);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'SIGNATURE_INVALID');
});

test('PILOT→PUBLIC-FEED TAMPER: mutating public_feed_permission alone fails closed', () => {
  const a = authority();
  a.public_feed_permission = 'ALLOW_SIGNED_ONLY';
  const r = NP.admitAuthority(a, rebind(a), TRUST);
  assert.equal(r.verdict, 'DENY');
  assert.ok(['SIGNATURE_INVALID', 'PILOT_PUBLIC_FEED_FORBIDDEN'].includes(r.code));
});

test('CONTROLLED→PUBLIC DISTRIBUTION TAMPER fails closed', () => {
  const a = authority();
  a.distribution_class = 'PUBLIC_PRODUCTION';
  const r = NP.admitAuthority(a, rebind(a), TRUST);
  assert.equal(r.verdict, 'DENY');
  assert.ok(['SIGNATURE_INVALID', 'PILOT_DISTRIBUTION_UNBOUNDED'].includes(r.code));
});

test('UNSIGNED PRODUCTION is DENIED even when freshly and validly signed', () => {
  const a = authority({ signing_requirement: 'UNSIGNED_PILOT_EXCEPTION' }, 'PRODUCTION');
  const r = admit(a);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'UNSIGNED_PRODUCTION_FORBIDDEN');
});

test('PILOT authority claiming public feed is DENIED even when freshly signed', () => {
  const a = authority({ public_feed_permission: 'ALLOW_SIGNED_ONLY' });
  const r = admit(a);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'PILOT_PUBLIC_FEED_FORBIDDEN');
});

test('PILOT authority with unbounded distribution is DENIED even when freshly signed', () => {
  const a = authority({ distribution_class: 'PUBLIC_PRODUCTION' });
  const r = admit(a);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'PILOT_DISTRIBUTION_UNBOUNDED');
});

test('invalid release_class value is DENIED', () => {
  const a = authority({ release_class: 'BETA' });
  const r = admit(a);
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'RELEASE_CLASS_INVALID');
});

test('trust expected_release_class pins the class: PILOT authority against PRODUCTION-pinned trust is DENIED', () => {
  const r = admit(authority(), { ...TRUST, releaseClass: 'PRODUCTION' });
  assert.equal(r.verdict, 'DENY');
  assert.equal(r.code, 'RELEASE_CLASS_MISMATCH');
});

test('MUTATION MATRIX: every security-relevant field mutation invalidates the signature', () => {
  const mutations = {
    subject_commit: hex(40),
    subject_tree: hex(40),
    allowed_environment: 'other-env',
    scope: 'other-scope',
    effective_until: iso(NOW + 720 * 3600e3),
    issuer_identity: 'other-issuer@forensic.invalid',
    reviewer_identity: 'other-reviewer',
    decision_nonce: `NONCE-${hex(24)}`,
    signing_requirement: 'REQUIRED',
  };
  for (const [k, v] of Object.entries(mutations)) {
    const a = authority();
    a[k] = v;
    const r = NP.admitAuthority(a, rebind(a), TRUST);
    assert.equal(r.verdict, 'DENY', `${k} mutation must DENY`);
  }
});

test('signingBytes covers the FULL object except signature (repair invariant)', () => {
  const a = authority();
  const withSig = { ...a };
  const withoutOrigin = { ...a };
  delete withoutOrigin.authority_origin;
  assert.notEqual(NP.H(NP.signingBytes(withSig)), NP.H(NP.signingBytes(withoutOrigin)));
  const sigIgnored = { ...a, signature: 'ff'.repeat(64) };
  assert.equal(NP.H(NP.signingBytes(withSig)), NP.H(NP.signingBytes(sigIgnored)));
});
