/**
 * Startup metrics (Phase 8 · RC hardening 8.16) — launch time is the #1
 * perceived-quality metric of a desktop app, and before Phase 8 it was
 * entirely unmeasured across a 104-module composition root. This module is a
 * tiny mark/measure recorder: the main entry records phase marks during boot,
 * diagnostics reads one snapshot.
 *
 * Pure and Electron-free (injected clock), so it unit-tests directly. The
 * budgets are advisory surface (shown, never enforced at runtime): budgets as
 * hard test gates belong on the target hardware, not CI — the lesson of the
 * knowledgeBench wall-clock flake, applied.
 */

export interface StartupPhase {
  name: string;
  /** ms from process start (performance-now-based, monotonic). */
  atMs: number;
  /** ms since the previous mark. */
  deltaMs: number;
}

export interface StartupSnapshot {
  phases: StartupPhase[];
  /** ms from first mark to the last mark recorded so far. */
  totalMs: number;
  /** True once the boot-complete mark has been recorded. */
  complete: boolean;
}

const BOOT_COMPLETE_MARK = 'runtime-core-ready';

export function createStartupMetrics(nowMs: () => number = () => performance.now()) {
  const t0 = nowMs();
  const phases: StartupPhase[] = [];

  return {
    /** Record a named boot phase (call at most once per name; extras ignored). */
    mark(name: string): void {
      if (phases.some((p) => p.name === name)) return;
      const at = nowMs() - t0;
      const prev = phases.length > 0 ? phases[phases.length - 1].atMs : 0;
      phases.push({ name, atMs: Math.round(at), deltaMs: Math.round(at - prev) });
    },
    snapshot(): StartupSnapshot {
      return {
        phases: [...phases],
        totalMs: phases.length > 0 ? phases[phases.length - 1].atMs : 0,
        complete: phases.some((p) => p.name === BOOT_COMPLETE_MARK),
      };
    },
  };
}

/** The process-wide recorder the main entry marks into. */
export const startupMetrics = createStartupMetrics();

/** Render the snapshot as diagnostics lines (empty when nothing recorded). */
export function formatStartupLines(snapshot: StartupSnapshot): string[] {
  if (snapshot.phases.length === 0) return [];
  const lines = ['## Startup'];
  for (const p of snapshot.phases) {
    lines.push(`${p.name.padEnd(22)} +${p.deltaMs} ms (at ${p.atMs} ms)`);
  }
  lines.push(`Total to ready:        ${snapshot.totalMs} ms${snapshot.complete ? '' : ' (boot incomplete)'}`);
  return lines;
}
