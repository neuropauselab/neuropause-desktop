/** AI Sandbox S2 — desktop unit tests (session manager, actions, window manager, capture, recovery). */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Artifact, DesktopLaunchOptions } from '@neuropause/shared';
import { FakeDesktopDriver } from './fakeDriver';
import { SessionManager, type LaunchTarget } from './sessionManager';
import { enumerateWindows, selectWindow } from './windowManager';
import { captureConsole, captureNetwork, captureScreenshot, type CaptureDeps } from './capture';
import { PerfCollector, runAction, type ActionRunContext } from './actions';
import { classifyDesktopFailure } from './recovery';
import { DesktopUnavailableError } from './driver';

let seq = 0;
const base = (): string => {
  seq += 1;
  return join(tmpdir(), `s2-${Date.now()}-${seq}`);
};
const target: LaunchTarget = { executablePath: '/bin/electron', args: ['/app'], cwd: '/app' };
const opts = (over: Partial<DesktopLaunchOptions> = {}): DesktopLaunchOptions => ({ profile: 'temporary', profileKey: null, args: [], timeoutMs: 5000, captureConsole: true, ...over });

function attachSink(): { attach: CaptureDeps['attach']; artifacts: Artifact[] } {
  const artifacts: Artifact[] = [];
  const attach: CaptureDeps['attach'] = (input) => {
    const a: Artifact = {
      id: `a${artifacts.length}`, executionId: 'e', workspaceId: 'w', kind: input.kind, name: input.name,
      mimeType: input.mimeType ?? 'application/octet-stream', sizeBytes: input.sizeBytes ?? (input.inline ? input.inline.length : 0),
      storageRef: input.storageRef ?? null, inline: input.inline ?? null, createdAt: 'x', metadata: input.metadata ?? {},
    };
    artifacts.push(a);
    return a;
  };
  return { attach, artifacts };
}

describe('SessionManager', () => {
  it('launches with an isolated profile dir and removes it on close (temporary)', async () => {
    const profilesDir = base();
    const sm = new SessionManager({ driver: new FakeDesktopDriver(), profilesDir, launchTarget: target });
    const m = await sm.launch(opts());
    expect(m.session.isRunning()).toBe(true);
    await expect(fs.stat(m.profileDir)).resolves.toBeTruthy(); // dir created
    expect(m.profileDir.startsWith(profilesDir)).toBe(true);
    await sm.close(m.id);
    await expect(fs.stat(m.profileDir)).rejects.toBeTruthy(); // removed
  });

  it('keeps a persistent profile across close', async () => {
    const sm = new SessionManager({ driver: new FakeDesktopDriver(), profilesDir: base(), launchTarget: target });
    const m = await sm.launch(opts({ profile: 'persistent', profileKey: 'ci' }));
    const dir = m.profileDir;
    await sm.close(m.id);
    await expect(fs.stat(dir)).resolves.toBeTruthy(); // persistent dir survives
  });

  it('supports multiple sessions, health, app state, restart and reset', async () => {
    const driver = new FakeDesktopDriver({ windows: [{ title: 'NeuroPause', elements: [] }] });
    const sm = new SessionManager({ driver, profilesDir: base(), launchTarget: target });
    const a = await sm.launch(opts());
    const b = await sm.launch(opts());
    expect(sm.list()).toHaveLength(2);
    expect(await sm.health(a.id)).toMatchObject({ running: true, windows: 1, responsive: true });
    expect((await sm.appState(a.id))?.profile).toBe('temporary');

    const restarted = await sm.restart(a.id, opts());
    expect(restarted).not.toBeNull();
    expect(await sm.reset(b.id)).toBe(true);
    await sm.closeAll();
  });
});

describe('window manager', () => {
  it('enumerates and selects windows', async () => {
    const driver = new FakeDesktopDriver({ windows: [{ title: 'Main', url: 'app://home' }, { title: 'Settings', url: 'app://settings' }] });
    const session = await driver.launch({ executablePath: 'x', args: [], userDataDir: '/tmp/x', env: {}, timeoutMs: 1000 });
    const windows = await enumerateWindows(session);
    expect(windows.map((w) => w.title)).toEqual(['Main', 'Settings']);
    expect((await selectWindow(session, 1))).not.toBeNull();
    expect(await selectWindow(session, 5)).toBeNull();
  });
});

