/**
 * Regression suite for NPB023-DEF-02. Run: node --test certification/public-launch/tools/
 *
 * The suite must (a) prove the hyphen/underscore/space spellings of ONE identity are
 * equivalent, (b) prove DIFFERENT identities are never collapsed, (c) prove the old
 * hyphen-only detector misses the real notes while the new rule catches them, and
 * (d) run as a positive control against the three genuine A-authored cover notes
 * when they are present on this machine (skipped, not passed, when absent).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { normalizeIdentity, findIdentities, parseDeclarations, legacyHyphenOnlyDetector } = require('./authorship-normalize.cjs');

test('hyphen, underscore and space spellings of COMPUTER_A are one identity', () => {
  for (const raw of ['COMPUTER_A', 'COMPUTER-A', 'Computer A', 'computer-a', 'COMPUTER  A', 'computer_a', 'Computer_A']) {
    assert.equal(normalizeIdentity(raw), 'COMPUTER_A', raw);
  }
  for (const raw of ['COMPUTER_B', 'COMPUTER-B', 'Computer B', 'computer-b']) {
    assert.equal(normalizeIdentity(raw), 'COMPUTER_B', raw);
  }
});

test('the two machines are never collapsed into each other', () => {
  assert.notEqual(normalizeIdentity('COMPUTER_A'), normalizeIdentity('COMPUTER_B'));
  const found = findIdentities('AUTHORED_BY: COMPUTER_A · INDEPENDENTLY_VERIFIED_BY_B: FALSE · reviewed on COMPUTER-B');
  assert.deepEqual(found.map((f) => f.canonical), ['COMPUTER_A', 'COMPUTER_B']);
});

test('suffixed / prefixed / fused identifiers are DISTINCT and are not normalized away', () => {
  for (const raw of ['COMPUTER_A_VERIFIED', 'COMPUTER-A-CLEAN', 'NOT_COMPUTER_A', 'COMPUTER_AB', 'COMPUTERA', 'COMPUTER_A1', 'XCOMPUTER_A']) {
    assert.equal(normalizeIdentity(raw), null, `${raw} must not normalize`);
    assert.deepEqual(findIdentities(raw), [], `${raw} must not be found as a whole identity`);
  }
  // A whole identity immediately adjacent to a distinct identifier is still found only where it is whole.
  const text = 'COMPUTER_A_VERIFIED by COMPUTER_A after COMPUTER-A-CLEAN';
  const found = findIdentities(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, 'COMPUTER_A');
});

test('declaration parsing accepts the real cover-note syntaxes', () => {
  const variants = [
    '`AUTHORED_BY: COMPUTER_A` · `MEASURED_ON: COMPUTER_A` · `INDEPENDENTLY_VERIFIED_BY_B: FALSE`',
    '`AUTHORED_BY COMPUTER_A` · `MEASURED_ON COMPUTER_A` · `INDEPENDENTLY_VERIFIED_BY_B FALSE`',
    'AUTHORED_BY=COMPUTER-A\nMEASURED_ON=Computer A',
    '**AUTHORED_BY**: Computer-A',
  ];
  for (const v of variants) {
    const d = parseDeclarations(v);
    assert.equal(d.AUTHORED_BY, 'COMPUTER_A', v);
  }
  assert.equal(parseDeclarations('"MACHINE": "COMPUTER_B"').MACHINE, 'COMPUTER_B');
});

test('REGRESSION NPB023-DEF-02: the old hyphen-only detector misses the underscore notes; the new rule does not', () => {
  const noteLikeText = '`AUTHORED_BY: COMPUTER_A` · `MEASURED_ON: COMPUTER_A` · `INDEPENDENTLY_VERIFIED_BY_B: FALSE`';
  assert.equal(legacyHyphenOnlyDetector(noteLikeText), false, 'the defective detector must demonstrably miss');
  assert.equal(parseDeclarations(noteLikeText).AUTHORED_BY, 'COMPUTER_A');
  assert.ok(findIdentities(noteLikeText).some((f) => f.canonical === 'COMPUTER_A'));
});

test('negative control: text with no identity yields nothing and no declaration', () => {
  assert.deepEqual(findIdentities('The computer at home is fine. A and B are letters.'), []);
  assert.deepEqual(parseDeclarations('nothing declared here'), {});
});

const NOTES = [
  '/Users/saurabhpatel/Downloads/B-TRANSFER/READ-THIS-FIRST.md',
  '/Users/saurabhpatel/Downloads/B-TRANSFER-2/READ-THIS-FIRST.md',
  '/Users/saurabhpatel/Downloads/B-TRANSFER-G2/READ-THIS-FIRST.md',
];
const notesPresent = NOTES.every((p) => fs.existsSync(p));

test('POSITIVE CONTROL against the three genuine A-authored transfer notes (skipped when absent)', { skip: !notesPresent && 'cover notes not present on this host' }, () => {
  for (const p of NOTES) {
    const text = fs.readFileSync(p, 'utf8');
    const d = parseDeclarations(text);
    assert.equal(d.AUTHORED_BY, 'COMPUTER_A', p);
    assert.equal(d.MEASURED_ON, 'COMPUTER_A', p);
    assert.equal(legacyHyphenOnlyDetector(text), false, `${p}: the old detector still misses this note`);
  }
});
