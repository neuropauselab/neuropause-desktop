/**
 * Product Operations & Release Management v1.0 — the Product Ops model (pure data; no React, no I/O; tested).
 *
 * The Product Operations layer is a PRESENTATION LENS over existing services — it composes the already-real
 * updater, release diagnostics, feature flags, health, supervisor, crash/recovery, commercial, marketplace,
 * connector, capability-registry and module surfaces. It creates NO runtime, engine, store, or IPC channel.
 * This file only decides how that real data is labelled, toned, and summarised, and records — honestly — the
 * operational capabilities the platform does NOT have in-app (so a dashboard never fabricates them).
 */
import type {
  DiagnosticStatus,
  FeatureFlagState,
  ReleaseDiagnostics,
  SigningState,
  SystemHealthLevel,
  UpdatePhase,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

/* ── honest load-failure banner (NP-008 census F-N8-3) ──────────────────────────
 * The view loads fifteen sources with per-source fallbacks. A fallback that is
 * rendered as if it were data converts a refusal into a confident zero — the
 * exact F-5 class ("0 backups" when the truth was "backup:list was refused").
 * The failures are NAMED so the panels below read as fallback, not truth.      */

export function describeLoadFailures(failures: readonly string[]): string | null {
  if (failures.length === 0) return null;
  return `${failures.length} of the operations panels could not load: ${failures.join(', ')}. What they show below is a fallback, not verified state.`;
}

/* ── status → tone/label maps (reuse the ops tone system) ───────────────────── */

export function diagnosticTone(s: DiagnosticStatus): OpsTone {
  return s === 'ok' ? 'green' : s === 'degraded' ? 'orange' : s === 'down' ? 'red' : 'gray';
}

export function healthLevelTone(l: SystemHealthLevel): OpsTone {
  switch (l) {
    case 'healthy':
      return 'green';
    case 'degraded':
      return 'orange';
    case 'critical':
    case 'offline':
      return 'red';
    default:
      return 'gray';
  }
}

export function updatePhaseMeta(p: UpdatePhase): { label: string; tone: OpsTone } {
  switch (p) {
    case 'idle':
      return { label: 'Idle', tone: 'gray' };
    case 'checking':
      return { label: 'Checking', tone: 'blue' };
    case 'available':
      return { label: 'Update available', tone: 'orange' };
    case 'not-available':
      return { label: 'Up to date', tone: 'green' };
    case 'downloading':
      return { label: 'Downloading', tone: 'blue' };
    case 'downloaded':
      return { label: 'Ready to install', tone: 'green' };
    case 'error':
      return { label: 'Update error', tone: 'red' };
  }
}

export function signingMeta(s: SigningState): { label: string; tone: OpsTone } {
  switch (s) {
    case 'signed-notarized':
      return { label: 'Signed & notarized', tone: 'green' };
    case 'signed':
      return { label: 'Signed', tone: 'green' };
    case 'unsigned':
      return { label: 'Unsigned', tone: 'orange' };
    case 'not-applicable':
      return { label: 'N/A (dev)', tone: 'gray' };
    default:
      return { label: 'Unknown', tone: 'gray' };
  }
}

/** A feature-flag source, made human-readable for the Feature Management surface. */
export function flagSourceLabel(source: FeatureFlagState['source']): string {
  switch (source) {
    case 'default':
      return 'Default';
    case 'override':
      return 'Override';
    case 'plan':
      return 'Plan-gated';
    default:
      return String(source);
  }
}

/* ── the honest operational-gap catalog (verified ABSENT in-app; never fabricated) ── */

export type GapKind = 'external' | 'not-in-app' | 'roadmap';
export interface OperationalGap {
  area: string;
  capability: string;
  kind: GapKind;
  reason: string;
}

/**
 * Operational capabilities the platform does NOT surface as in-app data, recorded transparently (the
 * Configuration Visibility Principle applied to operations). Each was verified ABSENT from source during
 * recon. Deployment-target honesty lives separately in DEPLOYMENT_TARGETS.
 */
export const OPERATIONAL_GAPS: OperationalGap[] = [
  { area: 'Engineering', capability: 'Test results, coverage, typecheck, lint, regression history', kind: 'external', reason: 'CI/dev-time facts; the running app has no access to its own build pipeline. Only build identity (version/commit/channel/buildTime) is in-app.' },
  { area: 'Engineering', capability: 'Build-quality trend', kind: 'external', reason: 'Produced by CI; not tracked in-app.' },
  { area: 'Support', capability: 'Known issues / resolved issues', kind: 'not-in-app', reason: 'No in-app issue store; local Feedback capture exists instead.' },
  { area: 'Support', capability: 'Support articles / knowledge base', kind: 'not-in-app', reason: 'No in-app KB; documentation is external.' },
  { area: 'Commercial', capability: 'Revenue, MRR, ARR, churn, customer count', kind: 'not-in-app', reason: 'No SaaS MRR / ARR / churn or customer count; only a marketplace-purchase revenue ledger ($0 by default) exists, shown in the Commercial Center — not surfaced here.' },
  { area: 'Commercial', capability: 'Invoice history', kind: 'not-in-app', reason: 'Only an on-demand computed draft invoice exists; no persisted invoice list.' },
  { area: 'Commercial', capability: 'Partner / reseller accounts', kind: 'not-in-app', reason: 'Demo-only fixture, disabled in production builds.' },
  { area: 'Release', capability: 'App-version rollback / downgrade', kind: 'not-in-app', reason: 'The updater runs with downgrade disabled; only data backup & restore is supported.' },
];

export function gapKindMeta(k: GapKind): { label: string; tone: OpsTone; icon: IconName } {
  switch (k) {
    case 'external':
      return { label: 'External / CI', tone: 'blue', icon: 'code' };
    case 'roadmap':
      return { label: 'Roadmap', tone: 'orange', icon: 'sparkles' };
    case 'not-in-app':
    default:
      return { label: 'Not in-app', tone: 'gray', icon: 'info' };
  }
}

/* ── the verified deployment-target map (from electron-builder + backend + recon) ── */

export type TargetStatus = 'shipping' | 'supported' | 'roadmap' | 'unsupported';
export interface DeploymentTarget {
  id: string;
  label: string;
  status: TargetStatus;
  detail: string;
  icon: IconName;
}

/** Verified deployment reality — what actually ships vs what is roadmap/unsupported. No fabricated modes. */
export const DEPLOYMENT_TARGETS: DeploymentTarget[] = [
  { id: 'desktop-mac', label: 'Desktop · macOS (arm64)', status: 'shipping', detail: 'First-class electron-builder target (dmg + zip).', icon: 'workspace' },
  { id: 'desktop-win', label: 'Desktop · Windows (x64)', status: 'shipping', detail: 'electron-builder target (nsis + zip + portable).', icon: 'workspace' },
  { id: 'desktop-linux', label: 'Desktop · Linux', status: 'unsupported', detail: 'No electron-builder Linux target; cannot launch headless.', icon: 'workspace' },
  { id: 'cloud', label: 'Cloud (backend)', status: 'shipping', detail: 'Real Express + Postgres + Redis backend (Docker); live sync.', icon: 'database' },
  { id: 'offline', label: 'Offline / local-first', status: 'shipping', detail: 'Atomic local stores + durable sync outbox + cached license.', icon: 'server' },
  { id: 'hybrid', label: 'Hybrid / private cloud', status: 'roadmap', detail: 'Catalog label only; no provisioning backing today.', icon: 'globe' },
  { id: 'edge', label: 'Edge', status: 'roadmap', detail: 'Not implemented; no edge runtime.', icon: 'globe' },
  { id: 'mdm', label: 'Enterprise-managed (MDM)', status: 'roadmap', detail: 'No MDM/policy integration; only NSIS silent-install a third-party MDM could push.', icon: 'shield' },
];

export function targetStatusMeta(s: TargetStatus): { label: string; tone: OpsTone } {
  switch (s) {
    case 'shipping':
      return { label: 'Shipping', tone: 'green' };
    case 'supported':
      return { label: 'Supported', tone: 'green' };
    case 'roadmap':
      return { label: 'Roadmap', tone: 'orange' };
    case 'unsupported':
    default:
      return { label: 'Unsupported', tone: 'gray' };
  }
}

/* ── release readiness (pure derivation over the real Release Diagnostics + flags) ── */

export interface ReleaseReadiness {
  version: string;
  channel: string;
  commit: string;
  packaged: boolean;
  signed: boolean;
  signingLabel: string;
  updateLabel: string;
  updateTone: OpsTone;
  flagsEnabled: number;
  flagsTotal: number;
  /** True when the build is a signed, packaged release with no update error. */
  releaseReady: boolean;
  /** Honest blockers to a clean production release (empty when ready). */
  blockers: string[];
}

export function deriveReleaseReadiness(
  diag: ReleaseDiagnostics,
  flags: FeatureFlagState[],
): ReleaseReadiness {
  const sign = signingMeta(diag.signing.state);
  const upd = updatePhaseMeta(diag.update.phase);
  const blockers: string[] = [];
  if (!diag.build.packaged) blockers.push('Unpackaged development build');
  if (!diag.signing.signed && diag.build.packaged) blockers.push('Build is not code-signed');
  if (diag.update.phase === 'error') blockers.push(`Updater error: ${diag.update.error ?? 'unknown'}`);
  return {
    version: diag.build.version,
    channel: diag.build.channel,
    commit: diag.build.commit,
    packaged: diag.build.packaged,
    signed: diag.signing.signed,
    signingLabel: sign.label,
    updateLabel: upd.label,
    updateTone: upd.tone,
    flagsEnabled: flags.filter((f) => f.enabled).length,
    flagsTotal: flags.length,
    releaseReady: blockers.length === 0,
    blockers,
  };
}
