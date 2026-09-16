#!/usr/bin/env node
/**
 * Packaged-runtime smoke test — PACKAGE → LOAD → INITIALIZE → READY.
 *
 * Launches the REAL packaged NeuroPause.app (extracted from the published ZIP or
 * DMG — never `electron .`, never `out/`), on a fresh isolated profile, and
 * measures from inside the running main process:
 *
 *   • app.isPackaged === true, app version, Electron/Node/arch, userData isolation
 *   • every production module the main bundle needs actually LOADS in the packaged
 *     process (require() executed inside the real main process — not a file check)
 *   • the first BrowserWindow appears, the renderer reaches readyState=complete,
 *     the visible first-run text is captured, renderer page errors are counted
 *   • a screenshot of the first-run screen is saved as evidence
 *   • the app quits cleanly on close (exit code recorded); crash detection
 *
 * Uses playwright-core (already a devDependency; the e2e suite uses the same
 * launcher). Zero network assumptions: if the backend is unreachable the app's
 * OWN user-visible state for that condition is what gets recorded.
 *
 * CLI: node scripts/packaged-smoke.cjs (--zip <file> | --dmg <file> | --app <NeuroPause.app>) [--out <dir>] [--timeout 90000] [--modules a,b,c]
 * Exit 1 when the app does not reach READY or a required module fails to load.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
function sha256(p) { return createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function run(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; }

/**
 * Default module set = the EXACT bare specifiers the packaged main/preload bundles
 * require (parsed from the asar itself), so the load census matches the real code
 * path rather than a hand-typed list. `--modules` overrides.
 */
