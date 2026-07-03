/**
 * Store helpers — pure mappers and formatters shared across the marketplace.
 * Brand logos are intentionally not reproduced; a glyph + tone gives each app a
 * stable identity (consistent with the rest of the shell).
 */
import type {
  PricingKind,
  PricingPlan,
  RuntimePermissionKey,
  StoreAppCard,
} from '@neuropause/shared';
import type { AppTone } from '@renderer/data/types';
import type { IconName } from '@renderer/components/ui/Icon';

const TONES: AppTone[] = ['accent', 'blue', 'green', 'orange', 'purple', 'teal', 'pink'];

export function toTone(tone: string | null): AppTone {
  return tone && (TONES as string[]).includes(tone) ? (tone as AppTone) : 'accent';
}

export function deriveGlyph(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

export function glyphOf(app: { iconGlyph: string | null; name: string }): string {
  return app.iconGlyph ?? deriveGlyph(app.name);
}

/* ── pricing ── */

const PRICING_LABEL: Record<PricingKind, string> = {
  free: 'Free',
  freemium: 'Freemium',
  paid: 'Paid',
  subscription: 'Subscription',
  enterprise: 'Enterprise',
};

export function pricingLabel(kind: PricingKind): string {
  return PRICING_LABEL[kind];
}

export function formatPrice(plan: PricingPlan): string {
  if (plan.priceCents === 0) return plan.interval === 'custom' ? 'Custom' : 'Free';
  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency || 'USD',
    minimumFractionDigits: plan.priceCents % 100 === 0 ? 0 : 2,
  }).format(plan.priceCents / 100);
  const suffix = plan.interval === 'month' ? '/mo' : plan.interval === 'year' ? '/yr' : '';
  return `${amount}${suffix}`;
}

/* ── sizes ── */

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ── app type ── */

const APP_TYPE_LABEL: Record<string, string> = {
  web: 'Web app',
  electron: 'Desktop app',
  native: 'Native app',
  desktop_plugin: 'Desktop plugin',
  ai_agent: 'AI agent',
  mcp_server: 'MCP server',
  automation: 'Automation',
};

export function appTypeLabel(type: string): string {
  return APP_TYPE_LABEL[type] ?? type;
}

/* ── permissions ── */

export interface PermissionMeta {
  label: string;
  icon: IconName;
  description: string;
}

export const PERMISSION_META: Record<RuntimePermissionKey, PermissionMeta> = {
  network: { label: 'Network', icon: 'globe', description: 'Make network requests to external services.' },
  filesystem_read: { label: 'Read files', icon: 'doc', description: 'Read files you explicitly share with it.' },
  filesystem_write: { label: 'Write files', icon: 'doc', description: 'Create or modify files in allowed locations.' },
  clipboard: { label: 'Clipboard', icon: 'checklist', description: 'Read from and write to the clipboard.' },
  notifications: { label: 'Notifications', icon: 'bell', description: 'Send you desktop notifications.' },
  camera: { label: 'Camera', icon: 'camera', description: 'Capture from your camera while in use.' },
  microphone: { label: 'Microphone', icon: 'mic', description: 'Capture audio from your microphone while in use.' },
  local_models: { label: 'Local models', icon: 'cpu', description: 'Run on-device AI models.' },
  automation: { label: 'Automation', icon: 'automations', description: 'Trigger and run automated workflows.' },
  background: { label: 'Background', icon: 'refresh', description: 'Keep running in the background.' },
  shell_execution: { label: 'Shell', icon: 'code', description: 'Execute local shell commands.' },
};

/* ── Phase 4 connection seam ────────────────────────────────────────────────
 * Connectors arrive in Phase 4. Until then the store exposes the *shape* of
 * connection state so cards and detail pages can render it, and a small demo
 * set marks the apps that already show as connected elsewhere in the shell.
 */
export type ConnectionStatus = 'connected' | 'available' | 'none';

const DEMO_CONNECTED = new Set(['chatgpt', 'claude', 'cursor', 'notion-ai']);
const CONNECTOR_AVAILABLE = new Set([
  'chatgpt', 'claude', 'cursor', 'notion-ai', 'gemini', 'perplexity', 'github-copilot', 'figma-ai', 'zapier',
]);

export function connectionStatus(slug: string): ConnectionStatus {
  if (DEMO_CONNECTED.has(slug)) return 'connected';
  if (CONNECTOR_AVAILABLE.has(slug)) return 'available';
  return 'none';
}

export function ratingText(app: StoreAppCard): string {
  return app.rating.count > 0 ? app.rating.average.toFixed(1) : 'New';
}

/** Literal tint classes per tone (Tailwind needs complete class strings). */
export const TONE_TINT: Record<AppTone, string> = {
  accent: 'bg-accent/15 text-accent',
  blue: 'bg-sysblue/15 text-sysblue',
  green: 'bg-sysgreen/15 text-sysgreen',
  orange: 'bg-sysorange/15 text-sysorange',
  purple: 'bg-syspurple/15 text-syspurple',
  teal: 'bg-systeal/15 text-systeal',
  pink: 'bg-syspink/15 text-syspink',
};
