/**
 * Data Plane terminal check.
 *
 * Runs the REAL analysis engine (parse → classify → validate → dedup → plan)
 * against a file of your choosing and prints what NeuroPause would do with it.
 *
 * Read-only: `analyzeSource` writes nothing, touches no store, and needs no
 * running app or backend. It is the same code path the `dp:analyze` IPC channel
 * calls, so a green result here proves the engine on this machine.
 *
 *   npx tsx scripts/dataplane-check.ts /path/to/your.xlsx
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { analyzeSource } from '../apps/desktop/src/main/dataPlane/planner';

const target = process.argv[2];
if (!target) {
  console.error('Usage: npx tsx scripts/dataplane-check.ts <file.xlsx|csv|json|xml|docx|txt>');
  process.exit(1);
}

const buf = readFileSync(target);
const plan = analyzeSource(basename(target), buf);

console.log(`\nFile      : ${plan.sourceFile}`);
console.log(`Format    : ${plan.format}`);

if (plan.unsupportedReason) {
  console.log(`\nUNSUPPORTED: ${plan.unsupportedReason}`);
  console.log('(This is the honest refusal path — no fake extraction.)\n');
  process.exit(0);
}

console.log(
  `Totals    : ${plan.totals.rows} rows · ${plan.totals.importable} importable · ` +
    `${plan.totals.invalid} invalid · ${plan.totals.incomplete} incomplete · ${plan.totals.duplicates} duplicate`,
);
console.log(`Approval  : ${plan.requiresApproval ? 'REQUIRED (high-risk data present)' : 'not required'}`);

for (const t of plan.tables) {
  console.log(`\n── ${t.tableName} → ${t.entityLabel} (${t.domain} · ${t.moduleId})`);
  console.log(`   confidence ${(t.confidence * 100).toFixed(1)}% [${t.band}] · risk ${t.risk}` +
    `${t.requiresApproval ? ' · APPROVAL REQUIRED' : ''}`);
  console.log(`   ${t.importableRows} importable of ${t.report.totalRows}`);
  if (t.blockedReason) console.log(`   BLOCKED: ${t.blockedReason}`);
  for (const m of t.mappings) {
    const to = m.fieldKey ?? '(unmapped)';
    console.log(`     [${m.band.padEnd(6)}] ${m.header}  →  ${to}   ${m.reasons[0] ?? ''}`);
  }
  if (t.report.topIssues.length > 0) {
    console.log('   issues:');
    for (const i of t.report.topIssues) console.log(`     ${i.count}× ${i.message}`);
  }
  if (t.duplicates.length > 0) {
    console.log(`   duplicates: ${t.duplicates.length} (reported, never auto-merged)`);
    for (const d of t.duplicates.slice(0, 3)) console.log(`     row ${d.rowIndex + 1}: ${d.reason}`);
  }
}

for (const u of plan.unclassified) {
  console.log(`\n── ${u.tableName} → UNCLASSIFIED (${u.rowCount} rows)`);
  console.log(`   ${u.reason}`);
}

for (const w of plan.warnings) console.log(`\nwarning: ${w}`);
console.log('\nNothing was written. This was analysis only.\n');
