/**
 * P10 — Federation Center: pure presentation mappings (labels, tones, icons) for the
 * federation platform view. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type {
  ExchangeScope,
  FederationGraphNodeKind,
  FederationRole,
  FederationSearchKind,
  FederationStatus,
  FederationTimelineKind,
  FedPolicyEffect,
  OrgHealth,
  TrustLevel,
} from '@neuropause/shared';

export function trustTone(level: TrustLevel): OpsTone {
  switch (level) {
    case 'full':
      return 'green';
    case 'verified':
      return 'blue';
    case 'basic':
      return 'orange';
    default:
      return 'gray';
  }
}

export function trustLabel(level: TrustLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function healthTone(h: OrgHealth): OpsTone {
  return h === 'healthy' ? 'green' : h === 'attention' ? 'orange' : 'gray';
}

export function healthLabel(h: OrgHealth): string {
  return h === 'healthy' ? 'Healthy' : h === 'attention' ? 'Attention' : 'Inactive';
}

export function statusTone(s: FederationStatus): OpsTone {
  return s === 'active' ? 'green' : s === 'invited' ? 'blue' : 'red';
}

export function roleLabel(r: FederationRole): string {
  return r === 'home' ? 'Home' : 'Peer';
}

const TIMELINE_META: Record<FederationTimelineKind, { label: string; icon: IconName; tone: OpsTone }> = {
  invitation: { label: 'Invitation', icon: 'user', tone: 'blue' },
  trust_change: { label: 'Trust', icon: 'shield', tone: 'purple' },
  resource_share: { label: 'Share', icon: 'layers', tone: 'accent' },
  artifact_publish: { label: 'Publish', icon: 'package', tone: 'green' },
  governance: { label: 'Governance', icon: 'clipboard', tone: 'orange' },
};
export function timelineLabel(k: FederationTimelineKind): string {
  return TIMELINE_META[k].label;
}
export function timelineIcon(k: FederationTimelineKind): IconName {
  return TIMELINE_META[k].icon;
}
export function timelineTone(k: FederationTimelineKind): OpsTone {
  return TIMELINE_META[k].tone;
}

export function decisionTone(d: FedPolicyEffect): OpsTone {
  return d === 'allow' ? 'green' : d === 'require_approval' ? 'orange' : 'red';
}
export function decisionLabel(d: FedPolicyEffect): string {
  return d === 'allow' ? 'Allow' : d === 'require_approval' ? 'Approval' : 'Deny';
}

const NODE_ICON: Record<FederationGraphNodeKind, IconName> = {
  organization: 'globe',
  artifact: 'package',
  shared_resource: 'layers',
};
export function nodeIcon(k: FederationGraphNodeKind): IconName {
  return NODE_ICON[k];
}
export function nodeTone(k: FederationGraphNodeKind): OpsTone {
  return k === 'organization' ? 'blue' : k === 'artifact' ? 'green' : 'accent';
}

const SEARCH_META: Record<FederationSearchKind, { label: string; icon: IconName }> = {
  organization: { label: 'Organization', icon: 'globe' },
  artifact: { label: 'Package', icon: 'package' },
  policy: { label: 'Policy', icon: 'shield' },
  shared_resource: { label: 'Shared', icon: 'layers' },
};
export function searchLabel(k: FederationSearchKind): string {
  return SEARCH_META[k].label;
}
export function searchIcon(k: FederationSearchKind): IconName {
  return SEARCH_META[k].icon;
}

export function scopeTone(s: ExchangeScope): OpsTone {
  switch (s) {
    case 'public':
      return 'green';
    case 'partner':
      return 'blue';
    case 'regional':
      return 'purple';
    default:
      return 'gray';
  }
}
