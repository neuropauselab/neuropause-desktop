/**
 * P12 — Developer Center: pure presentation mappings (labels, tones, icons) for the developer
 * platform view. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type {
  ApiVisibility,
  DeveloperConsoleHealth,
  DevSdkLanguage,
  DevSdkStatus,
  DevTemplateKind,
  PlanTier,
} from '@neuropause/shared';

export function healthTone(h: DeveloperConsoleHealth): OpsTone {
  return h === 'healthy' ? 'green' : 'orange';
}

export function healthLabel(h: DeveloperConsoleHealth): string {
  return h === 'healthy' ? 'Healthy' : 'Attention';
}

export function sdkStatusTone(s: DevSdkStatus): OpsTone {
  return s === 'available' ? 'green' : s === 'beta' ? 'blue' : 'gray';
}

export function sdkStatusLabel(s: DevSdkStatus): string {
  return s === 'available' ? 'Available' : s === 'beta' ? 'Beta' : 'Planned';
}

const SDK_LANG_LABEL: Record<DevSdkLanguage, string> = {
  typescript: 'TypeScript',
  cli: 'CLI',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  dotnet: '.NET',
  rest: 'REST',
  webhooks: 'Webhooks',
};
export function sdkLangLabel(l: DevSdkLanguage): string {
  return SDK_LANG_LABEL[l];
}

export function visibilityTone(v: ApiVisibility): OpsTone {
  return v === 'public' ? 'green' : v === 'partner' ? 'blue' : 'gray';
}

/** Marketplace listing status → tone (the ListingStatus pipeline). */
export function listingStatusTone(status: string): OpsTone {
  if (status === 'published') return 'green';
  if (status === 'rejected') return 'red';
  if (status === 'draft' || status === 'rolled_back') return 'gray';
  return 'orange'; // submitted / scanning / signing / in_review / approved
}

const TEMPLATE_ICON: Record<DevTemplateKind, IconName> = {
  worker: 'cpu',
  connector: 'connectors',
  plugin: 'puzzle',
  extension: 'layers',
  automation: 'automations',
  dashboard: 'gauge',
};
export function templateIcon(k: DevTemplateKind): IconName {
  return TEMPLATE_ICON[k];
}

export function templateLabel(k: DevTemplateKind): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export function tierTone(t: PlanTier): OpsTone {
  return t === 'enterprise' ? 'purple' : t === 'pro' ? 'blue' : 'gray';
}

export function tierLabel(t: PlanTier): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function utilizationTone(pct: number): OpsTone {
  return pct >= 90 ? 'red' : pct >= 70 ? 'orange' : 'green';
}
