/**
 * Phase 6 Stage 13 — the enterprise state-coverage map (G-3).
 *
 * The honest answer to "what does the twin actually model?" Every row in
 * STATE_REGISTRY carries a citation, and this module joins each to whatever is
 * observable right now: the nine P15 domains pick up their live entity counts
 * and bands from `TwinService.domains()`, and the runtime row picks up the
 * Execute Engine's live session count. Everything else has no live reading, so
 * `live` is null — never a placeholder, never a zero standing in for "unknown".
 *
 * The `notModelled` list is the deliberate output of this view: the gaps are
 * stated, not omitted. Pure; reads injected.
 */
import type {
  EtwinCoverageMap,
  EtwinCoverageRow,
  EtwinUnavailable,
  TwinDomains,
} from '@neuropause/shared';
import { STATE_REGISTRY } from './twinRegistry';

export const COVERAGE_DISCLOSURE =
  'Coverage is a statement about the repository, not a score. `modelled-by-twin` means one of P15’s nine domains owns the state; `modelled-elsewhere` means a named module owns it outside the twin; `not-modelled` means a repository search found no owner, and each such row names the search that proved it. A null `live` reading means nothing is observable for that row — it is never rendered as zero.';

/** Registry state id → P15 domain id, for the nine rows the twin owns. */
const DOMAIN_BY_STATE: Readonly<Record<string, string>> = {
  'enterprise-posture': 'enterprise',
  organization: 'organization',
  infrastructure: 'infrastructure',
  workforce: 'workforce',
  application: 'application',
  connectors: 'connector',
  marketplace: 'marketplace',
  federation: 'federation',
  strategy: 'strategy',
};

export interface CoverageInput {
  nowIso: string;
  /** P15's own domain projection, or null when the twin could not be read. */
  domains: TwinDomains | null;
  /** The live runtime reading, or null when the Execute Engine could not be read. */
  runtime: { activeSessions: number; registeredKinds: number } | null;
  failures: Record<string, string>;
}

function liveFor(id: string, input: CoverageInput): string | null {
  const domainId = DOMAIN_BY_STATE[id];
  if (domainId !== undefined) {
    if (input.domains === null) return null;
    const d = input.domains.domains.find((x) => x.id === domainId);
    if (d === undefined) return null;
    return `${d.entityCount} entity(ies), band ${d.band}`;
  }
  if (id === 'runtime-execution') {
    if (input.runtime === null) return null;
    return `${input.runtime.activeSessions} active session(s) across ${input.runtime.registeredKinds} registered kind(s)`;
  }
  // Every other row has a named owner but no reading Stage 13 is wired to take.
  // Saying so is the point; inventing a number would not be.
  return null;
}

export function buildCoverageMap(input: CoverageInput): EtwinCoverageMap {
  const unavailable: EtwinUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const rows: EtwinCoverageRow[] = STATE_REGISTRY.map((def) => ({
    id: def.id,
    label: def.label,
    status: def.status,
    owner: def.owner,
    evidence: def.evidence,
    live: liveFor(def.id, input),
  }));

  return {
    generatedAt: input.nowIso,
    rows,
    totals: {
      total: rows.length,
      modelledByTwin: rows.filter((r) => r.status === 'modelled-by-twin').length,
      modelledElsewhere: rows.filter((r) => r.status === 'modelled-elsewhere').length,
      notModelled: rows.filter((r) => r.status === 'not-modelled').length,
    },
    notModelled: rows.filter((r) => r.status === 'not-modelled').map((r) => `${r.label} — ${r.owner}`),
    disclosure: COVERAGE_DISCLOSURE,
    unavailable,
  };
}
