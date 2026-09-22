'use strict';
/**
 * scripts/canon-proto.test.cjs — run: node --test scripts/canon-proto.test.cjs
 *
 * NP-101-Q2 (Track 2) adversarial battery for the F3 canonical-serialization repair, authorized by
 * NP-Q2-HUMAN-REMEDIATION-AUTHORIZATION-001 and reconfirmed by NP-Q2-HUMAN-DECISION-003.
 *
 * THE DEFECT. `canon()` rebuilt each object by ASSIGNING own keys onto a fresh `{}`. Because
 * `Object.prototype.__proto__` is an accessor, `r.__proto__ = value` invoked the setter and set
 * r's prototype instead of creating an own property — so a `__proto__` member, which JSON.parse
 * produces as an ordinary own DATA key, disappeared from the canonical output at every depth.
 * Semantically distinct objects collapsed to identical bytes and one signature covered both.
 *
 * WHAT THIS BATTERY ESTABLISHES, and what it deliberately does not:
 *   - distinct semantic objects produce distinct canonical bytes, including through `__proto__`;
 *   - the ordering/dropping contract is unchanged;
 *   - bytes are IDENTICAL for every input carrying no own `__proto__` key, so previously computed
 *     digests still reproduce — this is the regression property the repair must not break;
 *   - canon() does not pollute Object.prototype. It never did: the old code polluted the fresh
 *     local object, not the global one. This battery does NOT claim general prototype-pollution
 *     protection for the repository, only what is measured here.
 *
 * Expected canonical strings below are written out by hand, not produced by calling canon(), so
 * the oracle is independent of the implementation under test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { canon, signingBytes, H } = require('./lib/np-authority.cjs');

/** JSON.parse is the only way to get `__proto__` as an own DATA key; object literals set the prototype. */
const J = (s) => JSON.parse(s);

test('A/B/J/K/L/M/N primitives, plain and nested objects keep their existing canonical form', () => {
  assert.equal(canon(J('{"a":1}')), '{"a":1}');
  assert.equal(canon(J('{"a":{"b":1}}')), '{"a":{"b":1}}');
  assert.equal(canon({}), '{}');
  assert.equal(canon(null), 'null');
  assert.equal(canon(true), 'true');
  assert.equal(canon(false), 'false');
  assert.equal(canon('s'), '"s"');
  assert.equal(canon(42), '42');
  assert.equal(canon(-0.5), '-0.5');
  assert.equal(canon([3, 1, 2]), '[3,1,2]');
});

test('C/D nested own __proto__ is preserved, and different values stay different', () => {
  assert.equal(canon(J('{"a":{"__proto__":{"x":1}}}')), '{"a":{"__proto__":{"x":1}}}');
  assert.equal(canon(J('{"a":{"__proto__":{"x":2}}}')), '{"a":{"__proto__":{"x":2}}}');
  assert.notEqual(canon(J('{"a":{"__proto__":{"x":1}}}')), canon(J('{"a":{"__proto__":{"x":2}}}')));
  // The original collision: a __proto__-bearing object must no longer equal the object without it.
  assert.notEqual(canon(J('{"a":{"__proto__":{"x":1}}}')), canon(J('{"a":{}}')));
  assert.equal(canon(J('{"a":{}}')), '{"a":{}}', 'the plain form itself is unchanged');
});

test('E sibling keys alongside __proto__ are all preserved and sorted', () => {
  assert.equal(canon(J('{"a":{"__proto__":{"x":1},"b":2}}')), '{"a":{"__proto__":{"x":1},"b":2}}');
  assert.equal(canon(J('{"a":{"b":2,"__proto__":{"x":1}}}')), '{"a":{"__proto__":{"x":1},"b":2}}');
});

test('F key-order permutations canonicalize identically (the ordering contract is unchanged)', () => {
  const perms = ['{"a":1,"b":2,"c":3}', '{"c":3,"a":1,"b":2}', '{"b":2,"c":3,"a":1}'];
  for (const p of perms) assert.equal(canon(J(p)), '{"a":1,"b":2,"c":3}');
  const withProto = ['{"__proto__":{"x":1},"a":1}', '{"a":1,"__proto__":{"x":1}}'];
  for (const p of withProto) assert.equal(canon(J(p)), '{"__proto__":{"x":1},"a":1}');
});

test('G arrays containing objects with __proto__ preserve them, in order', () => {
  assert.equal(canon(J('{"a":[{"__proto__":{"x":1},"b":2}]}')), '{"a":[{"__proto__":{"x":1},"b":2}]}');
  assert.equal(canon(J('[{"__proto__":{"x":1}},{"__proto__":{"x":2}}]')), '[{"__proto__":{"x":1}},{"__proto__":{"x":2}}]');
  assert.notEqual(canon(J('[{"__proto__":{"x":1}}]')), canon(J('[{"__proto__":{"x":2}}]')));
});

