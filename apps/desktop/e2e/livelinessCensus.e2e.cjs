/*
 * NeuroPause OS — NP-008 §1. APP LIVELINESS CENSUS (read-only recorder).
 *
 * Launches the app on a FRESH THROWAWAY local-first profile (plain mode: no NEUROPAUSE_E2E,
 * no app-principal env — the e2e seams compiled into this build stay inert, proven by the
 * NP-007 V3 plain-mode pins), walks the first-run experience capturing every claim verbatim,
 * chooses the Business workspace type (the fullest sidebar — `sectionVisibleFor('business')`
 * shows everything), then visits EVERY visible nav surface and records per surface:
 *   - the rendered text of <main> (what the user actually sees)
 *   - renderer console errors + page errors attributable to that surface
 *   - main-process WARN/ERROR/IPC-refusal log lines attributable to that surface
 *   - a screenshot
 *
 * This harness RECORDS; it does not classify. Classification (LIVE / RENDERS-ONLY / STUB /
 * BROKEN / GATED) happens in the census document against these artifacts plus code traces.
 * ZERO external effects: no credentials, no OAuth, no send path — read-only navigation.
 *
 * Build once:  NP_E2E_BUILD=1 npx electron-vite build   (already the ceremony-ready build)
 * Run:         node e2e/livelinessCensus.e2e.cjs        (artifacts in e2e/artifacts/census/)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN = path.join(APP_DIR, 'out/main/index.js');
const ART = path.join(__dirname, 'artifacts', 'census');
fs.mkdirSync(ART, { recursive: true });

/** Visible (non-hidden) sections, in SECTIONS order — mirrors shell/sections.ts. */
const SURFACES = [
  { id: 'mission-control', label: 'Mission Control' },
  { id: 'intent-home', label: "Today's Intent" },
  { id: 'search', label: 'Search' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'hub', label: 'Work Hub' },
  { id: 'ai-home', label: 'Ask NeuroPause' },
  { id: 'understand', label: 'Understand' },
  { id: 'holds', label: 'Holds' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'organization', label: 'Organization' },
  { id: 'enterprise', label: 'Enterprise', preview: true },
  { id: 'business', label: 'Business' },
  { id: 'administration', label: 'Administration' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'collaboration', label: 'Collaboration' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'automation-center', label: 'Automation' },
  { id: 'ai-operations', label: 'AI Operations' },
  { id: 'extensibility', label: 'Extensibility' },
  { id: 'opscenter', label: 'Operations' },
  { id: 'developer', label: 'Developer' },
  { id: 'industry-center', label: 'Industry Center', preview: true },
  { id: 'strategy-center', label: 'Strategy Center', preview: true },
  { id: 'twin-center', label: 'Digital Twin Center', preview: true },
  { id: 'knowledge-center', label: 'Enterprise Knowledge', preview: true },
  { id: 'orchestration-center', label: 'Orchestration', preview: true },
  { id: 'network-center', label: 'Intelligence Network', preview: true },
  { id: 'auto-ops-center', label: 'Autonomous Operations', preview: true },
  { id: 'commercial-center', label: 'Commercial Center', preview: true },
  { id: 'product-ops', label: 'Release Ops' },
  { id: 'ecosystem', label: 'Ecosystem', preview: true },
  { id: 'cloud', label: 'Cloud', preview: true },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'federation', label: 'Federation', preview: true },
  { id: 'store', label: 'AI Store' },
  { id: 'marketplace', label: 'Enterprise Marketplace', preview: true },
  { id: 'workspace', label: 'Workspace' },
  { id: 'operations', label: 'Runtime' },
  { id: 'workforce', label: 'AI Workforce' },
  { id: 'workforce-center', label: 'Workforce Admin' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'data-center', label: 'Data' },
  { id: 'medical-devices', label: 'Medical Devices' },
  { id: 'memory', label: 'AI Memory' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'welcome', label: 'Getting Started' },
  { id: 'settings', label: 'Settings' },
];

