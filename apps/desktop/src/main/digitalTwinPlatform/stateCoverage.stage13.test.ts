/**
 * Phase 6 Stage 13 — the enterprise state-coverage map (G-3).
 *
 * The honest answer to "what does the twin actually model?". These tests lock
 * the one thing a coverage map can most easily get wrong: presenting "no reading
 * is wired for this row" as `0`. A null `live` is the whole point — nine rows
 * pick up P15's live domain counts, one picks up the Execute Engine's live
 * session reading, and the other twelve say nothing rather than saying zero.
 *
 * The `notModelled` list is checked as an OUTPUT, not an omission: the three
 * gaps must be stated in full, with the owner text that says what closing them
 * would require.
 *
 * Everything here is deterministic: fixtures are literals, no clock is read.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseTwinDomain, TwinBand, TwinDomainId, TwinDomains } from '@neuropause/shared';
import { buildCoverageMap, COVERAGE_DISCLOSURE, type CoverageInput } from './stateCoverage';
import { STATE_REGISTRY } from './twinRegistry';

const NOW = '2026-08-01T09:00:00.000Z';

/** The nine P15 domain ids, in the order STATE_REGISTRY carries them. */
const NINE: { state: string; domain: TwinDomainId }[] = [
  { state: 'enterprise-posture', domain: 'enterprise' },
  { state: 'organization', domain: 'organization' },
  { state: 'infrastructure', domain: 'infrastructure' },
  { state: 'workforce', domain: 'workforce' },
  { state: 'application', domain: 'application' },
  { state: 'connectors', domain: 'connector' },
  { state: 'marketplace', domain: 'marketplace' },
  { state: 'federation', domain: 'federation' },
  { state: 'strategy', domain: 'strategy' },
];

function mkDomain(id: TwinDomainId, entityCount: number, band: TwinBand): EnterpriseTwinDomain {
  return {
    id,
    name: id,
    description: `${id} domain`,
    entityCount,
    band,
    status: 'ok',
    metrics: [],
    source: 'twinModel',
    live: true,
  };
}

/** All nine domains present, each with a distinct count so a mix-up would show. */
const DOMAINS: TwinDomains = {
  domains: NINE.map((n, i) => mkDomain(n.domain, (i + 1) * 10, i === 0 ? 'healthy' : 'watch')),
  totalEntities: 450,
  healthyDomains: 1,
  degradedDomains: 8,
};

function mkInput(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    nowIso: NOW,
    domains: DOMAINS,
    runtime: { activeSessions: 3, registeredKinds: 10 },
    failures: {},
    ...over,
  };
}

describe('the map covers the whole registry, verbatim', () => {
  it('emits one row per registry state, in registry order, carrying label/status/owner/evidence unchanged', () => {
    const map = buildCoverageMap(mkInput());
    expect(map.rows).toHaveLength(22);
    expect(map.rows.map((r) => r.id)).toEqual(STATE_REGISTRY.map((s) => s.id));
    for (const def of STATE_REGISTRY) {
      const row = map.rows.find((r) => r.id === def.id)!;
      expect(row.label, def.id).toBe(def.label);
      expect(row.status, def.id).toBe(def.status);
      expect(row.owner, def.id).toBe(def.owner);
      expect(row.evidence, def.id).toBe(def.evidence);
    }
  });

  it('reports the coverage split as counts over the rows it emitted', () => {
    const map = buildCoverageMap(mkInput());
    expect(map.totals).toEqual({
      total: 22,
      modelledByTwin: 9,
      modelledElsewhere: 10,
      notModelled: 3,
    });
    expect(map.totals.modelledByTwin + map.totals.modelledElsewhere + map.totals.notModelled).toBe(
      map.totals.total,
    );
  });
});

describe('the nine twin-owned rows pick up P15’s live reading', () => {
  it('joins each state to its P15 domain’s entity count and band', () => {
    const map = buildCoverageMap(mkInput());
    const byId = new Map(map.rows.map((r) => [r.id, r]));
    expect(byId.get('enterprise-posture')!.live).toBe('10 entity(ies), band healthy');
    expect(byId.get('organization')!.live).toBe('20 entity(ies), band watch');
    // The registry id and the P15 domain id differ here (`connectors` vs
    // `connector`); the mapping must survive that.
    expect(byId.get('connectors')!.live).toBe('60 entity(ies), band watch');
    expect(byId.get('strategy')!.live).toBe('90 entity(ies), band watch');
  });

  it('gives all nine — and only those nine — a live reading from the domain projection', () => {
    const map = buildCoverageMap(mkInput({ runtime: null }));
    const withLive = map.rows.filter((r) => r.live !== null).map((r) => r.id);
    expect(withLive).toEqual(NINE.map((n) => n.state));
  });

  it('reports a domain P15 did not project as null, NOT as zero entities', () => {
    const partial: TwinDomains = {
      ...DOMAINS,
      domains: DOMAINS.domains.filter((d) => d.id !== 'marketplace'),
    };
    const map = buildCoverageMap(mkInput({ domains: partial }));
    const marketplace = map.rows.find((r) => r.id === 'marketplace')!;
    expect(marketplace.live).toBeNull();
    // A missing domain must not be reported as an empty one.
    expect(marketplace.live).not.toBe('0 entity(ies), band healthy');
  });

  it('reports a genuinely empty domain as zero — an observed zero is a reading, not an absence', () => {
    const withEmpty: TwinDomains = {
      ...DOMAINS,
      domains: DOMAINS.domains.map((d) =>
        d.id === 'marketplace' ? mkDomain('marketplace', 0, 'at-risk') : d,
      ),
    };
    const map = buildCoverageMap(mkInput({ domains: withEmpty }));
    expect(map.rows.find((r) => r.id === 'marketplace')!.live).toBe('0 entity(ies), band at-risk');
  });

  it('nulls all nine when the twin could not be read at all', () => {
    const map = buildCoverageMap(mkInput({ domains: null }));
    for (const n of NINE) {
      expect(map.rows.find((r) => r.id === n.state)!.live, n.state).toBeNull();
    }
    // ...and does not disturb the runtime row.
    expect(map.rows.find((r) => r.id === 'runtime-execution')!.live).not.toBeNull();
  });
});

