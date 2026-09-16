/**
 * P13C ROUND 36 — GATE 1. THE RUNTIME-CORE STATE, ANSWERABLE FROM T=0.
 *
 * TWO DEFECTS THIS CLOSES, both documented by the Gate-1 audit:
 *
 *  1. THE STICKY BOOT-WINDOW RACE. The window opens before `initRuntimeCore()`
 *     finishes (a product decision, and the right one — see
 *     `earlyReachability.ts`), so for seconds the ~650 secure runtime channels
 *     do not exist. `AppShell` invokes `xp:profile.get` on mount; its failure
 *     branch pinned a wrong "skipped" profile for the ENTIRE session, because
 *     nothing ever told the renderer "the runtime is up now — ask again". The
 *     O-3 fix gave one channel an early answer; this gives the renderer the
 *     general signal: a base-router channel that exists before the window
 *     does, plus a broadcast on the transition, so late channels can be
 *     retried the moment they exist.
 *
 *  2. THE SILENT COMPOSITION FAILURE. When `initRuntimeCore` throws, the shell
 *     kept rendering a complete, authenticated UI over ~650 dead channels,
 *     and the one diagnostic built to explain the failure sat behind a secure
 *     channel the failed init never registered. `failed` here rides the BASE
 *     router — registered before the window — so the renderer can finally say
 *     "the runtime failed to start" instead of silently degrading.
 *
 * This module is deliberately Electron-free and holds three fields; the
 * transitions are called from exactly one place (`index.ts` bootstrap).
 */
import type { RuntimeStateDto } from '@neuropause/shared';

let current: RuntimeStateDto = { state: 'starting', message: null };

/** The current runtime-core init state. Served by the base router. */
export function runtimeStateSnapshot(): RuntimeStateDto {
  return { ...current };
}

/** Called once, after `registerSecureHandlers` completed. */
export function markRuntimeReady(): RuntimeStateDto {
  current = { state: 'ready', message: null };
  return runtimeStateSnapshot();
}

/** Called once, from the bootstrap catch. Takes a PRE-SANITIZED message. */
export function markRuntimeFailed(message: string): RuntimeStateDto {
  current = { state: 'failed', message };
  return runtimeStateSnapshot();
}

/**
 * A user-safe sentence from an unknown init error: the message only (never a
 * stack, never a path-bearing multi-line dump), capped so a pathological error
 * cannot flood the renderer banner. The full error still goes to the log —
 * this is the RENDERER's copy, not the diagnostic record.
 */
export function safeInitFailureMessage(err: unknown): string {
  const raw = err instanceof Error && err.message ? err.message : 'Unknown startup error.';
  const firstLine = raw.split('\n')[0].trim();
  const capped = firstLine.length > 300 ? `${firstLine.slice(0, 297)}…` : firstLine;
  return capped.length > 0 ? capped : 'Unknown startup error.';
}

/** Test seam. Never called in production. */
export function __resetRuntimeStateForTests(): void {
  current = { state: 'starting', message: null };
}
