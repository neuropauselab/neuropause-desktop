// node --test scripts/capture-deployment-review.test.cjs — pure selection logic (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectApproval } = require('./capture-deployment-review.cjs');

const D = 'a'.repeat(64);
const ok = (login, comment, env = 'production-release', state = 'approved') => ({ state, comment, environments: [{ name: env }], user: { login } });

test('selects the single approved review for the environment and extracts the digest from the comment', () => {
  const r = selectApproval([ok('reviewer-1', `authority ${D} approved`)], 'production-release');
  assert.equal(r.error, undefined);
  assert.equal(r.approver, 'reviewer-1');
  assert.equal(r.approved_subject_digest, D);
  assert.deepEqual(r.environments, ['production-release']);
});

test('denies when no approved review exists for the environment', () => {
  assert.match(selectApproval([ok('r', D, 'staging')], 'production-release').error, /no approved deployment review/);
  assert.match(selectApproval([ok('r', D, 'production-release', 'rejected')], 'production-release').error, /no approved deployment review/);
  assert.match(selectApproval([], 'production-release').error, /no approved/);
  assert.match(selectApproval({}, 'production-release').error, /not an array/);
});

test('denies ambiguous approvers', () => {
  const r = selectApproval([ok('a', D), ok('b', D)], 'production-release');
  assert.match(r.error, /ambiguous approvers/);
});

test('denies a comment without exactly one 64-hex digest', () => {
  assert.match(selectApproval([ok('r', 'looks good')], 'production-release').error, /exactly one 64-hex/);
  assert.match(selectApproval([ok('r', `${D} and ${'b'.repeat(64)}`)], 'production-release').error, /exactly one 64-hex/);
  assert.match(selectApproval([ok('r', 'c'.repeat(63))], 'production-release').error, /exactly one 64-hex/);
});

test('is case-insensitive on the digest and lower-cases it', () => {
  const r = selectApproval([ok('r', 'A'.repeat(64))], 'production-release');
  assert.equal(r.approved_subject_digest, D);
});
