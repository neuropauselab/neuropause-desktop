/**
 * ERP Session 66 — thin runner that drives the REAL canonical BackupManager (Electron-free,
 * fs-only). It imports the production class directly — no reimplementation of backup/restore.
 * Emits one JSON line (the last line) the harness parses.
 *
 *   node --import tsx s66BackupRunner.mjs <create|validate|restore> '<argsJson>'
 */
import { BackupManager } from '../src/main/backup/backupManager.ts';

const ACK = { boundary: 'ALL_TENANTS_AT_ONCE', declaredBy: 's66DisasterRecovery.e2e.cjs' };

function mgr(dataDir, backupsDir) {
  return new BackupManager({
    dataDir, backupsDir,
    appVersion: '1.0.0-rc.24',
    dataVersion: () => 1,
    now: () => Date.now(),
    restoreBoundary: ACK,
  });
}

const [op, argsJson] = process.argv.slice(2);
const a = JSON.parse(argsJson);

try {
  if (op === 'create') {
    const info = await mgr(a.dataDir, a.backupsDir).create('manual', ['business']);
    // read the manifest back for entry paths (BackupInfo shape varies; the manifest is on disk)
    const fs = await import('node:fs');
    const path = await import('node:path');
    const manifest = JSON.parse(fs.readFileSync(path.join(a.backupsDir, info.id, 'manifest.json'), 'utf8'));
    const paths = manifest.entries.map((e) => e.relativePath);
    console.log(JSON.stringify({ ok: true, id: info.id, entryCount: manifest.entries.length,
      businessEntryCount: manifest.entries.filter((e) => e.domain === 'business').length, entryPaths: paths }));
  } else if (op === 'validate') {
    const v = await mgr(a.dataDir ?? '/tmp', a.backupsDir).validate(a.id);
    console.log(JSON.stringify({ valid: v.valid, checked: v.checked, mismatched: v.mismatched, missing: v.missing }));
  } else if (op === 'restore') {
    const r = await mgr(a.dataDir, a.backupsDir).restore(a.id, ['business'], ACK);
    console.log(JSON.stringify({ ok: r.ok, restored: r.restored, skipped: r.skipped,
      requiresRestart: r.requiresRestart, safetyBackupId: r.safetyBackupId, detail: r.detail }));
  } else {
    console.log(JSON.stringify({ ok: false, detail: `unknown op ${op}` }));
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, detail: String(e && e.message || e) }));
}
