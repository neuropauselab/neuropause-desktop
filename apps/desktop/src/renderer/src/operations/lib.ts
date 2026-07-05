/**
 * Operations Center helpers — status → {label, tone} maps and formatters.
 * Pure and dependency-free; every panel and the provider share these so status
 * colours and number formatting stay consistent across the command center.
 */
import type {
  AppType,
  HealthStatus,
  NpsOperationStatus,
  PermissionState,
  PluginState,
  RuntimeStatus,
} from '@neuropause/shared';

export type OpsTone = 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'accent' | 'gray';

/** Monochrome tone system — deep black + clear white only. Status is conveyed by
 *  brightness (critical brightest) and labels, not hue. */
export const DOT_BG: Record<OpsTone, string> = {
  green: 'bg-white/70',
  orange: 'bg-white/85',
  red: 'bg-white',
  blue: 'bg-white/70',
  purple: 'bg-white/70',
  accent: 'bg-white',
  gray: 'bg-white/30',
};

export const TEXT_TONE: Record<OpsTone, string> = {
  green: 'text-white/70',
  orange: 'text-white/90',
  red: 'text-white',
  blue: 'text-white/80',
  purple: 'text-white/80',
  accent: 'text-white',
  gray: 'text-white/40',
};

export const TINT_TONE: Record<OpsTone, string> = {
  green: 'bg-white/[0.08] text-white/80',
  orange: 'bg-white/[0.12] text-white/90',
  red: 'bg-white/[0.18] text-white',
  blue: 'bg-white/[0.08] text-white/80',
  purple: 'bg-white/[0.08] text-white/80',
  accent: 'bg-white/[0.14] text-white',
  gray: 'bg-white/[0.05] text-white/40',
};

interface Meta {
  label: string;
  tone: OpsTone;
}

export function runtimeStatusMeta(s: RuntimeStatus): Meta {
  switch (s) {
    case 'running':
      return { label: 'Running', tone: 'green' };
    case 'starting':
      return { label: 'Starting', tone: 'blue' };
    case 'suspended':
      return { label: 'Sleeping', tone: 'orange' };
    case 'stopping':
      return { label: 'Stopping', tone: 'orange' };
    case 'stopped':
      return { label: 'Stopped', tone: 'gray' };
    case 'crashed':
      return { label: 'Crashed', tone: 'red' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
  }
}

export function healthMeta(h: HealthStatus): Meta {
  switch (h) {
    case 'healthy':
      return { label: 'Healthy', tone: 'green' };
    case 'degraded':
      return { label: 'Degraded', tone: 'orange' };
    case 'unhealthy':
      return { label: 'Unhealthy', tone: 'red' };
    case 'unknown':
      return { label: 'Unknown', tone: 'gray' };
  }
}

export function opStatusMeta(s: NpsOperationStatus): Meta {
  switch (s) {
    case 'queued':
      return { label: 'Queued', tone: 'gray' };
    case 'resolving':
      return { label: 'Resolving', tone: 'blue' };
    case 'downloading':
      return { label: 'Downloading', tone: 'blue' };
    case 'verifying':
      return { label: 'Verifying', tone: 'blue' };
    case 'installing':
      return { label: 'Installing', tone: 'blue' };
    case 'paused':
      return { label: 'Paused', tone: 'orange' };
    case 'completed':
      return { label: 'Completed', tone: 'green' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'gray' };
  }
}

export function pluginStateMeta(s: PluginState): Meta {
  switch (s) {
    case 'enabled':
      return { label: 'Enabled', tone: 'green' };
    case 'disabled':
      return { label: 'Disabled', tone: 'gray' };
    case 'installed':
      return { label: 'Installed', tone: 'blue' };
    case 'error':
      return { label: 'Error', tone: 'red' };
  }
}

export function permStateMeta(s: PermissionState): Meta {
  switch (s) {
    case 'granted':
      return { label: 'Granted', tone: 'green' };
    case 'denied':
      return { label: 'Denied', tone: 'red' };
    case 'revoked':
      return { label: 'Revoked', tone: 'orange' };
    case 'requested':
      return { label: 'Pending', tone: 'gray' };
  }
}

/** The runtime adapter that backs each app kind. */
export function adapterLabel(kind: AppType): string {
  switch (kind) {
    case 'web':
      return 'Web · BrowserView';
    case 'electron':
      return 'Electron';
    case 'native':
      return 'Native · Process';
    case 'desktop_plugin':
      return 'Plugin Host';
    case 'ai_agent':
      return 'Agent Runtime';
    case 'mcp_server':
      return 'MCP · stdio';
    case 'automation':
      return 'Automation';
  }
}

/* ── formatters ── */

export function formatUptime(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function pct(p: number): string {
  return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

/* ── app identity (Operations only has slug/name; derive a stable glyph+tone) ── */
import type { AppTone } from '@renderer/data/types';

const IDENTITY_TONES: AppTone[] = ['accent', 'blue', 'green', 'orange', 'purple', 'teal', 'pink'];

export function toneFor(slug: string): AppTone {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return IDENTITY_TONES[h % IDENTITY_TONES.length];
}

export function glyphFor(name: string): string {
  return (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?').toUpperCase();
}
