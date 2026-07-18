/**
 * Platform Ecosystem (Phase 5) — overview model + tab registry.
 *
 * The control-plane counterpart to the org-facing Ecosystem storefront: one reuse-only
 * lens that unifies the platform's extensibility surfaces (extensions, developer,
 * marketplace, AI agents, connectors, partners, governance, analytics) with an honest
 * gap catalog. It REUSES the AI Operations `OpLens` contract; every tab model is a pure
 * derivation over EXISTING `ipc.*` data, and every capability the ecosystem does not
 * genuinely have is a labeled gap, never fabricated. Adds no runtime, IPC, or store.
 */
import type { IconName } from '@renderer/components/ui/Icon';
import { type OpLens, type OpsTone } from '@renderer/aiOperations/aiOperationsModel';

export type EcoTab =
  | 'overview'
  | 'extensions'
  | 'developer'
  | 'marketplace'
  | 'agents'
  | 'connectors'
  | 'partners'
  | 'governance'
  | 'analytics';

/** One ecosystem area, summarized for the Overview grid. */
export interface EcoArea {
  key: EcoTab;
  label: string;
  icon: IconName;
  headline: string;
  gaps: number;
  tone: OpsTone;
}

/** Canonical order + labels/icons of the ecosystem areas (drives Overview + tab bar). */
export const ECO_AREAS: { key: EcoTab; label: string; icon: IconName }[] = [
  { key: 'extensions', label: 'Extensions', icon: 'puzzle' },
  { key: 'developer', label: 'Developer', icon: 'code' },
  { key: 'marketplace', label: 'Marketplace', icon: 'store' },
  { key: 'agents', label: 'AI Agents', icon: 'cpu' },
  { key: 'connectors', label: 'Connectors', icon: 'connectors' },
  { key: 'partners', label: 'Partners', icon: 'globe' },
  { key: 'governance', label: 'Governance', icon: 'shield' },
  { key: 'analytics', label: 'Analytics', icon: 'analytics' },
];

/**
 * Derive the ecosystem overview from the already-computed tab lenses. Each area's
 * headline is that lens's first real stat (or an honest "No live data yet"), and the
 * gap count is the lens's honest-gap list length. No new data, no fabrication.
 */
export function ecosystemAreas(lenses: Partial<Record<EcoTab, OpLens>>): EcoArea[] {
  return ECO_AREAS.map(({ key, label, icon }) => {
    const lens = lenses[key];
    const s0 = lens?.stats?.[0];
    return {
      key,
      label,
      icon,
      headline: s0 ? `${s0.label}: ${s0.value}` : 'No live data yet',
      gaps: lens?.gaps?.length ?? 0,
      tone: s0?.tone ?? 'gray',
    };
  });
}