const hardTimeout = setTimeout(() => {
  console.log('HARD_TIMEOUT — census walk did not complete');
  process.exit(9);
}, 480_000);
hardTimeout.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-census-'));
  const report = { startedAt: new Date().toISOString(), profile, firstRun: {}, surfaces: [], harnessErrors: [] };

  // Plain local-first launch: strip every e2e / ceremony env knob explicitly.
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.NEUROPAUSE_E2E;
  delete env.NEUROPAUSE_E2E_VERIFY;
  delete env.NEUROPAUSE_S15_APPPRINCIPAL;
  delete env.NEUROPAUSE_FIRST_REAL_SEND;

  const mainLog = []; // { t, line }
  const consoleEvents = []; // { t, kind, text }
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${profile}`], cwd: APP_DIR, env, timeout: 45_000 });
  const record = (d) => {
    const t = Date.now();
    for (const line of String(d).split('\n')) if (line.trim()) mainLog.push({ t, line });
  };
  app.process().stdout.on('data', record);
  app.process().stderr.on('data', record);

  const win = await app.firstWindow({ timeout: 30_000 });
  win.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleEvents.push({ t: Date.now(), kind: msg.type(), text: msg.text().slice(0, 500) });
  });
  win.on('pageerror', (err) => consoleEvents.push({ t: Date.now(), kind: 'pageerror', text: String(err).slice(0, 500) }));
  await win.waitForLoadState('domcontentloaded');

  const dialogText = async () =>
    win.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? document.body.innerText).catch(() => '');
  const mainText = async () =>
    win.evaluate(() => {
      const m = document.querySelector('main');
      return (m ? m.innerText : document.body.innerText).slice(0, 6000);
    }).catch(() => '');
  const shot = (name) => win.screenshot({ path: path.join(ART, name) }).catch(() => {});
  const clickByName = async (name, timeout = 12_000) => {
    const btn = win.getByRole('button', { name, exact: true }).first();
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
  };

  // ── Plain-mode honesty checks on the launch itself ───────────────────────────
  await sleep(4000);
  const startupJoined = mainLog.map((l) => l.line).join('\n');
  report.firstRun.localModeEntered = startupJoined.includes('Entering device-local mode');
  report.firstRun.e2eSeedAbsent = !startupJoined.includes('NEUROPAUSE_E2E_SEED');

  // ── First-run walk, capturing every claim verbatim ───────────────────────────
  try {
    await win.getByRole('button', { name: 'Try Free Locally', exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
    report.firstRun.welcomeText = await dialogText();
    await shot('00-firstrun-welcome.png');
    await clickByName('Try Free Locally');

    // Processing step: wait for the REAL local-model probe to resolve, then capture the claim.
    for (let i = 0; i < 20; i++) {
      const t = await dialogText();
      if (!t.includes('Checking for a local model')) break;
      await sleep(500);
    }
    report.firstRun.processingText = await dialogText();
    await shot('01-firstrun-processing.png');
    await clickByName('Keep it on this device');

    // Either the workspace step appears, or the screen shows an honest failure alert.
    const explore = win.getByRole('button', { name: 'Explore Business', exact: true }).first();
    try {
      await explore.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      report.firstRun.processingChoiceError = await dialogText();
      await shot('01b-firstrun-processing-error.png');
    }
    if (await explore.isVisible().catch(() => false)) {
      report.firstRun.workspaceText = await dialogText();
      await shot('02-firstrun-workspace.png');
      await explore.click();
      await clickByName('Skip these questions');
      report.firstRun.understandingText = await dialogText();
      await shot('03-firstrun-understanding.png');
      await clickByName('Yes, continue');
      report.firstRun.completed = true;
    } else {
      report.firstRun.completed = false;
    }
  } catch (e) {
    report.firstRun.walkError = String(e).slice(0, 400);
    await shot('0x-firstrun-stuck.png');
  }

  // ── Shell mount ──────────────────────────────────────────────────────────────
  try {
    await win.locator('aside[aria-label="Primary navigation"]').waitFor({ state: 'visible', timeout: 20_000 });
    report.shellMounted = true;
  } catch {
    report.shellMounted = false;
  }
  await sleep(2500);
  report.localModeBanner = await win
    .evaluate(() => document.body.innerText.includes('Working locally'))
    .catch(() => false);
  await shot('04-shell-landing.png');

  // The "Early access setup" tour (OnboardingWizard) overlays the shell on first
  // launch — its step titles/descriptions are first-run CLAIMS, so capture every
  // step verbatim, then Finish. (Run 1 lesson: it also blocks all sidebar clicks.)
  report.tourSteps = [];
  const tourVisible = () =>
    win.evaluate(() => /early access setup/i.test(document.body.innerText)).catch(() => false);
  for (let i = 0; i < 10; i++) {
    if (!(await tourVisible())) break;
    report.tourSteps.push(await dialogText());
    await shot(`tour-${i + 1}.png`);
    const finish = win.getByRole('button', { name: 'Finish', exact: true }).first();
    if (await finish.isVisible().catch(() => false)) {
      await finish.click().catch(() => {});
    } else {
      await win.getByRole('button', { name: 'Continue', exact: true }).first().click({ timeout: 4000 }).catch(() => {});
    }
    await sleep(700);
  }
  // Hard guard: NOTHING may overlay the shell when the walk starts. If the tour
  // (or any dialog carrying "Skip tour") survived the loop, dismiss and record it.
  for (let i = 0; i < 3 && (await tourVisible()); i++) {
    report.harnessErrors.push('tour still open after step loop — dismissing via Skip tour');
    await win.getByRole('button', { name: 'Skip tour', exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    await sleep(700);
  }
  report.overlayBeforeWalk = await win
    .evaluate(() => document.querySelector('[role="dialog"][aria-modal="true"]')?.textContent?.slice(0, 200) ?? null)
    .catch(() => null);

  // Open the Advanced disclosure so every advanced surface is clickable.
  try {
    await win.locator('aside').getByRole('button', { name: 'Advanced', exact: true }).first().click({ timeout: 5000 });
    await win.locator('#sidebar-advanced-list').waitFor({ state: 'visible', timeout: 4000 });
    report.advancedOpened = true;
  } catch {
    report.advancedOpened = false;
    report.harnessErrors.push('Advanced disclosure not found/clickable');
  }

  // ── The walk ─────────────────────────────────────────────────────────────────
  let idx = 0;
  for (const s of SURFACES) {
    idx += 1;
    const rec = { id: s.id, label: s.label, reached: false };
    const markLog = mainLog.length;
    const markCon = consoleEvents.length;
    try {
      const name = s.preview ? `${s.label} — Preview` : s.label;
      const btn = win.locator(`aside button[aria-label="${name}"]`).first();
      if ((await btn.count()) === 0) {
        rec.reached = false;
        rec.note = 'NOT IN SIDEBAR (business profile)';
      } else {
        await btn.click({ timeout: 8000 });
        await sleep(1400);
        let text = await mainText();
        if (text.trim().length < 60) {
          await sleep(2200); // lazy view still loading — give it one more beat
          text = await mainText();
        }
        rec.reached = true;
        rec.text = text;
        rec.errorBoundary = text.includes('Something went wrong');
      }
    } catch (e) {
      rec.note = `NAV FAILED: ${String(e).slice(0, 200)}`;
    }
    rec.consoleErrors = consoleEvents.slice(markCon).map((c) => `${c.kind}: ${c.text}`).slice(0, 20);
    rec.mainLog = mainLog
      .slice(markLog)
      .map((l) => l.line)
      .filter((l) => /ERROR|WARN|IPC handler error|Error occurred in handler/.test(l))
      .slice(0, 30);
    await shot(`${String(idx).padStart(2, '0')}-${s.id}.png`);
    report.surfaces.push(rec);
    console.log(
      `  [${String(idx).padStart(2, '0')}/${SURFACES.length}] ${s.id} — ${rec.reached ? 'visited' : rec.note} ` +
        `(${rec.consoleErrors?.length ?? 0} console err, ${rec.mainLog?.length ?? 0} main warn/err${rec.errorBoundary ? ', ERROR BOUNDARY' : ''})`,
    );
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(ART, 'census-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(ART, 'main-log.txt'), mainLog.map((l) => l.line).join('\n'));
  fs.writeFileSync(path.join(ART, 'console-events.txt'), consoleEvents.map((c) => `${c.kind}: ${c.text}`).join('\n'));

  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), sleep(4000)]);
  try { proc.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* throwaway */ }

  const visited = report.surfaces.filter((r) => r.reached).length;
  console.log(`\nCENSUS RECORDED — ${visited}/${SURFACES.length} surfaces visited. Report: ${path.join(ART, 'census-report.json')}`);
  clearTimeout(hardTimeout);
  process.exit(report.shellMounted && visited > 0 ? 0 : 1);
})().catch((e) => {
  console.log('CENSUS_HARNESS_ERROR:', e.message);
  process.exit(3);
});
