/**
 * P13C ROUND 9 — F15/F16. TWO TENANTS, TWO DESKTOP SESSIONS, AT THE SAME TIME.
 *
 * WHAT WAS WRONG
 *
 * `createRealDesktopChannel` held ONE `{ managed, window, shots }` and the
 * channel is built once at the composition root. Scenario steps reach it per
 * tenant, so while tenant A's session was open a run by tenant B could call
 * `screenshot` and receive PNG bytes of A's live window, drive clicks into it,
 * or close it. Cross-tenant READ and CONTROL from a variable that is not a
 * store, which is why six store sweeps walked past it. F16: the PNGs then
 * landed in one shared directory as `<step-name>-<ts>-<n>.png`, so the bytes
 * were also readable off disk by guessing a name.
 *
 * HOW THIS SUITE IS BUILT, AND WHY IT IS BUILT THAT WAY
 *
 * ONE channel, TWO tenants, driven through a MUTABLE resolver — the same shape
 * `sandboxTenancy.test.ts` uses for the stores, and for the same reason:
 * constructing a channel per tenant would isolate them by construction and make
 * every assertion below pass for the wrong reason. The resolver is literally
 * production's (`resolveTenantScope(() => session)`), so the background-principal
 * precedence under test is the one `activeTenantScope` actually applies.
 *
 * BOTH SESSIONS ARE REAL AND BOTH ARE OPEN. A denial only proves something when
 * the allow case demonstrably works, so every refusal below is bracketed by the
 * positive: A screenshots A and gets bytes of A's window — not "some bytes", and
 * not merely "different bytes from B's". The fake driver's captures name the
 * window they came from, so "these are A's pixels" is an assertion rather than
 * an inference.
 *
 * It runs headless: the production channel is composed with the in-memory
 * `FakeDesktopDriver` through the driver seam S2 already had, so this is
 * production code, not a re-implementation of it. The FAKE channel is exercised
 * too — the gates run through it, and a fake that kept the single slot would
 * keep them green while production leaked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { createRealDesktopChannel } from '../sandbox/enterprise/desktopChannel';
import { FakeDesktopDriver } from '../sandbox/desktop/fakeDriver';
import { FakeEnterprisePlatform } from '../sandbox/enterprise/fakePlatform';
import { ENTERPRISE_ACTIONS, type ActionContext, type ArtifactInput } from '../sandbox/enterprise/actions';
import { EnterprisePerfCollector } from '../sandbox/enterprise/metrics';
import { VariableScope } from '../sandbox/enterprise/vars';
import { classifyEnterpriseFailure } from '../sandbox/enterprise/recovery';
import { EnterprisePlatformError, type EnterpriseDesktopChannel } from '../sandbox/enterprise/platform';
import { currentPrincipal, resolveTenantScope, runAsPrincipal, tenantPrincipal } from './backgroundPrincipal';
import { OTHER_TENANT_SCOPE, TEST_TENANT_SCOPE } from './testScope';

const A = TEST_TENANT_SCOPE;
const B = OTHER_TENANT_SCOPE;
const SESSION_A = 'SESSION-A';
const SESSION_B = 'SESSION-B';
/** Frozen, so two tenants' captures collide on FILENAME and can only be told apart by path. */
const NOW = Date.parse('2026-08-11T00:00:00.000Z');

/** Whose call this is, as the UI sees it. Mutable — switching tenants is the test. */
let uiScope: TenantScope | null = A;
/** Production's resolver, verbatim: a background principal wins over the session. */
const scope = (): TenantScope | null => resolveTenantScope(() => uiScope);

let dir: string;
let driver: FakeDesktopDriver;
let channel: EnterpriseDesktopChannel;

