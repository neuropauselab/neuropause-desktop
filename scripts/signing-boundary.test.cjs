'use strict';
/**
 * scripts/signing-boundary.test.cjs — run: node --test scripts/signing-boundary.test.cjs
 *
 * NP-103-Q2, authorized by NP-Q2-HUMAN-DECISION-004. Distinct from NP-101/F3 and from
 * scripts/canon-proto.test.cjs, which covers canon() and must keep passing unchanged.
 *
 * THE DEFECT. NP-101 repaired canon() so an own `__proto__` data key survives canonicalization.
 * signingBytes() runs one frame ABOVE canon() and rebuilt its input with PLAIN ASSIGNMENT:
 *     const o = {}; for (...) o[k] = a[k];
 * `o.__proto__ = value` invokes the Object.prototype accessor and re-parents `o` instead of
 * creating an own property, so a TOP-LEVEL own `__proto__` member was destroyed before canon()
 * ever saw it. Three semantically distinct objects collapsed to one signing representation and a
 * single ed25519 signature verified over all of them. Repairing canon() alone did not reach this.
 *
 * Expected canonical strings below are written by hand, so the oracle does not restate the
 * implementation. `__proto__` is materialised as an own DATA key via JSON.parse — an object
 * literal would set the prototype instead, which is the whole point of the defect.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signingBytes, canon, H, REQUIRED } = require('./lib/np-authority.cjs');

const J = (s) => JSON.parse(s);
const sb = (o) => signingBytes(o).toString('utf8');

test('the attack objects really do carry an own __proto__ DATA key', () => {
  const A = J('{"__proto__":{"x":1}}');
  assert.equal(Object.prototype.hasOwnProperty.call(A, '__proto__'), true);
  assert.equal(Object.keys(A).includes('__proto__'), true);
  assert.equal(Object.getPrototypeOf(A), Object.prototype, 'JSON.parse must not move the prototype');
  assert.equal(Object.getOwnPropertyDescriptor(A, '__proto__').value.x, 1);
});

test('PRIMARY: a top-level own __proto__ survives into the signing bytes', () => {
  assert.equal(sb(J('{"__proto__":{"x":1}}')), '{"__proto__":{"x":1}}');
  assert.equal(sb(J('{"__proto__":{"x":1},"a":1}')), '{"__proto__":{"x":1},"a":1}');
  assert.equal(sb(J('{"a":1}')), '{"a":1}');
});

test('PRIMARY: semantically distinct top-level objects no longer collapse', () => {
  const A = J('{"__proto__":{"x":1}}');
  const B = J('{"__proto__":{"x":2}}');
  const C = J('{}');
  assert.notEqual(sb(A), sb(B));
  assert.notEqual(sb(A), sb(C));
  assert.notEqual(sb(B), sb(C));
  assert.equal(new Set([H(signingBytes(A)), H(signingBytes(B)), H(signingBytes(C))]).size, 3);
});

test('SIGNATURE CONSEQUENCE: one signature can no longer stand for distinct signing objects', () => {
  const keys = crypto.generateKeyPairSync('ed25519'); // ephemeral, in memory, never written
  const A = J('{"__proto__":{"x":1},"authority_id":"A"}');
  const B = J('{"__proto__":{"x":2},"authority_id":"A"}');
  const C = J('{"authority_id":"A"}');
  const D = J('{"__proto__":{"x":1},"authority_id":"DIFFERENT"}'); // ordinary-field control
  const sig = crypto.sign(null, signingBytes(A), keys.privateKey);
  const v = (o) => crypto.verify(null, signingBytes(o), keys.publicKey, sig);
  assert.equal(v(A), true);
  assert.equal(v(B), false);
  assert.equal(v(C), false);
  assert.equal(v(D), false, 'positive control: an ordinary field change must also invalidate');
});

test('NESTED REGRESSION: the NP-101 repair is retained, not replaced', () => {
  assert.notEqual(sb(J('{"allowed_channels":{"__proto__":{"x":1}}}')), sb(J('{"allowed_channels":{"__proto__":{"x":2}}}')));
  assert.equal(sb(J('{"allowed_channels":{"__proto__":{"x":1}}}')), '{"allowed_channels":{"__proto__":{"x":1}}}');
  assert.notEqual(sb(J('{"a":[{"__proto__":{"x":1}}]}')), sb(J('{"a":[{"__proto__":{"x":2}}]}')));
  // canon() itself is unchanged by this seam
  assert.equal(canon(J('{"a":{"__proto__":{"x":1}}}')), '{"a":{"__proto__":{"x":1}}}');
});

test('MULTIPLE LOCATIONS: top-level and nested __proto__ are independently distinguished', () => {
  const base = '{"__proto__":{"t":%T},"a":{"__proto__":{"n":%N}}}';
  const mk = (t, n) => J(base.replace('%T', t).replace('%N', n));
  assert.notEqual(sb(mk(1, 1)), sb(mk(2, 1)), 'top-level value must matter');
  assert.notEqual(sb(mk(1, 1)), sb(mk(1, 2)), 'nested value must matter');
  assert.equal(sb(mk(1, 1)), '{"__proto__":{"t":1},"a":{"__proto__":{"n":1}}}');
});

test('CONTRACT PRESERVED: signature excluded, undefined dropped, keys sorted, arrays in order', () => {
  assert.equal(sb({ a: 1, signature: '0'.repeat(128) }), '{"a":1}');
  assert.equal(sb({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(sb(J('{"z":1,"a":2,"m":3}')), '{"a":2,"m":3,"z":1}');
  assert.equal(sb(J('{"a":[3,1,2]}')), '{"a":[3,1,2]}');
  assert.equal(sb(J('{"n":null,"t":true,"s":"x"}')), '{"n":null,"s":"x","t":true}');
  assert.equal(sb({}), '{}');
  // a `signature` key nested inside a member is NOT excluded — only the top-level one is
  assert.equal(sb(J('{"a":{"signature":"keep"}}')), '{"a":{"signature":"keep"}}');
});

test('CONTRACT PRESERVED: inherited and non-enumerable own properties stay excluded', () => {
  assert.equal(sb(Object.create({ inherited: 1 })), '{}');
  const child = Object.create({ inherited: 1 });
  child.own = 2;
  assert.equal(sb(child), '{"own":2}');
  const o = { a: 1 };
  Object.defineProperty(o, 'hidden', { value: 2, enumerable: false });
  assert.equal(sb(o), '{"a":1}');
});

test('DESCRIPTORS: an own __proto__ is honoured when enumerable, ignored when not', () => {
  const mk = (desc) => {
    const o = { a: 1 };
    Object.defineProperty(o, '__proto__', { value: { x: 1 }, ...desc });
    return o;
  };
  assert.equal(sb(mk({ enumerable: true, writable: true, configurable: true })), '{"__proto__":{"x":1},"a":1}');
  assert.equal(sb(mk({ enumerable: true, writable: false, configurable: false })), '{"__proto__":{"x":1},"a":1}');
  assert.equal(sb(mk({ enumerable: false, writable: true, configurable: true })), '{"a":1}', 'non-enumerable stays out, as for any key');
});

test('PROTOTYPE: an INHERITED __proto__ is not serialized; canon() does not pollute', () => {
  const proto = J('{"__proto__":{"x":1}}');
  const child = Object.create(proto);
  child.a = 1;
  assert.equal(sb(child), '{"a":1}', 'inherited members are not own keys');
  signingBytes(J('{"__proto__":{"NP103_POLLUTED":true}}'));
  assert.equal({}.NP103_POLLUTED, undefined);
  assert.equal(Object.prototype.NP103_POLLUTED, undefined);
});

// NP-107 (TEST-11 repair). The previous oracle DERIVED `expected` from REQUIRED, so both
// sides of the assertion moved together and the test could not observe a change to REQUIRED.
// Measured vacuity: deleting 'release_class' from REQUIRED took REQUIRED.length 27 -> 26 and
// left the battery 11/11 green. The oracle below is a FROZEN LITERAL, independent of the
// module, so a REQUIRED-membership mutation fails it. Regenerate deliberately, never by
// copying the module's current output back in.
const REQUIRED_FROZEN = Object.freeze([
  'authority_id', 'authority_schema_version', 'issuer_identity', 'subject_repository',
  'subject_commit', 'subject_tree', 'manifest_digest', 'population_digest', 'policy_digest',
  'allowed_workflow', 'allowed_environment', 'scope', 'effective_from', 'effective_until',
  'reviewer_identity', 'reviewer_decision', 'decision_timestamp', 'decision_nonce',
  'signature', 'signature_algorithm', 'release_class', 'distribution_class',
  'public_feed_permission', 'signing_requirement', 'authority_origin', 'real_authority',
  'production_validity',
]);

const ENVELOPE_FROZEN =
  '{"allowed_environment":"v-allowed_environment","allowed_workflow":"v-allowed_workflow",' +
  '"authority_id":"v-authority_id","authority_origin":"v-authority_origin",' +
  '"authority_schema_version":"v-authority_schema_version","decision_nonce":"v-decision_nonce",' +
  '"decision_timestamp":"v-decision_timestamp","distribution_class":"v-distribution_class",' +
  '"effective_from":"v-effective_from","effective_until":"v-effective_until",' +
  '"issuer_identity":"v-issuer_identity","manifest_digest":"v-manifest_digest",' +
  '"policy_digest":"v-policy_digest","population_digest":"v-population_digest",' +
  '"production_validity":true,"public_feed_permission":"v-public_feed_permission",' +
  '"real_authority":true,"release_class":"v-release_class",' +
  '"reviewer_decision":"v-reviewer_decision","reviewer_identity":"v-reviewer_identity",' +
  '"scope":"v-scope","signature_algorithm":"v-signature_algorithm",' +
  '"signing_requirement":"v-signing_requirement","subject_commit":"v-subject_commit",' +
  '"subject_repository":"v-subject_repository","subject_tree":"v-subject_tree"}';

test('REQUIRED MEMBERSHIP: pinned to a frozen literal, not derived from the module', () => {
  assert.deepEqual(REQUIRED.slice(), REQUIRED_FROZEN.slice(),
    'REQUIRED membership or order changed; if intentional, update REQUIRED_FROZEN deliberately');
  assert.equal(REQUIRED.length, 27);
});

test('27-FIELD ENVELOPE: unchanged, so historical digests still reproduce', () => {
  // `a` is built from the LIVE REQUIRED and compared against the FROZEN literal, so a
  // membership mutation changes the left side only and the assertion fails.
  const a = {};
  for (const k of REQUIRED) a[k] = k === 'real_authority' || k === 'production_validity' ? true : `v-${k}`;
  assert.equal(sb(a), ENVELOPE_FROZEN);
  assert.equal(REQUIRED.includes('signature'), true, 'signature is REQUIRED but must not appear above');
  assert.equal(sb(a).includes('"signature"'), false);
});
