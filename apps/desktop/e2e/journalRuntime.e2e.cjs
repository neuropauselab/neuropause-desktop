#!/usr/bin/env node
/**
 * SEAM-B.10 / GATE-R.4 — RUNTIME EXECUTION harness for the governed journal post.
 *
 * Launches the ALTERNATE release build (out-seam-b10 — NEVER the armed out/)
 * on a fresh temporary --user-data-dir and drives the REAL renderer-IPC door
 * (`window.neuropause.invoke`, the brainPropose.e2e.cjs precedent) through the
 * production composition: secure bridge → moduleRegistry action handler →
 * runAction('post') → governedJournalPost → CST kernel → CAS write → evidence.
 *
 * ZERO external effects: local-only journal mutation inside the temp profile.
 *
 * Runbook (from apps/desktop):
 *   env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-b10"
 *   NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/journalRuntime.e2e.cjs --phase=1
 *   NODE_PATH=... node e2e/journalRuntime.e2e.cjs --phase=2 --profile=<dir printed by phase 1>
 *
 * Phase 1: fresh profile — composition logs, isolation, Test A (governed
 *          success), Test C (door replay), Test E (two concurrent posts).
 * Phase 2: SAME profile relaunched — Test H (restart persistence), Test I
 *          (replay after restart stays refused, no second write).
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-b10/main/index.js');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : [a, true])),
);
const PHASE = String(args.phase ?? '1');

function out(key, value) {
  console.log(`B10 ${key} = ${JSON.stringify(value)}`);
}
function fail(msg) {
  console.error(`B10 FAIL: ${msg}`);
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

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} — build it first (never out/)`);

  const profile =
    PHASE === '1'
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'np-b10-runtime-'))
      : String(args.profile ?? fail('--profile required for phase 2'));
  const stateFile = `${profile}.state.json`;
  out('PROFILE', profile);
  out('MAIN', ALT_MAIN);

  const logs = [];
  const app = await electron.launch({
    args: [ALT_MAIN, `--user-data-dir=${profile}`],
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '', NEUROPAUSE_E2E: '' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));

  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => /working locally/i.test(document.body.innerText), { timeout: 45_000 });
    out('LOCAL_SHELL', true);

    // §16 — userData isolation, asked of the RUNNING app itself. Compare
    // REALPATHS: macOS /var/folders is a symlink to /private/var/folders.
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), `ISOLATED_USERDATA (${userData})`);

    // §19 — composition assertion from runtime boot logs (not source inference).
    // 'Owner bound…' logs only when a CLAIM happens — first boot only; on a
    // phase-2 relaunch the owner row is already claimed, so it is not expected.
    for (const re of [
      /Enterprise OS ready/,
      ...(PHASE === '1' ? [/Owner bound to the active principal/] : []),
      /Runtime core ready/,
      /Background services started/,
      /Read-back reconciler started/,
    ]) {
      assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
    }

    // The real door, with a cold-start retry (secure handlers register late).
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
      // Setup through the SAME production door: two accounts + a draft.
      for (const [code, name, cls] of [['1000', 'Cash', 'asset'], ['4000', 'Revenue', 'revenue']]) {
        const r = await bridge('enterprise:module.create', {
          moduleId: 'finance-ledger-accounts',
          fields: { code, name, class: cls, currency: 'USD' },
        });
        assert(r && r.ok === true, `account ${code} created`);
        out(`ACCOUNT_${code}`, { tenantId: r.record.tenantId, workspaceId: r.record.workspaceId });
      }
      const created = await bridge('enterprise:module.create', {
        moduleId: 'finance-journal-entries',
        fields: {
          entryNumber: 'JE-B10-01',
          memo: 'seam-b10 runtime probe',
          lines: '[{"account":"1000","debit":100,"credit":0},{"account":"4000","debit":0,"credit":100}]',
        },
      });
      assert(created && created.ok === true, 'draft JE-B10-01 created');
      const id1 = created.record.id;
      assert(created.record.rev === 1, `draft rev 1 (got ${created.record.rev})`);
      assert(String(created.record.fields.status) === 'draft', 'draft status');
      out('DRAFT', { id: id1, rev: created.record.rev, workspaceId: created.record.workspaceId });

      // TEST A — governed success through the real runtime.
      const posted = await bridge('enterprise:module.action', {
        moduleId: 'finance-journal-entries', id: id1, action: 'post',
      });
      out('TEST_A_RESULT', posted);
      assert(posted && posted.ok === true, 'TEST A: post ok');
      assert(posted.message === 'Journal entry JE-B10-01 posted (balanced 100).', `TEST A: message (${posted.message})`);
      const row1 = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: id1 });
      assert(String(row1.fields.status) === 'posted', 'TEST A: row posted');
      assert(String(row1.fields.postedAt ?? '') !== '', 'TEST A: postedAt stamped');
      assert(row1.rev === 2, `TEST A: rev advanced exactly once (got ${row1.rev})`);
      out('TEST_A_ROW', { rev: row1.rev, postedAt: row1.fields.postedAt });

      // TEST C — door replay: no second effect, no new kernel run needed.
      const again = await bridge('enterprise:module.action', {
        moduleId: 'finance-journal-entries', id: id1, action: 'post',
      });
      out('TEST_C_RESULT', again);
      assert(again && again.ok === false && again.message === 'JE-B10-01 is already posted.', 'TEST C: replay refused');
      const row1b = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: id1 });
      assert(row1b.rev === 2, 'TEST C: rev unchanged');

      // TEST E — two truly concurrent posts of one draft (single renderer turn).
      const created2 = await bridge('enterprise:module.create', {
        moduleId: 'finance-journal-entries',
        fields: {
          entryNumber: 'JE-B10-02',
          memo: 'seam-b10 concurrency probe',
          lines: '[{"account":"1000","debit":50,"credit":0},{"account":"4000","debit":0,"credit":50}]',
        },
      });
      assert(created2 && created2.ok === true, 'draft JE-B10-02 created');
      const id2 = created2.record.id;
      const pair = await win.evaluate(async ([c, p]) => {
        const settle = (q) => window.neuropause.invoke(c, q).then((v) => ({ v }), (e) => ({ e: String(e) }));
        return Promise.all([settle(p), settle(p)]);
      }, ['enterprise:module.action', { moduleId: 'finance-journal-entries', id: id2, action: 'post' }]);
      out('TEST_E_RESULTS', pair);
      const row2 = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: id2 });
      assert(String(row2.fields.status) === 'posted', 'TEST E: row posted');
      assert(row2.rev === 2, `TEST E: rev advanced EXACTLY once (got ${row2.rev})`);
      const oks = pair.filter((r) => r.v && r.v.ok === true).length;
      assert(oks >= 1, 'TEST E: at least one attempt reported success');
      out('TEST_E_OK_COUNT', oks);

      fs.writeFileSync(stateFile, JSON.stringify({ id1, id2, postedAt: row1.fields.postedAt }));
      out('STATE_FILE', stateFile);
    } else {
      // PHASE 2 — restart proofs on the SAME profile.
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      // TEST H — the posted state and evidence survive the process boundary.
      const row1 = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: state.id1 });
      assert(String(row1.fields.status) === 'posted', 'TEST H: still posted after restart');
      assert(row1.rev === 2, 'TEST H: rev still 2');
      assert(String(row1.fields.postedAt) === String(state.postedAt), 'TEST H: postedAt identical');

      // TEST I — replay after restart: refused, no second write.
      const again = await bridge('enterprise:module.action', {
        moduleId: 'finance-journal-entries', id: state.id1, action: 'post',
      });
      out('TEST_I_RESULT', again);
      assert(again && again.ok === false && again.message === 'JE-B10-01 is already posted.', 'TEST I: replay refused after restart');
      const row1b = await bridge('enterprise:module.get', { moduleId: 'finance-journal-entries', id: state.id1 });
      assert(row1b.rev === 2, 'TEST I: rev unchanged after restart replay');
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
