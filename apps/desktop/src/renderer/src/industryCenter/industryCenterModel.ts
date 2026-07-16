/**
 * P13 — Industry Center: pure presentation mappings (tones, labels, icons) for the industry
 * solution-platform view. No React, no I/O — unit-tested under Node.
 */
import type { OpsTone } from '@renderer/operations/lib';
import type { IconName } from '@renderer/components/ui/Icon';
import type { IndustryEntityKind, IndustrySuiteStatus } from '@neuropause/shared';

export function statusTone(s: IndustrySuiteStatus): OpsTone {
  return s === 'ready' ? 'green' : s === 'partial' ? 'orange' : 'gray';
}

export function statusLabel(s: IndustrySuiteStatus): string {
  return s === 'ready' ? 'Ready' : s === 'partial' ? 'Partial' : 'Planned';
}

/** Activation fraction (0..1) → tone, aligned with the model's readiness bands. */
export function activationTone(fraction: number): OpsTone {
  return fraction >= 0.75 ? 'green' : fraction >= 0.25 ? 'orange' : 'red';
}

/** Coverage fraction (0..1) → tone (fully-shipped is green). */
export function coverageTone(fraction: number): OpsTone {
  return fraction >= 0.999 ? 'green' : fraction >= 0.5 ? 'blue' : 'gray';
}

/** A resolved entity ref → tone: active (green), shipped-but-not-wired (orange), absent (gray). */
export function refTone(ref: { present: boolean; active: boolean }): OpsTone {
  return ref.active ? 'green' : ref.present ? 'orange' : 'gray';
}

export function refLabel(ref: { present: boolean; active: boolean }): string {
  return ref.active ? 'active' : ref.present ? 'available' : 'absent';
}

/** ExecutiveKpi band → tone. */
export function kpiBandTone(band?: string): OpsTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'blue';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

const KIND_ICON: Record<IndustryEntityKind, IconName> = {
  worker: 'cpu',
  connector: 'connectors',
  compliance: 'shield',
  policy: 'lock',
  listing: 'store',
};
export function entityKindIcon(k: IndustryEntityKind): IconName {
  return KIND_ICON[k];
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