describe('capture → artifacts', () => {
  it('writes a real screenshot file + attaches console and network logs', async () => {
    const artifactsDir = base();
    const sink = attachSink();
    const deps: CaptureDeps = { artifactsDir, attach: sink.attach, now: () => 1000 };
    const driver = new FakeDesktopDriver({
      windows: [{ title: 'Main', elements: [] }],
      console: [{ level: 'error', text: 'boom', at: 1 }],
      network: [{ method: 'GET', url: 'app://x', status: 200, at: 1 }],
    });
    const session = await driver.launch({ executablePath: 'x', args: [], userDataDir: '/tmp/x', env: {}, timeoutMs: 1000 });
    const window = await session.firstWindow();

    const shot = await captureScreenshot(window, 'home', deps);
    expect(shot.artifact.kind).toBe('screenshot');
    expect(shot.artifact.sizeBytes).toBeGreaterThan(0);
    await expect(fs.stat(shot.artifact.storageRef as string)).resolves.toBeTruthy(); // real bytes on disk

    expect(captureConsole(session, deps)?.kind).toBe('log');
    expect(captureNetwork(session, deps)?.metadata.requests).toBe(1);
    expect(sink.artifacts).toHaveLength(3);
  });
});

describe('action interpreter', () => {
  async function ctxFor(elements: { selector: string; visible?: boolean; enabled?: boolean; text?: string }[]): Promise<{ ctx: ActionRunContext; perf: PerfCollector; artifacts: Artifact[] }> {
    const driver = new FakeDesktopDriver({ windows: [{ title: 'Main', elements }] });
    const session = await driver.launch({ executablePath: 'x', args: [], userDataDir: '/tmp/x', env: {}, timeoutMs: 1000 });
    const window = await session.firstWindow();
    const sink = attachSink();
    const perf = new PerfCollector();
    const ctx: ActionRunContext = {
      session, window, capture: { artifactsDir: base(), attach: sink.attach, now: () => 1 },
      emitStep: () => undefined, emitLog: () => undefined, sleep: () => Promise.resolve(), defaultTimeoutMs: 1000, perf, now: () => 1,
    };
    return { ctx, perf, artifacts: sink.artifacts };
  }

  it('drives interactions and records perf', async () => {
    const { ctx, perf } = await ctxFor([{ selector: '#btn', enabled: true }]);
    await runAction({ type: 'click', selector: '#btn' }, ctx);
    await runAction({ type: 'press', key: 'Enter' }, ctx);
    await runAction({ type: 'wait', durationMs: 5 }, ctx);
    expect(perf.metrics().actions).toBeGreaterThanOrEqual(2);
  });

  it('returns assertion verdicts (pass + fail) without throwing', async () => {
    const { ctx } = await ctxFor([{ selector: '#ok', visible: true, enabled: true, text: 'Hello World' }]);
    expect((await runAction({ type: 'assertVisible', selector: '#ok' }, ctx)).assertion?.ok).toBe(true);
    expect((await runAction({ type: 'assertText', selector: '#ok', text: 'World' }, ctx)).assertion?.ok).toBe(true);
    expect((await runAction({ type: 'assertExists', selector: '#missing' }, ctx)).assertion?.ok).toBe(false);
    expect((await runAction({ type: 'assertText', selector: '#ok', text: 'Nope' }, ctx)).assertion?.ok).toBe(false);
  });

  it('throws a real automation error on a missing element (flows to recovery)', async () => {
    const { ctx } = await ctxFor([]);
    await expect(runAction({ type: 'click', selector: '#nope' }, ctx)).rejects.toThrow(/not found/i);
  });
});

describe('failure classification', () => {
  it('maps errors + liveness to recoverable / non-recoverable kinds', () => {
    expect(classifyDesktopFailure(new DesktopUnavailableError('requires Playwright'), false)).toMatchObject({ kind: 'unavailable', recoverable: false });
    expect(classifyDesktopFailure(new Error('Timeout: waiting for x'), true)).toMatchObject({ kind: 'timeout', recoverable: true });
    expect(classifyDesktopFailure(new Error('anything'), false)).toMatchObject({ kind: 'app_crash', recoverable: true });
    expect(classifyDesktopFailure(new Error('selector "#x" not found'), true)).toMatchObject({ kind: 'automation', recoverable: false });
  });
});