function bundleSpecifiers(appPath) {
  try {
    const asar = require('@electron/asar');
    const asarPath = path.join(appPath, 'Contents/Resources/app.asar');
    const builtins = new Set(require('node:module').builtinModules.flatMap((m) => [m, `node:${m}`]));
    const out = new Set();
    for (const f of asar.listPackage(asarPath).filter((p) => /^\/out\/(main|preload)\/.*\.(c?js|mjs)$/.test(p))) {
      const src = asar.extractFile(asarPath, f.replace(/^\//, '')).toString('utf8');
      const re = /require\((?:"|')([^"'./][^"']*)(?:"|')\)/g; let m;
      while ((m = re.exec(src)) !== null) if (m[1] !== 'electron' && !builtins.has(m[1])) out.add(m[1]);
    }
    return [...out].sort();
  } catch (e) { return null; }
}
const OPTIONAL_PEERS = new Set(['bufferutil', 'utf-8-validate']); // ws optional natives — absent by design

async function main() {
  const zip = arg('zip'); const dmg = arg('dmg'); const appArg = arg('app');
  const out = path.resolve(arg('out', 'dist/verification'));
  const timeout = Number(arg('timeout', '90000'));
  let modules = arg('modules') ? String(arg('modules')).split(',').filter(Boolean) : null;
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-smoke-'));
  const report = { test: 'packaged-smoke', started_at: new Date().toISOString(), source: null, checks: [] };
  const add = (ok, label, detail) => report.checks.push({ ok, label, detail: detail ?? null });

  let appPath = null;
  if (appArg) { appPath = path.resolve(appArg); report.source = { kind: 'app', path: appPath }; }
  else if (zip) {
    const zdir = path.join(tmp, 'zip'); fs.mkdirSync(zdir);
    const r = run('ditto', ['-x', '-k', path.resolve(zip), zdir]);
    add(r.code === 0, 'zip extracted', r.stderr.trim());
    appPath = path.join(zdir, 'NeuroPause.app');
    report.source = { kind: 'zip', path: path.resolve(zip), sha256: sha256(path.resolve(zip)) };
  } else if (dmg) {
    const mnt = path.join(tmp, 'mnt'); fs.mkdirSync(mnt);
    const r = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, path.resolve(dmg)]);
    add(r.code === 0, 'dmg mounted', r.stderr.trim().slice(-200));
    const ddir = path.join(tmp, 'dmg'); fs.mkdirSync(ddir);
    const c = run('ditto', [path.join(mnt, 'NeuroPause.app'), path.join(ddir, 'NeuroPause.app')]);
    run('hdiutil', ['detach', mnt, '-force']);
    add(c.code === 0, 'app copied out of dmg', c.stderr.trim());
    appPath = path.join(ddir, 'NeuroPause.app');
    report.source = { kind: 'dmg', path: path.resolve(dmg), sha256: sha256(path.resolve(dmg)) };
  } else { console.error('need --zip, --dmg or --app'); process.exit(2); }

  const bin = path.join(appPath, 'Contents/MacOS/NeuroPause');
  add(fs.existsSync(bin), 'main executable present', bin);
  if (!modules) {
    const specs = bundleSpecifiers(appPath);
    modules = (specs || []).filter((s) => !OPTIONAL_PEERS.has(s.split('/')[0]));
    report.module_source = specs ? `parsed ${specs.length} bare specifiers from the asar main/preload bundles` : 'asar parse failed';
    add(!!specs && specs.length > 0, 'bare specifiers parsed from the packaged bundles', modules.join(', '));
  } else report.module_source = '--modules argument';
  if (!fs.existsSync(bin)) return finish(1);
  report.executable_sha256 = sha256(bin);
  const quarantine = run('xattr', ['-p', 'com.apple.quarantine', appPath]);
  report.quarantine_xattr_present = quarantine.code === 0;
  add(true, 'quarantine attribute state (Gatekeeper applies only to quarantined bytes)', quarantine.code === 0 ? 'PRESENT' : 'ABSENT (locally produced bytes; Gatekeeper verdict measured separately by spctl)');

  const { _electron: electron } = require('playwright-core');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-smoke-profile-'));
  const logs = [];
  const t0 = Date.now();
  let app;
  try {
    app = await electron.launch({
      executablePath: bin,
      args: [`--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', NEUROPAUSE_E2E_VERIFY: '' },
      timeout,
    });
  } catch (e) {
    add(false, 'packaged app launched (playwright electron.launch)', String(e && e.message).slice(0, 500));
    return finish(1);
  }
  add(true, 'packaged app launched (playwright electron.launch)', `${Date.now() - t0} ms to launch`);
  const proc = app.process();
  proc.stdout.on('data', (d) => logs.push(String(d)));
  proc.stderr.on('data', (d) => logs.push(String(d)));
  let exitInfo = null;
  proc.on('exit', (code, signal) => { exitInfo = { code, signal, at: Date.now() - t0 }; });

  try {
    const info = await app.evaluate(({ app: a }) => ({
      isPackaged: a.isPackaged, version: a.getVersion(), name: a.getName(), userData: a.getPath('userData'), appPath: a.getAppPath(),
      ready: a.isReady(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, arch: process.arch, platform: process.platform, execPath: process.execPath,
    }));
    report.main_process = info;
    add(info.isPackaged === true, 'app.isPackaged === true (real packaged artifact)', String(info.isPackaged));
    add(info.ready === true, 'app.isReady()', String(info.ready));
    add(fs.realpathSync(info.userData) === fs.realpathSync(profile), 'userData isolated to the fresh profile', info.userData);
    add(/app\.asar$/.test(info.appPath), 'main process runs from app.asar', info.appPath);
    report.main_started_ms = Date.now() - t0;

    // Module-load census INSIDE the packaged main process. The evaluate sandbox may
    // not expose a bare `require`; fall back to the main module's loader.
    const loads = await app.evaluate((_electron, mods) => {
      const req = (typeof require === 'function' && require) || (process.mainModule && process.mainModule.require && process.mainModule.require.bind(process.mainModule)) || null;
      if (!req) return { mechanism: null, results: mods.map((m) => ({ module: m, load_status: 'NOT_MEASURED', error: 'no require available in evaluate context' })) };
      const mechanism = typeof require === 'function' ? 'require' : 'process.mainModule.require';
      return { mechanism, results: mods.map((m) => { try { const v = req(m); return { module: m, load_status: 'PASS', resolution: (() => { try { return req.resolve(m); } catch { return null; } })(), export_type: typeof v }; } catch (e) { return { module: m, load_status: 'FAIL', error: String(e && e.message).slice(0, 200) }; } }) };
    }, modules);
    report.module_loads = loads;
    const failed = loads.results.filter((r) => r.load_status === 'FAIL');
    const unmeasured = loads.results.filter((r) => r.load_status === 'NOT_MEASURED');
    add(failed.length === 0 && unmeasured.length === 0, `production modules load inside the packaged main process (${loads.mechanism || 'no mechanism'})`, failed.length ? failed.map((f) => `${f.module}: ${f.error}`).join('; ') : unmeasured.length ? 'NOT_MEASURED' : `${loads.results.length}/${loads.results.length} loaded`);

    const win = await app.firstWindow({ timeout });
    add(!!win, 'first BrowserWindow appeared', `${Date.now() - t0} ms`);
    const pageErrors = [];
    win.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 300)));
    const consoleErrors = [];
    win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    await win.waitForLoadState('domcontentloaded', { timeout });
    await win.waitForFunction(() => document.readyState === 'complete', null, { timeout });
    await new Promise((r) => setTimeout(r, 4000)); // let the renderer settle and the first backend/health probes resolve
    const title = await win.title();
    const url = win.url();
    const text = await win.evaluate(() => (document.body && document.body.innerText ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 3000));
    report.renderer = { title, url, visible_text_excerpt: text, page_errors: pageErrors, console_errors: consoleErrors.slice(0, 20), ready_ms: Date.now() - t0 };
    add(/^file:.*index\.html/.test(url) || /^app:/.test(url), 'renderer loaded from the packaged bundle', url);
    add(text.length > 0, 'renderer rendered visible text', text.slice(0, 160));
    add(pageErrors.length === 0, 'no uncaught renderer page errors', pageErrors.slice(0, 3).join(' | ') || 'none');
    const shot = path.join(out, 'packaged-smoke-first-run.png');
    await win.screenshot({ path: shot, fullPage: false });
    report.screenshot = { path: shot, sha256: sha256(shot) };
    add(true, 'first-run screenshot captured', shot);
  } catch (e) {
    add(false, 'runtime measurement completed', String(e && e.message).slice(0, 500));
  }

  try {
    // macOS keeps the process alive after the last window closes (window-all-closed
    // is a no-op on darwin), so a plain app.close() never ends the process. Quit
    // through the app's own path so before-quit / shutdown-flush barriers run.
    await app.evaluate(({ app: a }) => { setTimeout(() => a.quit(), 100); });
    const exited = new Promise((res) => { const t = setInterval(() => { if (exitInfo) { clearInterval(t); res(true); } }, 200); setTimeout(() => { clearInterval(t); res(false); }, 30000); });
    const didExit = await exited;
    if (!didExit) { try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]); } catch { /* ignore */ } }
    await new Promise((r) => setTimeout(r, 1000));
    add(exitInfo !== null, 'process exited after app.close()', exitInfo ? `code=${exitInfo.code} signal=${exitInfo.signal}` : 'still running (killed)');
    if (exitInfo) add(exitInfo.code === 0 || exitInfo.signal === 'SIGTERM', 'clean exit code', `code=${exitInfo.code} signal=${exitInfo.signal}`);
  } catch (e) {
    add(false, 'app closed cleanly', String(e && e.message));
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  }
  report.process_exit = exitInfo;
  const logText = logs.join('');
  report.log_bytes = logText.length;
  report.log_sha256 = createHash('sha256').update(logText).digest('hex');
  report.log_signals = {
    module_not_found: (logText.match(/MODULE_NOT_FOUND|Cannot find module/g) || []).length,
    uncaught: (logText.match(/Uncaught|UnhandledPromiseRejection/g) || []).length,
    crash: (logText.match(/crash|SIGSEGV|SIGABRT/gi) || []).length,
  };
  add(report.log_signals.module_not_found === 0, 'no MODULE_NOT_FOUND in process output', String(report.log_signals.module_not_found));
  add(report.log_signals.uncaught === 0, 'no uncaught exception / unhandled rejection in process output', String(report.log_signals.uncaught));
  fs.writeFileSync(path.join(out, 'packaged-smoke.log'), logText);
  return finish(report.checks.every((c) => c.ok) ? 0 : 1);

  function finish(code) {
    report.ended_at = new Date().toISOString();
    report.result = code === 0 ? 'PASS' : 'FAIL';
    for (const c of report.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `: ${String(c.detail).slice(0, 200)}` : ''}`);
    fs.writeFileSync(path.join(out, 'packaged-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[packaged-smoke] ${report.result} — report ${path.join(out, 'packaged-smoke.json')}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(code);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
