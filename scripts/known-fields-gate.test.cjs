'use strict';
//
// NP-107 (R14) — KNOWN_FIELDS gate: own `__proto__` rejection, and GATE ORDERING.
//
// NP-106 residual R14: "KNOWN_FIELDS protection is insufficiently tested. Existing test
// coverage does not directly exercise own `__proto__`. Gate ordering is not adequately pinned."
//
// Two things are proved here, and the second is the load-bearing one:
//
//   1. An authority carrying an own top-level `__proto__` DATA key is DENIED with
//      UNKNOWN_FIELD_REJECTED.
//   2. Signature verification is NOT REACHED when that happens — measured by counting calls
//      into the trust object's verifySignature, not by asserting on source text. If someone
//      moves the KNOWN_FIELDS gate to after signature verification, the count becomes 1 and
//      this battery fails. That is the ordering pin R14 asked for.
//
// A clean CONTROL is mandatory and is asserted: it proves the fixture actually reaches the
// verification step, so the zero in the dirty case is a real absence rather than a fixture
// that never got that far. A positive control that returns zero would invalidate the zero
// it is supposed to guard.
//
// NO KEY MATERIAL IS INVOLVED. verifySignature is a counting stub that always returns false;
// this battery asks whether verification is *reached*, never whether a signature is valid.
//
const test = require('node:test');
const assert = require('node:assert/strict');
const { admitAuthority, KNOWN_FIELDS } = require('./lib/np-authority.cjs');

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Preserves an own `__proto__` data property. A spread or Object.assign would invoke the
// inherited setter and re-parent the object instead of copying the key — the very defect
// this battery exists to detect, so it must not be used to build the fixtures.
const clone = (o) => Object.create(Object.getPrototypeOf(o), Object.getOwnPropertyDescriptors(o));

/** A maximally-complete authority, so admission reaches as deep as possible. */
function baseAuthority() {
  return JSON.parse(JSON.stringify({
    authority_id: 'NP-AUTH-1', authority_schema_version: 'np-authority/1.1',
    issuer_identity: 'issuer@x', subject_repository: 'repo-1',
    subject_commit: 'a'.repeat(40), subject_tree: 'b'.repeat(40),
    manifest_digest: 'c'.repeat(64), population_digest: 'd'.repeat(64), policy_digest: 'e'.repeat(64),
    allowed_workflow: 'wf', allowed_environment: 'prod-env', scope: 'sc',
    effective_from: '2026-01-01T00:00:00Z', effective_until: '2027-01-01T00:00:00Z',
    reviewer_identity: 'rev@x', reviewer_decision: 'approved',
    decision_timestamp: '2026-06-01T00:00:00Z', decision_nonce: 'n'.repeat(24),
    signature: 'f'.repeat(128), signature_algorithm: 'ed25519',
    release_class: 'PILOT', distribution_class: 'CONTROLLED_PILOT', public_feed_permission: 'DENY',
    signing_requirement: 'REQUIRED', authority_origin: 'REAL', real_authority: true,
    production_validity: true,
  }));
}

function actual() {
  return {
    repository_id: 'repo-1',
    run: { run_id: 'r1', run_attempt: 1, initiator: 'dev@x', tag_pusher: 'dev@x', workflow_author: 'dev@x' },
    candidate: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), measured_from: 'git_objects' },
    review: { source: 'deployment_review_api', captured_by_verifier: true, approver: 'rev@x', run_id: 'r1', run_attempt: 1, approved_subject_digest: null },
    environment: { source: 'admin_api_capture', captured_by_verifier: true, name: 'prod-env', exists: true, required_reviewers: true, prevent_self_review: true },
    policy: { p: 1 }, population: [1, 2], build_policy: undefined,
  };
}

/** Trust whose verifySignature counts its invocations and never returns true. */
function countingTrust() {
  const calls = [];
  const trust = {
    schemaVersion: 'np-authority/1.1', trustedIssuers: ['issuer@x'],
    signatureAlgorithm: 'ed25519', releaseClass: 'PILOT', allowedReviewers: ['rev@x'],
    verifySignature: (issuer, bytes, sig) => { calls.push({ issuer, len: bytes.length, sig }); return false; },
  };
  return { trust, calls };
}

