#!/usr/bin/env node
/**
 * Documentation validator (Phase 4 · Product Enablement).
 *
 * Validates the Phase-4 documentation set enumerated in
 * docs/downloads/DOCUMENT-MANIFEST.json. It checks the things that silently rot:
 *
 *   1. Every manifested file exists.
 *   2. Markdown docs marked headerRequired carry the current metadata header
 *      markers ("NeuroPause Global Product RC" + the current build "1.0.0-rc.15").
 *   3. No STALE build marker (any 1.0.0-rc.N where N != current) in those docs.
 *   4. No forbidden / renamed-surface terms leak into user-facing docs.
 *   5. Relative Markdown links resolve to a real file on disk.
 *   6. JSON docs parse and carry the current build string (non-stale).
 *
 * Fenced code blocks are stripped before link/term scanning so Mermaid arrows
 * and shell samples never produce false positives.
 *
 * Usage:
 *   node scripts/docs-validate.cjs
 *   npm run docs:validate
 *
 * Exit code 0 when clean, 1 when any error is found. Honest by design: it
 * reports what is actually wrong and never "passes" by lowering the bar.
 */
const { readFileSync, existsSync } = require('node:fs');
const { join, dirname, resolve, relative } = require('node:path');

const ROOT = join(__dirname, '..');
const MANIFEST = join(ROOT, 'docs/downloads/DOCUMENT-MANIFEST.json');

function readManifest() {
  if (!existsSync(MANIFEST)) {
    console.error(`FATAL: manifest not found at ${relative(ROOT, MANIFEST)}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    console.error(`FATAL: manifest is not valid JSON — ${err.message}`);
    process.exit(1);
  }
}

/** Remove fenced code blocks so their contents are not scanned for links/terms. */
function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** Remove inline code spans (for link extraction only). */
function stripInlineCode(text) {
  return text.replace(/`[^`]*`/g, '');
}

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const RC_RE = /1\.0\.0-rc\.(\d+)/g;

function checkDoc(doc, manifest, errors) {
  const rel = doc.path;
  const abs = join(ROOT, rel);
  const issues = [];

  if (!existsSync(abs)) {
    issues.push('file does not exist');
    errors.push({ rel, issues });
    return { rel, ok: false, issues };
  }

  const raw = readFileSync(abs, 'utf8');
  const currentBuild = manifest.productBuild; // e.g. "1.0.0-rc.15"
  const currentN = Number((currentBuild.match(/rc\.(\d+)/) || [])[1]);

  if (doc.format === 'json') {
    try {
      JSON.parse(raw);
    } catch (err) {
      issues.push(`invalid JSON — ${err.message}`);
    }
    if (!raw.includes(currentBuild)) {
      issues.push(`missing current build marker "${currentBuild}"`);
    }
  } else {
    const scan = stripFences(raw);

    // 2 + 3: header markers + stale version
    if (doc.headerRequired) {
      const head = raw.slice(0, 1200);
      for (const marker of manifest.expectedHeaderMarkers) {
        if (!head.includes(marker)) issues.push(`header missing marker "${marker}"`);
      }
    }
    let m;
    RC_RE.lastIndex = 0;
    const stale = new Set();
    while ((m = RC_RE.exec(scan)) !== null) {
      if (Number(m[1]) !== currentN) stale.add(m[0]);
    }
    if (stale.size) issues.push(`stale build marker(s): ${[...stale].join(', ')} (current ${currentBuild})`);

    // 4: forbidden terms
    for (const term of manifest.forbiddenTerms || []) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (re.test(scan)) issues.push(`forbidden term present: "${term}"`);
    }

    // 5: relative link resolution
    const linkText = stripInlineCode(stripFences(raw));
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(linkText)) !== null) {
      let target = m[1].trim();
      if (/^(https?:|mailto:|tel:|#|data:|computer:)/i.test(target)) continue;
      target = target.split('#')[0];
      if (!target) continue;
      const resolved = resolve(dirname(abs), target);
      if (!existsSync(resolved)) {
        issues.push(`broken link → ${m[1]} (resolves to ${relative(ROOT, resolved)})`);
      }
    }
  }

  const ok = issues.length === 0;
  if (!ok) errors.push({ rel, issues });
  return { rel, ok, issues };
}

function main() {
  const manifest = readManifest();
  const docs = manifest.documents || [];
  console.log(`NeuroPause docs validation — ${docs.length} documents (build ${manifest.productBuild})\n`);

  const errors = [];
  let okCount = 0;
  for (const doc of docs) {
    const res = checkDoc(doc, manifest, errors);
    if (res.ok) {
      okCount += 1;
      console.log(`  ok   ${res.rel}`);
    } else {
      console.log(`  FAIL ${res.rel}`);
      for (const i of res.issues) console.log(`         - ${i}`);
    }
  }

  // Operator/legacy documents: lighter coverage — existence + forbidden-terms only.
  // These predate the RC header, may cite historical versions, and reference code
  // paths/ids; we govern them for current-terminology, not header/stale/links.
  const opDocs = manifest.operatorDocuments || [];
  if (opDocs.length) console.log(`\nOperator/legacy documents (terminology coverage): ${opDocs.length}`);
  for (const doc of opDocs) {
    const abs = join(ROOT, doc.path);
    const issues = [];
    if (!existsSync(abs)) {
      issues.push('file does not exist');
    } else {
      const scan = stripFences(readFileSync(abs, 'utf8'));
      for (const term of manifest.forbiddenTerms || []) {
        const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (re.test(scan)) issues.push(`forbidden term present: "${term}"`);
      }
    }
    if (issues.length) {
      errors.push({ rel: doc.path, issues });
      console.log(`  FAIL ${doc.path}`);
      for (const i of issues) console.log(`         - ${i}`);
    } else {
      okCount += 1;
      console.log(`  ok   ${doc.path}`);
    }
  }

  const total = docs.length + opDocs.length;
  const errCount = errors.reduce((n, e) => n + e.issues.length, 0);
  console.log(`\nSummary: ${okCount}/${total} clean · ${errors.length} file(s) with ${errCount} issue(s)`);
  if (errors.length) {
    console.error('\nDocumentation validation FAILED.');
    process.exit(1);
  }
  console.log('Documentation validation passed.');
}

main();
