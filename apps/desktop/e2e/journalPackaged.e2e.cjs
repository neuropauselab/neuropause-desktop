#!/usr/bin/env node
/**
 * SEAM-B.13 / GATE-R.7 — PACKAGED-ARTIFACT acceptance harness.
 *
 * Launches the ACTUAL PACKAGED application (the electron-builder .app from
 * dist-seam-b13 — not out/, not the alternate electron-vite build) on a fresh
 * temporary --user-data-dir and drives the REAL renderer-IPC door, mirroring
 * the B.10 journalRuntime.e2e.cjs pattern.
 *
 * ZERO external effects: local-only journal mutations inside the temp profile.
 *
 * Usage (from apps/desktop):
 *   NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/journalPackaged.e2e.cjs --phase=1
 *   ... --phase=2 --profile=<dir from phase 1>     (restart + replay-after-restart)
 *   ... --phase=3 --profile=<dir>                  (§33 corrupted-ledger boot measurement)
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const APP_BIN = path.join(
  APP_DIR,
  'dist-seam-b13/mac-arm64/NeuroPause.app/Contents/MacOS/NeuroPause',
);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : [a, true])),
);
const PHASE = String(args.phase ?? '1');

function out(key, value) {
  console.log(`B13 ${key} = ${JSON.stringify(value)}`);
}
function fail(msg) {
  console.error(`B13 FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
  out('PASS', msg);
}
async function waitForLog(logs, re, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (re.test(logs.join(''))) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function launchPackaged(profile, logs) {
  const app = await electron.launch({
    executablePath: APP_BIN,
    args: [`--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  return app;
}

async function main() {
  if (!fs.existsSync(APP_BIN)) fail(`packaged app missing: ${APP_BIN}`);

  const profile =
    PHASE === '1'
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'np-b13-packaged-'))
      : String(args.profile ?? fail('--profile required'));
  const stateFile = `${profile}.state.json`;
  out('PROFILE', profile);
  out('APP_BIN', APP_BIN);

  const ledger = path.join(profile, 'journal-post-transitions.json');

  if (PHASE === '3') {
    // §33 TEST K — corrupted durable ledger on an ISOLATED profile only.
    assert(fs.existsSync(ledger), 'ledger exists before corruption');
    const backup = fs.readFileSync(ledger);
    fs.writeFileSync(ledger, '{"version":1,"records":{"x":OOPS');
    const logs = [];
    let launched = false;
    let errText = '';
    try {
      const app = await launchPackaged(profile, logs);
      // If we got here, wait briefly for a window — the expectation is failure.
      try {
        await app.firstWindow({ timeout: 20_000 });
        launched = true;
      } catch (e) {
        errText = String(e);
      }
      await app.close().catch(() => {});
    } catch (e) {
      errText = String(e);
    }
    out('K_LAUNCHED_WITH_CORRUPT_LEDGER', launched);
    out('K_ERROR_EXCERPT', (errText + logs.join('')).slice(0, 600));
    assert(!launched, 'TEST K: corrupt ledger prevents packaged boot (fail-closed, whole-app blast radius)');
    // Restore and prove recovery — the corruption was the only cause.
    fs.writeFileSync(ledger, backup);
    const logs2 = [];
    const app2 = await launchPackaged(profile, logs2);
    const win2 = await app2.firstWindow({ timeout: 45_000 });
    await win2.waitForLoadState('domcontentloaded');
    assert(true, 'TEST K: restore recovers boot');
    await app2.close().catch(() => {});
    out('PHASE_DONE', PHASE);
    return;
  }

  const logs = [];
  const app = await launchPackaged(profile, logs);

  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => /working locally/i.test(document.body.innerText), { timeout: 45_000 });
    out('LOCAL_SHELL', true);

    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), `ISOLATED_USERDATA (${userData})`);
    const isPackaged = await app.evaluate(({ app: a }) => a.isPackaged);
    assert(isPackaged === true, 'app.isPackaged === true (the PACKAGED artifact, not a dev launch)');

    for (const re of [
      /Enterprise OS ready/,
      ...(PHASE === '1' ? [/Owner bound to the active principal/] : []),
      /Runtime core ready/,
      /Background services started/,
      /Read-back reconciler started/,
    ]) {
      assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
    }

    const bridge = async (ch, payload) => {
      for (let i = 0; ; i++) {
        try {
          return await win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
        } catch (e) {
          if (i < 5 && /No handler registered/.test(String(e))) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw e;
        }
      }
    };

    if (PHASE === '1') {
      for (const [code, name, cls] of [['1000', 'Cash', 'asset'], ['4000', 'Revenue', 'revenue']]) {
        const r = await bridge('enterprise:module.create', {
          moduleId: 'finance-ledger-accounts',
          fields: { code, name, class: cls, currency: 'USD' },
        });
        assert(r && r.ok === true, `account ${code} created`);
      }
      const created = await bridge('enterprise:module.create', {
        moduleId: 'finance-journal-entries',
        fields: {
          entryNumber: 'JE-B13-01',
          memo: 'seam-b13 packaged probe',
          lines: '[{"account":"1000","debit":100,"credit":0},{"account":"4000","debit":0,"credit":100}]',
        },
      });
      assert(created && created.ok === true, 'draft JE-B13-01 created');
      const id1 = created.record.id;
      assert(created.record.rev === 1, 'draft rev 1');
      out('DRAFT', { id: id1, workspaceId: created.record.workspaceId });

      // TEST A — packaged governed success.
      const posted = await bridge('enterprise:module.action', {
        moduleId: 'finance-journal-entries', id: id1, action: 'post',
      });
      out('TEST_A_RESULT', posted);
      assert(posted && posted.ok === true, 'TEST A: post ok');
      assert(posted.message === 'Journal entry JE-B13-01 posted (balanced 100).', `TEST A: message (${posted.message})`);
      const row1 = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: id1 });
      assert(String(row1.fields.status) === 'posted', 'TEST A: posted');
      assert(String(row1.fields.postedAt ?? '') !== '', 'TEST A: postedAt stamped');
      assert(row1.rev === 2, `TEST A: rev advanced exactly once (${row1.rev})`);
      out('TEST_A_ROW', { rev: row1.rev, postedAt: row1.fields.postedAt });

      // TEST C — replay through the packaged door.
      const again = await bridge('enterprise:module.action', {
        moduleId: 'finance-journal-entries', id: id1, action: 'post',
      });
      assert(again && again.ok === false && again.message === 'JE-B13-01 is already posted.', 'TEST C: replay refused');
      assert((await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: id1 })).rev === 2, 'TEST C: rev unchanged');

      // TEST E — two truly concurrent posts.
      const created2 = await bridge('enterprise:module.create', {
        moduleId: 'finance-journal-entries',
        fields: {
          entryNumber: 'JE-B13-02',
          memo: 'seam-b13 concurrency probe',
          lines: '[{"account":"1000","debit":50,"credit":0},{"account":"4000","debit":0,"credit":50}]',
        },
      });
      assert(created2 && created2.ok === true, 'draft JE-B13-02 created');
      const id2 = created2.record.id;
      const pair = await win.evaluate(async ([c, p]) => {
        const settle = (q) => window.neuropause.invoke(c, q).then((v) => ({ v }), (e) => ({ e: String(e) }));
        return Promise.all([settle(p), settle(p)]);
      }, ['enterprise:module.action', { moduleId: 'finance-journal-entries', id: id2, action: 'post' }]);
      out('TEST_E_RESULTS', pair);
      const row2 = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: id2 });
      assert(String(row2.fields.status) === 'posted', 'TEST E: posted');
      assert(row2.rev === 2, `TEST E: rev advanced EXACTLY once (${row2.rev})`);
      assert(pair.filter((r) => r.v && r.v.ok === true).length >= 1, 'TEST E: at least one success');

      fs.writeFileSync(stateFile, JSON.stringify({ id1, id2, postedAt: row1.fields.postedAt }));
      out('STATE_FILE', stateFile);
    } else {
      // PHASE 2 — TESTS I (restart persistence) + J (replay after restart).
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const row1 = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: state.id1 });
      assert(String(row1.fields.status) === 'posted', 'TEST I: still posted after restart');
      assert(row1.rev === 2, 'TEST I: rev still 2');
      assert(String(row1.fields.postedAt) === String(state.postedAt), 'TEST I: postedAt byte-identical');
      const again = await bridge('enterprise:module.action', {
        moduleId: 'finance-journal-entries', id: state.id1, action: 'post',
      });
      assert(again && again.ok === false && again.message === 'JE-B13-01 is already posted.', 'TEST J: replay refused after restart');
      assert((await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: state.id1 })).rev === 2, 'TEST J: rev unchanged');
    }

    out('PHASE_DONE', PHASE);
  } finally {
    await app.close().catch(() => {});
  }
}

main().then(
  () => out('EXIT', 'ok'),
  (e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exitCode = 1;
  },
);
