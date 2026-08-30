/**
 * P13C ROUND 48 — GATE 1. THE BOOTSTRAP SOURCE PINS.
 *
 * `index.ts` is the one file the suite could never import (it drives the real
 * Electron app), and the Gate-1 audit flagged it as the last untested link of
 * the boot story: the ordering decisions that every other Gate-1 fix depends
 * on lived only in comments. These pins hold the load-bearing lines by source
 * scan — the `resolverAttachment`/`shutdownFlushCoverage` precedent, limits
 * stated at the bottom.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('.', import.meta.url));
const src = readFileSync(join(MAIN, 'index.ts'), 'utf8');

describe('index.ts bootstrap pins (Gate 1)', () => {
  it('enforces the single-instance lock, quitting the loser', () => {
    expect(src).toContain('app.requestSingleInstanceLock()');
    expect(src).toContain('if (!gotLock)');
  });

  it('keeps the deliberate WINDOW-FIRST ordering: the window opens before the runtime core', () => {
    const windowAt = src.indexOf("startupMetrics.mark('window-created')");
    const coreAt = src.indexOf('await initRuntimeCore(');
    expect(windowAt).toBeGreaterThan(-1);
    expect(coreAt).toBeGreaterThan(-1);
    expect(windowAt, 'the window must be created before initRuntimeCore — the round-36 decision').toBeLessThan(coreAt);
  });

  it('broadcasts BOTH runtime transitions — ready and failed — so the boot window can end', () => {
    // The ready broadcast is what the renderer-side boot retry (lib/ipc.ts)
    // and the AppShell/Assistant re-loads key on; the failed broadcast is what
    // keeps a composition failure from being silent.
    expect(src).toContain('broadcast(IpcChannel.RuntimeStateChanged, markRuntimeReady())');
    expect(src).toContain('markRuntimeFailed(safeInitFailureMessage(err))');
  });

  it('a runtime-core failure never takes the window down (window stays; failure is said)', () => {
    // The init is inside try/catch and the catch does NOT quit.
    const catchBlock = src.slice(src.indexOf('Runtime core failed to initialize'));
    const upToNext = catchBlock.slice(0, catchBlock.indexOf('}'));
    expect(upToNext).not.toContain('app.quit()');
    expect(upToNext).not.toContain('app.exit(');
  });

  it('the will-quit flush barrier defers the quit, drains, then quits for real', () => {
    expect(src).toContain("app.on('will-quit'");
    expect(src).toContain('event.preventDefault()');
    expect(src).toContain('runShutdownFlush()');
  });

  it('the app log attaches BEFORE bootstrap so startup lines land in the file', () => {
    const sinkAt = src.indexOf('attachLogFileSink');
    const bootstrapAt = src.indexOf('return bootstrap()');
    expect(sinkAt).toBeGreaterThan(-1);
    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(sinkAt).toBeLessThan(bootstrapAt);
  });

  it('GATE 1 (round 48): boot-window crash capture exists — local-only, flush-preserving', () => {
    expect(src).toContain("process.on('uncaughtException'");
    expect(src).toContain("process.on('unhandledRejection'");
    // The exception path quits through app.quit() (the flush barrier runs),
    // never a hard exit that would skip will-quit.
    const handler = src.slice(src.indexOf("process.on('uncaughtException'"));
    const body = handler.slice(0, handler.indexOf('});') + 3);
    expect(body).toContain('app.quit()');
    expect(body).not.toContain('app.exit(');
  });

  it('additional web contents are denied (window-open hardening)', () => {
    expect(src).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
  });
});

/**
 * WHAT A SOURCE SCAN CANNOT SEE, stated rather than claimed away: it pins that
 * the load-bearing calls exist and in which order they appear in the file, not
 * that they behave — behavior lives in `runtimeReadiness.test.ts`,
 * `shutdownFlush.test.ts`, `ui-tests/bootWindowRetry.test.tsx` and the live
 * boot evidence in the readiness matrix. A refactor that moves a call into a
 * helper in another file will fail these pins and should update them
 * deliberately, which is the point.
 */