/** Attach an own top-level `__proto__` DATA key, taken from a JSON.parse donor. */
function withOwnProto(a) {
  const donor = JSON.parse('{"__proto__":{"np107":"polluted"}}');
  const o = clone(a);
  Object.defineProperty(o, '__proto__', Object.getOwnPropertyDescriptor(donor, '__proto__'));
  return o;
}

const admit = (a) => {
  const { trust, calls } = countingTrust();
  const verdict = admitAuthority(a, actual(), trust);
  return { verdict, calls };
};

// ---------------------------------------------------------------------------
// 1. FIXTURE GUARD — the attack object really carries what we claim it carries.
//    Asserted three independent ways, none of which can lose the property.
// ---------------------------------------------------------------------------
test('FIXTURE GUARD: the dirty authority carries an own top-level __proto__ DATA key', () => {
  const dirty = withOwnProto(baseAuthority());

  assert.equal(hasOwn(dirty, '__proto__'), true, 'hasOwnProperty must see it');
  assert.equal(Object.keys(dirty).includes('__proto__'), true, 'it must be own and enumerable');

  const d = Object.getOwnPropertyDescriptor(dirty, '__proto__');
  assert.equal(typeof d, 'object');
  assert.equal(d.enumerable, true);
  assert.equal('value' in d, true, 'must be a DATA property, not an accessor');
  assert.equal('get' in d, false);

  // The clean fixture must NOT have it, or the comparison below proves nothing.
  assert.equal(hasOwn(baseAuthority(), '__proto__'), false);
});

test('KNOWN_FIELDS does not contain __proto__, so the gate is obliged to reject it', () => {
  assert.equal(KNOWN_FIELDS.has('__proto__'), false);
  assert.equal(KNOWN_FIELDS.size, 32);
});

// ---------------------------------------------------------------------------
// 2. REJECTION — verdict and reason.
// ---------------------------------------------------------------------------
test('own top-level __proto__ is DENIED as UNKNOWN_FIELD_REJECTED', () => {
  const { verdict } = admit(withOwnProto(baseAuthority()));
  assert.equal(verdict.verdict, 'DENY');
  assert.equal(verdict.code, 'UNKNOWN_FIELD_REJECTED');
  assert.deepEqual(verdict.detail, ['__proto__'], 'the offending key must be named in the detail');
});

// ---------------------------------------------------------------------------
// 3. ORDERING PIN — the load-bearing assertion, plus its mandatory control.
// ---------------------------------------------------------------------------
test('ORDERING PIN: the gate fires BEFORE signature verification (dirty reaches it 0 times)', () => {
  const { verdict, calls } = admit(withOwnProto(baseAuthority()));
  assert.equal(verdict.code, 'UNKNOWN_FIELD_REJECTED');
  assert.equal(calls.length, 0,
    'verifySignature must not be reached for an envelope carrying an unknown field; ' +
    'a non-zero count here means the KNOWN_FIELDS gate has been moved after verification');
});

test('CONTROL: the clean fixture DOES reach signature verification exactly once', () => {
  const { verdict, calls } = admit(baseAuthority());
  assert.equal(calls.length, 1,
    'the control must reach verification, otherwise the zero asserted above is meaningless');
  assert.equal(verdict.verdict, 'DENY');
  assert.equal(verdict.code, 'SIGNATURE_INVALID', 'stub verifier returns false, so this is the expected stop');
});

// ---------------------------------------------------------------------------
// 4. BOUNDARY, stated honestly — the gate is top-level only.
// ---------------------------------------------------------------------------
test('BOUNDARY: a NESTED own __proto__ inside a KNOWN field is not caught by this gate', () => {
  const a = baseAuthority();
  a.scope = JSON.parse('{"__proto__":{"np107":"nested"}}');
  const { verdict, calls } = admit(a);
  assert.equal(verdict.code !== 'UNKNOWN_FIELD_REJECTED', true,
    'documents the real boundary: KNOWN_FIELDS closes the TOP level only');
  assert.equal(calls.length, 1, 'it reaches verification, where canon() must distinguish it');
});
