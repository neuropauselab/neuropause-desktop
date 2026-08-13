/**
 * Home view-model (Mobile M1-09) — PURE derivations from the desktop's real
 * executive briefing (briefing.get). No RN; unit-tested in plain Node. The Home
 * screen renders exactly what these return, so the phone never invents numbers.
 */
import type { CompanionBriefing } from '@neuropause/shared';

export type HomeBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

export interface HomeTile {
  key: string;
  label: string;
  value: string;
  band: HomeBand;
  /** True when the tile is calling for attention (drives the accent border). */
  emphasis: boolean;
}

/** "Good morning" / "Good evening" from the briefing period. */
export function greeting(period: CompanionBriefing['period']): string {
  return period === 'morning' ? 'Good morning' : 'Good evening';
}

/** Total live records across every family in the briefing. */
export function totalRecords(briefing: CompanionBriefing): number {
  return briefing.families.reduce((sum, f) => sum + f.recordCount, 0);
}

/** Compact large counts (1200 → "1.2k", 3_400_000 → "3.4M"). */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Band for the "waiting on you" tile: 0 healthy, 1–4 watch, 5+ at-risk. */
export function approvalsBand(pending: number): HomeBand {
  if (pending <= 0) return 'healthy';
  return pending >= 5 ? 'at-risk' : 'watch';
}

/** The three headline stat tiles on Home, in display order. */
export function homeTiles(briefing: CompanionBriefing): HomeTile[] {
  const pending = briefing.pendingApprovals;
  return [
    {
      key: 'approvals',
      label: 'Waiting on you',
      value: String(pending),
      band: approvalsBand(pending),
      emphasis: pending > 0,
    },
    {
      key: 'families',
      label: 'Active families',
      value: String(briefing.families.length),
      band: 'healthy',
      emphasis: false,
    },
    {
      key: 'records',
      label: 'Live records',
      value: compactCount(totalRecords(briefing)),
      band: 'healthy',
      emphasis: false,
    },
  ];
}