describe('the runtime row picks up the Execute Engine reading', () => {
  it('states active sessions across registered kinds', () => {
    const map = buildCoverageMap(mkInput());
    expect(map.rows.find((r) => r.id === 'runtime-execution')!.live).toBe(
      '3 active session(s) across 10 registered kind(s)',
    );
  });

  it('reports an idle engine honestly — zero sessions is an observation', () => {
    const map = buildCoverageMap(mkInput({ runtime: { activeSessions: 0, registeredKinds: 10 } }));
    expect(map.rows.find((r) => r.id === 'runtime-execution')!.live).toBe(
      '0 active session(s) across 10 registered kind(s)',
    );
  });

  it('reports an unreadable engine as null rather than as an idle one', () => {
    const map = buildCoverageMap(mkInput({ runtime: null }));
    expect(map.rows.find((r) => r.id === 'runtime-execution')!.live).toBeNull();
  });
});

describe('every other row says nothing rather than saying zero', () => {
  it('leaves live null on all twelve rows Stage 13 is not wired to read', () => {
    const map = buildCoverageMap(mkInput());
    const readable = new Set([...NINE.map((n) => n.state), 'runtime-execution']);
    const rest = map.rows.filter((r) => !readable.has(r.id));
    expect(rest).toHaveLength(12);
    for (const row of rest) {
      expect(row.live, row.id).toBeNull();
      expect(row.live, row.id).not.toBe('0');
    }
  });

  it('still names an owner and cites evidence on every one of those twelve', () => {
    const map = buildCoverageMap(mkInput());
    const readable = new Set([...NINE.map((n) => n.state), 'runtime-execution']);
    for (const row of map.rows.filter((r) => !readable.has(r.id))) {
      expect(row.owner.length, row.id).toBeGreaterThan(0);
      expect(row.evidence.length, row.id).toBeGreaterThan(0);
    }
  });

  it('nulls every live reading when nothing at all could be read', () => {
    const map = buildCoverageMap(mkInput({ domains: null, runtime: null }));
    for (const row of map.rows) expect(row.live, row.id).toBeNull();
    // The map itself is still complete — unreadable inputs shrink no row list.
    expect(map.rows).toHaveLength(22);
    expect(map.totals.total).toBe(22);
  });
});

describe('the gaps are the output, not an omission', () => {
  it('lists exactly the three not-modelled states as “label — owner”', () => {
    const map = buildCoverageMap(mkInput());
    expect(map.notModelled).toEqual([
      'Physical sensor telemetry — None. Would require a telemetry ingestion path and a time-series store.',
      'Facilities & geography — None. Would require a spatial model (sites, layouts, coordinates).',
      'Energy & environmental — None. Would require metered consumption input.',
    ]);
  });

  it('keeps the gap list stated whether or not any input was readable', () => {
    const blind = buildCoverageMap(mkInput({ domains: null, runtime: null }));
    expect(blind.notModelled).toEqual(buildCoverageMap(mkInput()).notModelled);
    expect(blind.notModelled).toHaveLength(3);
  });

  it('keeps the gap list in step with the registry rather than hard-coding it', () => {
    const map = buildCoverageMap(mkInput());
    expect(map.notModelled).toEqual(
      STATE_REGISTRY.filter((s) => s.status === 'not-modelled').map((s) => `${s.label} — ${s.owner}`),
    );
  });
});

describe('the view’s own contract', () => {
  it('projects every failure it was handed as a declared unavailability', () => {
    const map = buildCoverageMap(
      mkInput({
        domains: null,
        failures: { 'p15-twin': 'domains() threw', 'execute-engine': 'not started' },
      }),
    );
    expect(map.unavailable).toEqual([
      { system: 'p15-twin', reason: 'domains() threw' },
      { system: 'execute-engine', reason: 'not started' },
    ]);
  });

  it('stamps the caller’s time and carries the disclosure', () => {
    const map = buildCoverageMap(mkInput());
    expect(map.generatedAt).toBe(NOW);
    expect(map.disclosure).toBe(COVERAGE_DISCLOSURE);
    expect(map.disclosure).toContain('never rendered as zero');
    expect(map.disclosure).toContain('not a score');
  });

  it('is deterministic — the same input composes byte-identical output', () => {
    expect(buildCoverageMap(mkInput())).toEqual(buildCoverageMap(mkInput()));
  });
});