test('H deeply nested __proto__ survives, and I repeated nested objects stay distinct', () => {
  assert.equal(canon(J('{"a":{"b":{"c":{"__proto__":{"x":1}}}}}')), '{"a":{"b":{"c":{"__proto__":{"x":1}}}}}');
  assert.notEqual(canon(J('{"a":{"b":{"c":{"__proto__":{"x":1}}}}}')), canon(J('{"a":{"b":{"c":{"__proto__":{"x":2}}}}}')));
  assert.equal(canon(J('{"p":{"__proto__":{"x":1}},"q":{"__proto__":{"x":1}}}')), '{"p":{"__proto__":{"x":1}},"q":{"__proto__":{"x":1}}}');
  assert.notEqual(canon(J('{"p":{"__proto__":{"x":1}},"q":{"__proto__":{"x":1}}}')), canon(J('{"p":{"__proto__":{"x":1}},"q":{"__proto__":{"x":2}}}')));
});

test('O/P prototype handling: null-prototype objects serialize; inherited properties stay excluded', () => {
  assert.equal(canon(Object.assign(Object.create(null), { a: 1 })), '{"a":1}');
  assert.equal(canon(Object.create({ inherited: 1 })), '{}', 'inherited properties are not own keys');
  const child = Object.create({ inherited: 1 });
  child.own = 2;
  assert.equal(canon(child), '{"own":2}');
});

test('Q JSON.parse yields __proto__ as an own DATA key — the shape that reaches this code', () => {
  const parsed = J('{"__proto__":{"x":1},"a":1}');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), true);
  assert.equal(Object.keys(parsed).includes('__proto__'), true);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype, 'JSON.parse does not move the prototype');
  assert.equal(canon(parsed), '{"__proto__":{"x":1},"a":1}');
});

test('REGRESSION: bytes are unchanged for every input carrying no own __proto__ key', () => {
  // Hand-written expectations. If the repair had altered ordinary canonicalization, previously
  // computed digests would stop reproducing and every prior authority would be invalidated.
  const fixed = [
    ['{}', '{}'],
    ['{"a":1}', '{"a":1}'],
    ['{"b":1,"a":2}', '{"a":2,"b":1}'],
    ['{"a":null}', '{"a":null}'],
    ['{"a":{"b":{"c":[1,2,{"d":3}]}}}', '{"a":{"b":{"c":[1,2,{"d":3}]}}}'],
    ['{"2":1,"10":2,"1":3}', '{"1":3,"2":1,"10":2}'],
    ['[]', '[]'],
    ['{"a":[]}', '{"a":[]}'],
    ['{"a":"","b":0,"c":false}', '{"a":"","b":0,"c":false}'],
    ['{"constructor":1,"toString":2}', '{"constructor":1,"toString":2}'],
  ];
  for (const [input, expected] of fixed) assert.equal(canon(J(input)), expected, input);
  assert.equal(canon({ a: 1, b: undefined }), '{"a":1}', 'undefined members are still dropped');
});

test('REGRESSION: the 27-field authority envelope is byte-identical under the repair', () => {
  const NP = require('./lib/np-authority.cjs');
  const a = {};
  for (const k of NP.REQUIRED) a[k] = k === 'real_authority' || k === 'production_validity' ? true : `v-${k}`;
  // Expectation derived by hand from the contract: all keys sorted, all values as set above.
  const expected = `{${NP.REQUIRED.slice()
    .sort()
    .map((k) => `${JSON.stringify(k)}:${k === 'real_authority' || k === 'production_validity' ? 'true' : JSON.stringify(`v-${k}`)}`)
    .join(',')}}`;
  assert.equal(canon(a), expected);
  assert.equal(signingBytes(a).toString('utf8'), canon(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'signature'))));
});

test('CONSEQUENCE: one signature can no longer cover two semantically distinct objects', () => {
  const crypto = require('node:crypto');
  const keys = crypto.generateKeyPairSync('ed25519'); // ephemeral, in memory, never written
  const withProto = J('{"authority_id":"A","allowed_channels":{"beta":1,"__proto__":{"escalate":true}}}');
  const without = J('{"authority_id":"A","allowed_channels":{"beta":1}}');
  assert.notEqual(canon(withProto), canon(without), 'the two objects must not canonicalize alike');
  assert.notEqual(H(signingBytes(withProto)), H(signingBytes(without)));
  const sig = crypto.sign(null, signingBytes(withProto), keys.privateKey);
  assert.equal(crypto.verify(null, signingBytes(withProto), keys.publicKey, sig), true);
  assert.equal(crypto.verify(null, signingBytes(without), keys.publicKey, sig), false, 'the v1-style collision must be gone');
});

test('SCOPE: canon() does not pollute Object.prototype, and did not before either', () => {
  canon(J('{"__proto__":{"NP101_POLLUTED":true}}'));
  canon(J('{"a":{"__proto__":{"NP101_POLLUTED":true}}}'));
  assert.equal({}.NP101_POLLUTED, undefined);
  assert.equal(Object.prototype.NP101_POLLUTED, undefined);
  // `constructor` and `prototype` are ordinary data keys here, not accessors: unchanged behaviour.
  assert.equal(canon(J('{"constructor":{"x":1}}')), '{"constructor":{"x":1}}');
  assert.equal(canon(J('{"prototype":{"x":1}}')), '{"prototype":{"x":1}}');
});

test('SCOPE: the existing depth and cycle guards are untouched', () => {
  let deep = {};
  const root = deep;
  for (let i = 0; i < 70; i += 1) {
    deep.n = {};
    deep = deep.n;
  }
  assert.throws(() => canon(root), /depth/);
  const cyc = { a: 1 };
  cyc.self = cyc;
  assert.throws(() => canon(cyc), /cycle/);
});
