/**
 * Release diagnostics, signing status, and crash reporting contracts.
 *
 * Release diagnostics composes the existing component-health DiagnosticsReport
 * (see platform.ts) with build identity, code-signing status, and self-update
 * status into one operator-facing report.
 */
import type { DiagnosticsReport } from './platform';
import type { UpdateChannel, UpdateStatus } from './update';

/** The exact identity of a build (mirrors main/buildInfo.ts BuildInfo). */
export interface BuildIdentity {
  version: string;
  channel: UpdateChannel;
  commit: string;
  buildTime: string;
  platform: string;
  arch: string;
  packaged: boolean;
  runtime: { electron: string; node: string; chrome: string; v8: string };
}

export type SigningState =
  | 'signed-notarized'
  | 'signed'
  | 'unsigned'
  | 'unknown'
  | 'not-applicable';

/** Result of a best-effort runtime code-signing / notarization probe. */
export interface SigningStatus {
  state: SigningState;
  signed: boolean;
  /** null when notarization could not be determined on this platform. */
  notarized: boolean | null;
  authority: string | null;
  detail: string | null;
}

/** An installed unit (app or plugin) surfaced in diagnostics + support bundle. */
export interface InstalledModule {
  name: string;
  kind: 'app' | 'plugin';
  version: string | null;
  enabled: boolean;
}

/** The full Release Diagnostics report. */
export interface ReleaseDiagnostics {
  generatedAt: string;
  build: BuildIdentity;
  signing: SigningStatus;
  update: UpdateStatus;
  health: DiagnosticsReport;
  modules: InstalledModule[];
  connectors: { id: string; name: string; status: string }[];
}

/** Where a captured fault originated. */
export type CrashCategory = 'main' | 'renderer' | 'worker' | 'plugin' | 'connector';

/** A single captured fault from the local crash archive. */
export interface CrashRecord {
  at: string;
  category: CrashCategory;
  kind: string;
  message: string;
  stack: string | null;
}

/** Opt-in state + a window of recent crashes. */
export interface CrashStatus {
  /** Whether the user has opted in to native crash capture (default false). */
  optedIn: boolean;
  /** Whether native Electron crash capture is active this session. */
  nativeActive: boolean;
  total: number;
  recent: CrashRecord[];
}

/** An actionable suggestion derived from recent crash patterns. */
export interface RecoveryRecommendation {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  /** A Recovery Center action id the user can run, if applicable. */
  action: string | null;
}
