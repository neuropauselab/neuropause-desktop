/**
 * NP-B-023 correction — author/custody identity normalization (NPB023-DEF-02).
 *
 * THE DEFECT. The NP-B-022 / first NP-B-023 authorship detector matched the
 * literal `COMPUTER-A` (hyphen). The genuine A-authored transfer cover notes
 * write `COMPUTER_A` (underscore). One character; three real A-authored outbound
 * records were missed, and NP-B-022 wrongly reported OUTBOUND_RECORD_EXISTENCE =
 * NOT_ESTABLISHED. Any authorship/custody sweep must accept every semantically
 * equivalent spelling of ONE identity — and must NOT collapse two DIFFERENT
 * identities into one.
 *
 * THE RULE (recorded explicitly, per NP-GLOBAL-PUBLIC-LAUNCH-001 §26):
 *
 *   1. An identity token is the word COMPUTER (any letter case), ONE separator
 *      run drawn from `_`, `-`, or whitespace, and a single machine letter A or
 *      B (any case). `COMPUTER_A`, `COMPUTER-A`, `Computer A`, `computer-a`,
 *      `COMPUTER  A` are the SAME identity → canonical `COMPUTER_A`.
 *   2. The token must be WHOLE: it is not preceded and not followed by an
 *      identifier character ([A-Za-z0-9_]) or a hyphen joining another
 *      identifier character. `COMPUTER_A_VERIFIED`, `COMPUTER-A-CLEAN`,
 *      `NOT_COMPUTER_A` and `COMPUTER_AB` are DIFFERENT identifiers and are
 *      never normalized to `COMPUTER_A`. Meaningful distinctions survive.
 *   3. The machine letter is NEVER normalized across machines: `COMPUTER_A`
 *      and `COMPUTER_B` remain distinct. The letter form with no separator
 *      (`COMPUTERA`) is NOT accepted — it is not an observed spelling and
 *      accepting it would widen the match without evidence.
 *   4. Declaration parsing (`AUTHORED_BY`, `MEASURED_ON`, `CUSTODY`, `MACHINE`)
 *      accepts `KEY: VALUE`, `KEY VALUE`, `KEY=VALUE`, optional backticks, and
 *      Markdown emphasis around the key.
 *
 * Pure Node, zero dependencies, so it is runnable from any custody:
 *   node authorship-normalize.cjs <file...>   → JSON report of identities found
 *   node --test authorship-normalize.test.cjs → regression suite
 */
'use strict';

const IDENTITY_RE = /(?<![A-Za-z0-9_])(?<!-)(computer)([_\-\s]+)([ab])(?![A-Za-z0-9_])(?!-[A-Za-z0-9_])/gi;

/** Canonical form of one raw token, or null when it is not an identity token. */
function normalizeIdentity(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(computer)([_\-\s]+)([ab])$/i.exec(raw.trim());
  if (!m) return null;
  return `COMPUTER_${m[3].toUpperCase()}`;
}

/** Every identity mention in a text with its offset, raw spelling and canonical form. */
function findIdentities(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  const re = new RegExp(IDENTITY_RE.source, IDENTITY_RE.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, raw: m[0], canonical: `COMPUTER_${m[3].toUpperCase()}` });
  }
  return out;
}

const DECLARATION_KEYS = ['AUTHORED_BY', 'MEASURED_ON', 'CUSTODY', 'MACHINE', 'INDEPENDENTLY_VERIFIED_BY'];

/**
 * Parse `KEY: VALUE` style declarations. Returns { AUTHORED_BY: 'COMPUTER_A', ... }
 * with canonical identities where the value is an identity, else the raw value.
 */
function parseDeclarations(text) {
  const decl = {};
  if (typeof text !== 'string') return decl;
  for (const key of DECLARATION_KEYS) {
    // Key may be wrapped in backticks, quotes or Markdown emphasis; the value is a
    // CONSTANT (an identity token, or an upper-case word such as FALSE/TRUE/…),
    // never prose — "CUSTODY records" in a sentence is not a declaration.
    const re = new RegExp(
      `(?<![A-Za-z0-9_])[\`"'*_]*${key}[\`"'*_]*\\s*(?::|=|\\s)\\s*[\`"'*_]*((?:[Cc][Oo][Mm][Pp][Uu][Tt][Ee][Rr][_\\-\\s]+[AaBb])|[A-Z][A-Z0-9_\\-]{0,40})(?![A-Za-z0-9_])`,
    );
    const m = re.exec(text);
    if (m) {
      const raw = m[1].trim();
      decl[key] = normalizeIdentity(raw) ?? raw;
    }
  }
  return decl;
}

/** The OLD (defective) detector, kept ONLY as a regression fixture: hyphen-literal. */
function legacyHyphenOnlyDetector(text) {
  return /COMPUTER-A/.test(String(text));
}

function report(files) {
  const fs = require('node:fs');
  return files.map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return { file: f, declarations: parseDeclarations(text), identities: findIdentities(text) };
  });
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node authorship-normalize.cjs <file...>');
    process.exit(2);
  }
  console.log(JSON.stringify({ rule: 'NPB023-DEF-02 normalization v1', results: report(files) }, null, 2));
}

module.exports = { normalizeIdentity, findIdentities, parseDeclarations, legacyHyphenOnlyDetector, IDENTITY_RE, DECLARATION_KEYS };
