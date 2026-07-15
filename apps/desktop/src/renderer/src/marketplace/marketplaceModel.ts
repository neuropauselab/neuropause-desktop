/**
 * P9 — Enterprise Marketplace renderer view-model (pure; house `*Model.ts` pattern,
 * unit-tested under Node). Presentation mappings (package type → label/icon/tone, trust
 * tiers, channels, capabilities) and small derivations for the Marketplace panels. No I/O.
 */
import type {
  InstallCapability,
  MarketplaceDecision,
  MarketplaceEntry,
  MarketplacePackageType,
  PublisherTier,
  ReleaseChannel,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

const TYPE_LABEL: Record<MarketplacePackageType, string> = {
  worker: 'Worker',
  connector: 'Connector',
  template: 'Template',
  workflow_pack: 'Workflow Pack',
  knowledge_pack: 'Knowledge Pack',
  automation_pack: 'Automation Pack',
  dashboard_pack: 'Dashboard Pack',
  policy_pack: 'Policy Pack',
  blueprint: 'Blueprint',
  prompt_pack: 'Prompt Pack',
};
export function typeLabel(t: MarketplacePackageType): string {
  return TYPE_LABEL[t] ?? t;
}

const TYPE_ICON: Record<MarketplacePackageType, IconName> = {
  worker: 'cpu',
  connector: 'connectors',
  template: 'doc',
  workflow_pack: 'automations',
  knowledge_pack: 'memory',
  automation_pack: 'bolt',
  dashboard_pack: 'gauge',
  policy_pack: 'shield',
  blueprint: 'grid',
  prompt_pack: 'sparkles',
};
export function typeIcon(t: MarketplacePackageType): IconName {
  return TYPE_ICON[t] ?? 'package';
}

const TIER_TONE: Record<PublisherTier, OpsTone> = {
  unverified: 'gray',
  verified: 'blue',
  trusted: 'purple',
  official: 'accent',
};
export function tierTone(tier: PublisherTier): OpsTone {
  return TIER_TONE[tier];
}
export function tierLabel(tier: PublisherTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function trustTone(score: number): OpsTone {
  if (score >= 0.75) return 'green';
  if (score >= 0.45) return 'orange';
  return 'red';
}

const CHANNEL_TONE: Record<ReleaseChannel, OpsTone> = {
  stable: 'green',
  beta: 'orange',
  canary: 'red',
  lts: 'blue',
};
export function channelTone(c: ReleaseChannel): OpsTone {
  return CHANNEL_TONE[c];
}

const CAPABILITY_LABEL: Record<InstallCapability, string> = {
  installable: 'Install',
  connect: 'Connect',
  import: 'Import',
  catalog: 'View',
};
export function capabilityLabel(c: InstallCapability): string {
  return CAPABILITY_LABEL[c];
}

export function decisionTone(d: MarketplaceDecision): OpsTone {
  return d === 'allow' ? 'green' : d === 'require_approval' ? 'orange' : 'red';
}

/** The primary action label for an entry, given its capability + current install state. */
export function actionLabel(e: MarketplaceEntry): string {
  if (e.installState === 'update_available') return 'Update';
  if (e.installState === 'installed') return 'Installed';
  if (e.installState === 'disabled') return 'Disabled';
  return capabilityLabel(e.capability);
}

/** Whether the primary action installs/updates (vs a passive View). */
export function isActionable(e: MarketplaceEntry): boolean {
  if (e.installState === 'update_available') return true;
  if (e.installState === 'installed' || e.installState === 'disabled') return false;
  return e.capability === 'installable' || e.capability === 'connect' || e.capability === 'import';
}

export interface TypeGroup {
  type: MarketplacePackageType;
  label: string;
  entries: MarketplaceEntry[];
}

/** Group a catalog by package type, largest group first. */
export function groupByType(entries: MarketplaceEntry[]): TypeGroup[] {
  const m = new Map<MarketplacePackageType, MarketplaceEntry[]>();
  for (const e of entries) {
    const arr = m.get(e.packageType) ?? [];
    arr.push(e);
    m.set(e.packageType, arr);
  }
  return [...m.entries()]
    .map(([type, es]) => ({ type, label: typeLabel(type), entries: es }))
    .sort((a, b) => b.entries.length - a.entries.length);
}