beforeEach(async () => {
  dir = join(tmpdir(), `np-desktop-tenancy-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  driver = new FakeDesktopDriver({
    windows: [{ title: 'NeuroPause', url: 'app://home', elements: [{ selector: '#home', visible: true }] }],
  });
  channel = createRealDesktopChannel({
    tenantId: () => scope()?.tenantId ?? null,
    workspaceId: () => scope()?.workspaceId ?? null,
    principalId: () => currentPrincipal()?.principalId ?? null,
    driver,
    launchTarget: { executablePath: '/nonexistent/electron', args: [] },
    profilesDir: join(dir, 'profiles'),
    artifactsBaseDir: join(dir, 'artifacts'),
    now: () => NOW,
  });
  uiScope = A;
});

afterEach(async () => {
  uiScope = A;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Assert a call was REFUSED, and return the refusal.
 *
 * The message matters: a denial test that silently passes because the operation
 * succeeded is worse than no test, so "it did not throw" has to read as the
 * failure it is.
 */
async function refused(what: string, run: () => Promise<unknown>): Promise<EnterprisePlatformError> {
  let caught: unknown = null;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught, `${what} was ALLOWED — the boundary is not holding`).toBeInstanceOf(EnterprisePlatformError);
  return caught as EnterprisePlatformError;
}

/** The window id the fake driver gave the n-th session it launched. */
function windowOfLaunch(n: number): string {
  return `${driver.sessions[n].id}:w0`;
}

/** Read a capture the channel says it wrote. Proves there are real bytes on disk. */
async function bytesAt(storageRef: string | null): Promise<string> {
  expect(storageRef, 'the channel reported no file for an ALLOWED screenshot').toBeTruthy();
  return (await fs.readFile(storageRef as string)).toString('utf8');
}

/** Every file under `root`, relative, for the "nothing landed anywhere else" checks. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(relative(root, p));
    }
  };
  await walk(root);
  return out.sort();
}

/** A opens SESSION-A, B opens SESSION-B. Both stay open. */
async function openBoth(): Promise<void> {
  uiScope = A;
  await channel.open({ sessionId: SESSION_A });
  uiScope = B;
  await channel.open({ sessionId: SESSION_B });
  uiScope = A;
  expect(driver.sessions).toHaveLength(2); // two REAL sessions, not one slot reused
}

/* ── F15: the session slot ───────────────────────────────────────────────── */

describe('F15 — two tenants hold two live desktop sessions', () => {
  it('each tenant sees ONLY its own session as open', async () => {
    await openBoth();

    uiScope = A;
    expect(channel.isOpen({ sessionId: SESSION_A })).toBe(true);
    expect(channel.isOpen({ sessionId: SESSION_B })).toBe(false);
    expect(channel.isOpen()).toBe(true); // "my current session", per owner

    uiScope = B;
    expect(channel.isOpen({ sessionId: SESSION_B })).toBe(true);
    expect(channel.isOpen({ sessionId: SESSION_A })).toBe(false);
    expect(channel.isOpen()).toBe(true);

    // Both are genuinely running: neither tenant's "open" closed the other's.
    expect(driver.sessions[0].isRunning()).toBe(true);
    expect(driver.sessions[1].isRunning()).toBe(true);
  });

  it('A screenshots A and gets A’s window; B screenshots B and gets B’s', async () => {
    await openBoth();

    uiScope = A;
    const shotA = await channel.screenshot('home', { sessionId: SESSION_A });
    expect(shotA.sizeBytes).toBeGreaterThan(0);
    const bytesA = await bytesAt(shotA.storageRef);

    uiScope = B;
    const shotB = await channel.screenshot('home', { sessionId: SESSION_B });
    expect(shotB.sizeBytes).toBeGreaterThan(0);
    const bytesB = await bytesAt(shotB.storageRef);

    // Positive data, not "A !== B": each capture names the window it came from.
    expect(bytesA).toContain(windowOfLaunch(0));
    expect(bytesA).not.toContain(windowOfLaunch(1));
    expect(bytesB).toContain(windowOfLaunch(1));
    expect(bytesB).not.toContain(windowOfLaunch(0));
  });

  it('A screenshotting B’s session is DENIED — and B’s session still works', async () => {
    await openBoth();

    uiScope = A;
    const denial = await refused('A screenshot of B’s session', () =>
      channel.screenshot('steal', { sessionId: SESSION_B }),
    );
    expect(denial.code).toBe('desktop_denied');

    // The refusal is a REAL boundary in the runner's vocabulary, so it is
    // reported as a denial and never retried into a pass or a skip.
    const failure = classifyEnterpriseFailure(denial);
    expect(failure.kind).toBe('authorization');
    expect(failure.recoverable).toBe(false);

    uiScope = B;
    const mirror = await refused('B screenshot of A’s session', () =>
      channel.screenshot('steal', { sessionId: SESSION_A }),
    );
    expect(mirror.code).toBe('desktop_denied');

    // …and the allow case still works afterwards, so the denial is a boundary
    // rather than a broken channel.
    const shotB = await channel.screenshot('after-denial', { sessionId: SESSION_B });
    expect(await bytesAt(shotB.storageRef)).toContain(windowOfLaunch(1));

    // No bytes of the other tenant's window were written anywhere on disk.
    const files = await tree(join(dir, 'artifacts'));
    for (const f of files) {
      const body = (await fs.readFile(join(dir, 'artifacts', f))).toString('utf8');
      const ownedByA = f.includes(A.tenantId);
      expect(body).toContain(windowOfLaunch(ownedByA ? 0 : 1));
    }
  });

  it('A clicking into B’s session is DENIED — no click reaches B’s window', async () => {
    await openBoth();

    uiScope = A;
    await channel.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_A });
    expect(driver.calls.filter((c) => c.op === 'click' && c.window === windowOfLaunch(0))).toHaveLength(1);

    const denial = await refused('A click into B’s session', () =>
      channel.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_B }),
    );
    expect(denial.code).toBe('desktop_denied');

    uiScope = B;
    const mirror = await refused('B click into A’s session', () =>
      channel.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_A }),
    );
    expect(mirror.code).toBe('desktop_denied');

    // B's window has been clicked exactly zero times, and A's exactly once.
    expect(driver.calls.filter((c) => c.op === 'click' && c.window === windowOfLaunch(1))).toHaveLength(0);
    expect(driver.calls.filter((c) => c.op === 'click' && c.window === windowOfLaunch(0))).toHaveLength(1);

    // B can still drive its OWN window.
    await channel.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_B });
    expect(driver.calls.filter((c) => c.op === 'click' && c.window === windowOfLaunch(1))).toHaveLength(1);
  });

  it('A closing B’s session is DENIED, and B’s session is STILL OPEN afterwards', async () => {
    await openBoth();

    uiScope = A;
    const denial = await refused('A close of B’s session', () => channel.close({ sessionId: SESSION_B }));
    expect(denial.code).toBe('desktop_denied');

    uiScope = B;
    const mirror = await refused('B close of A’s session', () => channel.close({ sessionId: SESSION_A }));
    expect(mirror.code).toBe('desktop_denied');

    // Asserted three ways: the driver's session, the port's predicate, and a
    // capture that still returns the right window's pixels.
    expect(driver.sessions[1].isRunning()).toBe(true);
    expect(channel.isOpen({ sessionId: SESSION_B })).toBe(true);
    expect(await bytesAt((await channel.screenshot('still-here', { sessionId: SESSION_B })).storageRef)).toContain(
      windowOfLaunch(1),
    );

    uiScope = A;
    expect(driver.sessions[0].isRunning()).toBe(true);
    expect(channel.isOpen({ sessionId: SESSION_A })).toBe(true);
  });

  it('closing MY session leaves the other tenant’s untouched', async () => {
    await openBoth();

    uiScope = A;
    await channel.close({ sessionId: SESSION_A });
    expect(driver.sessions[0].isRunning()).toBe(false);
    expect(channel.isOpen({ sessionId: SESSION_A })).toBe(false);

    uiScope = B;
    expect(driver.sessions[1].isRunning()).toBe(true);
    expect(channel.isOpen({ sessionId: SESSION_B })).toBe(true);
  });

  /**
   * CREATION under another tenant's name.
   *
   * Session ids live in a per-owner namespace, so naming somebody else's session
   * on `open` gets the caller a session of their OWN — never a handle on theirs,
   * and never a refusal that would tell them the name is taken.
   */
  it('opening under another tenant’s session NAME creates my own, never theirs', async () => {
    await openBoth();

    uiScope = A;
    const handle = await channel.open({ sessionId: SESSION_B });
    expect(handle.sessionId).toBe(SESSION_B); // A's own SESSION-B, in A's namespace
    expect(driver.sessions).toHaveLength(3); // a THIRD session, not a hijack of B's

    const bytes = await bytesAt((await channel.screenshot('mine', { sessionId: SESSION_B })).storageRef);
    expect(bytes).toContain(windowOfLaunch(2)); // the one A just opened
    expect(bytes).not.toContain(windowOfLaunch(1)); // never B's

    uiScope = B;
    const theirs = await bytesAt((await channel.screenshot('theirs', { sessionId: SESSION_B })).storageRef);
    expect(theirs).toContain(windowOfLaunch(1)); // B's session is exactly where it was
    expect(driver.sessions[1].isRunning()).toBe(true);
  });

  /**
   * The id is not the authority — the OWNER is.
   *
   * Both tenants open a session called `main`. If the id selected the session,
   * one of them would be driving the other's window; because the owner selects
   * it, each gets their own and the shared slot cannot come back unnoticed.
   */
  it('two tenants may use the SAME session id and still never meet', async () => {
    uiScope = A;
    await channel.open({ sessionId: 'main' });
    uiScope = B;
    await channel.open({ sessionId: 'main' });
    expect(driver.sessions).toHaveLength(2);

    uiScope = A;
    expect(await bytesAt((await channel.screenshot('m', { sessionId: 'main' })).storageRef)).toContain(windowOfLaunch(0));
    uiScope = B;
    expect(await bytesAt((await channel.screenshot('m', { sessionId: 'main' })).storageRef)).toContain(windowOfLaunch(1));
  });

  it('a generated session id is not a key to anything — guessing it is refused', async () => {
    uiScope = A;
    const a = await channel.open();
    uiScope = B;
    const b = await channel.open();
    expect(a.sessionId).not.toBe(b.sessionId);

    // B knows (or guesses) A's id. It buys nothing.
    const denial = await refused('B screenshot of A’s generated session', () =>
      channel.screenshot('guess', { sessionId: a.sessionId }),
    );
    expect(denial.code).toBe('desktop_denied');
    expect(channel.isOpen({ sessionId: a.sessionId })).toBe(false);
  });
});

/* ── the background principal ────────────────────────────────────────────── */

describe('F15 — a background scenario acts as its principal, not as the open window', () => {
  it('a job running as A cannot reach B’s session while the UI is showing B', async () => {
    await openBoth();

    // The user has switched to B. A job scheduled for A is still draining.
    uiScope = B;
    const principal = tenantPrincipal({ jobId: 'sandbox-enterprise-scenario', scope: A });
    expect(principal).not.toBeNull();

    await runAsPrincipal(principal!, async () => {
      // Inside the job the principal wins, exactly as `activeTenantScope` decides.
      expect(scope()?.tenantId).toBe(A.tenantId);

      // B's session — the one the UI is showing — is out of reach.
      expect(channel.isOpen({ sessionId: SESSION_B })).toBe(false);
      const denial = await refused('a job running as A screenshotting B’s session', () =>
        channel.screenshot('cross', { sessionId: SESSION_B }),
      );
      expect(denial.code).toBe('desktop_denied');
      await refused('a job running as A clicking B’s session', () =>
        channel.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_B }),
      );
      await refused('a job running as A closing B’s session', () => channel.close({ sessionId: SESSION_B }));

      // Its OWN tenant's session is reachable and returns A's window.
      expect(channel.isOpen({ sessionId: SESSION_A })).toBe(true);
      const shot = await channel.screenshot('job', { sessionId: SESSION_A });
      expect(await bytesAt(shot.storageRef)).toContain(windowOfLaunch(0));
      expect(shot.storageRef).toContain(join('tenants', A.tenantId));
    });

    // B's session survived the job untouched.
    expect(driver.sessions[1].isRunning()).toBe(true);
    uiScope = B;
    expect(channel.isOpen({ sessionId: SESSION_B })).toBe(true);
  });

  /**
   * The principal `SandboxExecutionEngine.runOwned` actually builds, verbatim.
   *
   * Every enterprise scenario runs under `{ tenantId: row.tenantId,
   * workspaceId: '' }` — TENANT-level, with no workspace. This is the case that
   * decides the session semantic: if the owner key included the workspace, a
   * tenant's own scenario runner and its own UI would be different owners, and
   * the runner could not reach a session the tenant opened. The boundary is the
   * TENANT, so it can — and the other tenant is still refused.
   */
  it('the sandbox runner’s own tenant-level principal reaches its tenant’s session, and only its own', async () => {
    await openBoth();

    uiScope = B; // the user is looking at tenant B
    const runnerPrincipal = tenantPrincipal({
      jobId: 'sandbox-execution',
      scope: { tenantId: A.tenantId, workspaceId: '' },
    });

    await runAsPrincipal(runnerPrincipal!, async () => {
      expect(scope()).toEqual({ tenantId: A.tenantId, workspaceId: '' });
      expect(channel.isOpen({ sessionId: SESSION_A })).toBe(true);
      expect(await bytesAt((await channel.screenshot('run', { sessionId: SESSION_A })).storageRef)).toContain(
        windowOfLaunch(0),
      );
      expect((await refused('the runner reaching B’s session', () => channel.screenshot('x', { sessionId: SESSION_B }))).code).toBe(
        'desktop_denied',
      );
    });
  });

  it('a session a job OPENS belongs to the job’s tenant, not to the UI’s', async () => {
    uiScope = B;
    const principal = tenantPrincipal({ jobId: 'sandbox-enterprise-scenario', scope: A });
    const opened = await runAsPrincipal(principal!, async () => channel.open({ sessionId: 'JOB-SESSION' }));
    expect(opened.sessionId).toBe('JOB-SESSION');

    // The UI is still tenant B, and cannot see or touch what the job opened.
    uiScope = B;
    expect(channel.isOpen({ sessionId: 'JOB-SESSION' })).toBe(false);
    const denial = await refused('B screenshot of the job’s session', () =>
      channel.screenshot('peek', { sessionId: 'JOB-SESSION' }),
    );
    expect(denial.code).toBe('desktop_denied');

    // Tenant A — whom the job acted for — owns it.
    uiScope = A;
    expect(channel.isOpen({ sessionId: 'JOB-SESSION' })).toBe(true);
    expect(await bytesAt((await channel.screenshot('mine', { sessionId: 'JOB-SESSION' })).storageRef)).toContain(
      windowOfLaunch(0),
    );
  });
});

/* ── fail closed ─────────────────────────────────────────────────────────── */

describe('F15 — no tenant resolved means no session and no bytes', () => {
  it('refuses to OPEN a session that would belong to nobody', async () => {
    uiScope = null;
    const denial = await refused('open with no active organization', () => channel.open());
    expect(denial.code).toBe('desktop_no_owner');
    expect(driver.sessions).toHaveLength(0);
  });

  it('refuses to read, drive or destroy an existing session', async () => {
    await openBoth();
    const before = await tree(join(dir, 'artifacts'));

    uiScope = null;
    expect(channel.isOpen()).toBe(false);
    expect(channel.isOpen({ sessionId: SESSION_A })).toBe(false);
    expect((await refused('screenshot with no tenant', () => channel.screenshot('x', { sessionId: SESSION_A }))).code).toBe(
      'desktop_no_owner',
    );
    expect(
      (await refused('click with no tenant', () => channel.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_A }))).code,
    ).toBe('desktop_no_owner');
    expect((await refused('close with no tenant', () => channel.close({ sessionId: SESSION_A }))).code).toBe(
      'desktop_no_owner',
    );

    // An unnamed close has nothing of its own to close — and closes nobody else's.
    await channel.close();
    expect(driver.sessions[0].isRunning()).toBe(true);
    expect(driver.sessions[1].isRunning()).toBe(true);

    // Not one byte was written while no tenant was resolved.
    expect(await tree(join(dir, 'artifacts'))).toEqual(before);
  });

  it('an EMPTY tenant id is unresolved, not a tenant called ""', async () => {
    uiScope = { tenantId: '', workspaceId: 'workspace-test' };
    expect((await refused('open as the empty tenant', () => channel.open())).code).toBe('desktop_no_owner');
  });
});

/* ── F16: where the pixels land ──────────────────────────────────────────── */

describe('F16 — a capture is written under a path its owner owns', () => {
  it('two tenants’ captures share a FILENAME and never a directory', async () => {
    await openBoth();

    uiScope = A;
    const shotA = await channel.screenshot('dashboard', { sessionId: SESSION_A });
    uiScope = B;
    const shotB = await channel.screenshot('dashboard', { sessionId: SESSION_B });

    const fileA = shotA.storageRef as string;
    const fileB = shotB.storageRef as string;

    // The clock is frozen and the step name is the same, so the BASENAME is
    // identical — exactly the guess an attacker would make. Only the path
    // differs, and the path comes from the resolver rather than the caller.
    expect(fileA.split(sep).pop()).toBe(fileB.split(sep).pop());
    expect(fileA).not.toBe(fileB);

    expect(relative(join(dir, 'artifacts'), fileA)).toBe(join('tenants', A.tenantId, A.workspaceId, 'dashboard-' + NOW + '-1.png'));
    expect(relative(join(dir, 'artifacts'), fileB)).toBe(join('tenants', B.tenantId, B.workspaceId, 'dashboard-' + NOW + '-1.png'));

    expect(await bytesAt(fileA)).toContain(windowOfLaunch(0));
    expect(await bytesAt(fileB)).toContain(windowOfLaunch(1));

    // Nothing of A's is inside B's directory, and vice versa.
    const inA = await tree(join(dir, 'artifacts', 'tenants', A.tenantId));
    const inB = await tree(join(dir, 'artifacts', 'tenants', B.tenantId));
    expect(inA).toHaveLength(1);
    expect(inB).toHaveLength(1);
  });

  it('a tenant id that tries to climb out of the base directory cannot', async () => {
    // Not a hypothetical shape: `SessionManager` sanitizes its profile segments
    // for the same reason, and a boundary the caller can step around is not one.
    uiScope = { tenantId: '../../../../etc', workspaceId: '../..' };
    await channel.open({ sessionId: 'traversal' });
    const shot = await channel.screenshot('escape', { sessionId: 'traversal' });

    const file = shot.storageRef as string;
    const rel = relative(join(dir, 'artifacts'), file);
    expect(isAbsolute(rel)).toBe(false);
    expect(rel.split(sep)).not.toContain('..');
    expect(await tree(join(dir, 'artifacts'))).toEqual([rel]);
  });
});

/* ── the FAKE channel: what the gates actually run ───────────────────────── */

describe('F15 — the fake channel enforces the same rule', () => {
  /**
   * The gates exercise the fake through the same port. Before this round it had
   * the identical defect — one `open_` boolean and one screenshot counter — so a
   * suite could go green against a channel with no owner at all. Both
   * implementations now resolve ownership through the same registry, so these
   * cases and the ones above are testing one rule rather than two.
   */
  function fakePlatform(): FakeEnterprisePlatform {
    return new FakeEnterprisePlatform({
      desktopElements: [{ selector: '#home', visible: true }],
      desktopOwner: () => ({ tenantId: scope()?.tenantId ?? null, workspaceId: scope()?.workspaceId ?? null }),
    });
  }

  it('allows each tenant its own session and refuses the other’s', async () => {
    const platform = fakePlatform();

    uiScope = A;
    await platform.desktop.open({ sessionId: SESSION_A });
    uiScope = B;
    await platform.desktop.open({ sessionId: SESSION_B });

    // Allowed, with data that names the owner — not merely "not the other one".
    uiScope = A;
    const shotA = await platform.desktop.screenshot('home', { sessionId: SESSION_A });
    expect(shotA.bytes?.toString()).toContain(A.tenantId);
    uiScope = B;
    const shotB = await platform.desktop.screenshot('home', { sessionId: SESSION_B });
    expect(shotB.bytes?.toString()).toContain(B.tenantId);

    // Denied, both directions.
    uiScope = A;
    expect((await refused('A screenshot of B (fake)', () => platform.desktop.screenshot('x', { sessionId: SESSION_B }))).code).toBe('desktop_denied');
    uiScope = B;
    expect((await refused('B screenshot of A (fake)', () => platform.desktop.screenshot('x', { sessionId: SESSION_A }))).code).toBe('desktop_denied');

    // Clicks land in the caller's own session and nowhere else.
    uiScope = A;
    await platform.desktop.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_A });
    await refused('A click into B (fake)', () => platform.desktop.action({ type: 'click', selector: '#home' }, { sessionId: SESSION_B }));
    expect(platform.desktop.clicksOn({ sessionId: SESSION_A })).toHaveLength(1);
    uiScope = B;
    expect(platform.desktop.clicksOn({ sessionId: SESSION_B })).toHaveLength(0);

    // Close is refused, and B's session is still open afterwards.
    uiScope = A;
    await refused('A close of B (fake)', () => platform.desktop.close({ sessionId: SESSION_B }));
    uiScope = B;
    expect(platform.desktop.isOpen({ sessionId: SESSION_B })).toBe(true);
    expect((await platform.desktop.screenshot('after', { sessionId: SESSION_B })).bytes?.toString()).toContain(B.tenantId);

    // Fail closed.
    uiScope = null;
    expect(platform.desktop.isOpen({ sessionId: SESSION_B })).toBe(false);
    expect((await refused('screenshot with no tenant (fake)', () => platform.desktop.screenshot('x', { sessionId: SESSION_B }))).code).toBe('desktop_no_owner');
    expect((await refused('open with no tenant (fake)', () => platform.desktop.open())).code).toBe('desktop_no_owner');
  });

  /**
   * The surface a scenario step actually uses.
   *
   * The finding's path is "a scenario run by tenant B calls screenshot", and
   * that arrives through the action registry with renderer-supplied input — so
   * the input is where a `sessionId` would be smuggled in.
   */
  it('a scenario STEP cannot name another tenant’s session', async () => {
    const platform = fakePlatform();
    const artifacts: ArtifactInput[] = [];
    const ctx: ActionContext = {
      platform,
      vars: new VariableScope(),
      perf: new EnterprisePerfCollector(),
      emitLog: () => undefined,
      emitStep: () => undefined,
      attachArtifact: (a) => artifacts.push(a),
      sleep: () => Promise.resolve(),
      now: () => NOW,
      track: () => undefined,
    };

    uiScope = A;
    const openedA = await ENTERPRISE_ACTIONS.openDesktop({}, ctx);
    const idA = (openedA.value as { sessionId: string }).sessionId;
    uiScope = B;
    const openedB = await ENTERPRISE_ACTIONS.openDesktop({}, ctx);
    const idB = (openedB.value as { sessionId: string }).sessionId;
    expect(idA).not.toBe(idB);

    // A's own step works and attaches A's pixels.
    uiScope = A;
    await ENTERPRISE_ACTIONS.takeScreenshot({ name: 'home', sessionId: idA }, ctx);
    const mine = artifacts.at(-1)!;
    expect(mine.kind).toBe('screenshot');
    expect(Buffer.from(mine.inline ?? '', 'base64').toString()).toContain(A.tenantId);

    // Naming B's session in the step input is refused, and attaches nothing.
    const before = artifacts.length;
    const denial = await refused('a step naming B’s session', () =>
      ENTERPRISE_ACTIONS.takeScreenshot({ name: 'steal', sessionId: idB }, ctx),
    );
    expect(denial.code).toBe('desktop_denied');
    await refused('a step clicking B’s session', () => ENTERPRISE_ACTIONS.clickUi({ selector: '#home', sessionId: idB }, ctx));
    expect(artifacts).toHaveLength(before);
  });
});
