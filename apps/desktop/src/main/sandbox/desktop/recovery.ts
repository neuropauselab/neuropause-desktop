/**
 * AI Sandbox — Desktop Automation (S2): failure detection + recovery.
 *
 * Classifies a run failure (app/renderer crash, timeout, missing window, blocking
 * dialog, network failure, assertion, automation error, backend unavailable), decides
 * whether it is recoverable (a launch/crash/timeout can be retried; a failed assertion
 * or a missing selector is a real failure, never "recovered" into a pass), and builds a
 * diagnostics summary the executor attaches as an artifact. Pure classification.
 */
import type { DesktopSession } from './driver';

export type DesktopFailureKind =
  | 'app_crash'
  | 'renderer_crash'
  | 'timeout'
  | 'window_missing'
  | 'dialog_blocking'
  | 'network_failure'
  | 'assertion'
  | 'automation'
  | 'unavailable';

export interface FailureClassification {
  kind: DesktopFailureKind;
  recoverable: boolean;
  message: string;
}

const RECOVERABLE: ReadonlySet<DesktopFailureKind> = new Set(['app_crash', 'renderer_crash', 'timeout', 'window_missing', 'network_failure']);

/** Classify a thrown error + the session's liveness into a failure kind. Pure. */
export function classifyDesktopFailure(err: unknown, running: boolean): FailureClassification {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  const kind = detectKind(message, name, running);
  return { kind, recoverable: RECOVERABLE.has(kind), message };
}

function detectKind(message: string, name: string, running: boolean): DesktopFailureKind {
  const m = message.toLowerCase();
  if (name === 'DesktopUnavailableError' || m.includes('requires playwright')) return 'unavailable';
  if (name === 'AssertionError' || m.startsWith('assertion') || m.includes('assert failed')) return 'assertion';
  if (!running) return 'app_crash';
  if (m.includes('renderer') && m.includes('crash')) return 'renderer_crash';
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
  if (m.includes('no window') || m.includes('window missing') || m.includes('no window appeared')) return 'window_missing';
  if (m.includes('dialog') || m.includes('modal blocked')) return 'dialog_blocking';
  if (m.includes('net::') || m.includes('econnrefused') || m.includes('enotfound') || m.includes('network')) return 'network_failure';
  if (m.includes('not found') || m.includes('disabled') || m.includes('selector')) return 'automation';
  return 'automation';
}

export interface DesktopDiagnostics {
  failure: FailureClassification;
  running: boolean;
  windows: number;
  consoleTail: string[];
}

/** Gather a best-effort diagnostics snapshot after a failure (never throws). */
export async function collectDiagnostics(session: DesktopSession | null, failure: FailureClassification): Promise<DesktopDiagnostics> {
  let running = false;
  let windows = 0;
  let consoleTail: string[] = [];
  if (session) {
    try {
      running = session.isRunning();
      windows = (await session.windows()).length;
      consoleTail = session.consoleMessages().slice(-20).map((m) => `${m.level}: ${m.text}`);
    } catch {
      /* diagnostics are best-effort */
    }
  }
  return { failure, running, windows, consoleTail };
}
