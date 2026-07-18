import { describe, it, expect } from 'vitest';
import { summarizeConnectors, type ConnectorsInput } from './connectorsModel';

type Lens = ReturnType<typeof summarizeConnectors>;
const stat = (lens: Lens, label: string) => lens.stats.find((s) => s.label === label);
const group = (lens: Lens, title: string) => lens.groups.find((g) => g.title === title);
const row = (lens: Lens, title: string, label: string) =>
  group(lens, title)?.rows.find((r) => r.label === label);

const REGISTRY_GROUP = 'Registry & health (real)';

/**
 * A fully-populated input mirroring both real ipc sources: a registry list with a
 * production/preview MIX (ipc.connectors.list) and the account-level aggregates
 * (ipc.connectors.stats). production=3, preview=2, total=5; 4 connected accounts,
 * 3 healthy / 1 degraded / 0 down.
 */
const FULL: ConnectorsInput = {
  stats: { total: 5, configured: 3, connected: 2, accounts: 4, healthy: 3, degraded: 1, down: 0 },
  connectors: [
    {
      id: 'github',
      lifecycle: 'production',
      status: 'connected',
      health: 'healthy',
      configured: true,
      accounts: [{}, {}],
    },
    {
      id: 'notion',
      lifecycle: 'production',
      status: 'connected',
      health: 'degraded',
      configured: true,
      accounts: [{}],
    },
    {
      id: 'slack',
      lifecycle: 'production',
      status: 'disconnected',
      health: 'unknown',
      configured: true,
      accounts: [],
    },
    {
      id: 'figma',
      lifecycle: 'preview',
      status: 'unavailable',
      health: 'unknown',
      configured: false,
      accounts: [],
    },
    {
      id: 'linear',
      lifecycle: 'preview',
      status: 'unavailable',
      health: 'unknown',
      configured: false,
      accounts: [],
    },
  ],
};

describe('summarizeConnectors — populated (real fields → real stats/rows)', () => {
  const lens = summarizeConnectors(FULL);

  it('emits exactly the 4 headline stats and the single registry group (contract bounds)', () => {
    expect(lens.stats).toHaveLength(4);
    expect(lens.stats.length).toBeGreaterThanOrEqual(2);
    expect(lens.stats.length).toBeLessThanOrEqual(4);
    expect(lens.groups).toHaveLength(1);
  });

  it('connectors stat reads the registry total with the production/preview split as its hint', () => {
    const s = stat(lens, 'Connectors');
    expect(s?.value).toBe('5');
    expect(s?.hint).toBe('3 production · 2 preview');
    expect(s?.icon).toBe('connectors');
  });

  it('production stat reads the real-adapter lifecycle split and carries no tone', () => {
    const s = stat(lens, 'Production connectors');
    expect(s?.value).toBe('3'); // lifecycle==='production' × 3
    expect(s?.hint).toBe('2 preview (catalog-only)');
    // Composition, not health — preview must never be painted as a fault.
    expect(s?.tone).toBeUndefined();
  });

  it('connected stat reads ConnectorStats.connected + account count', () => {
    const s = stat(lens, 'Connected');
    expect(s?.value).toBe('2');
    expect(s?.hint).toBe('4 accounts');
  });

  it('account-health stat reads ConnectorStats account tallies as a healthy share', () => {
    const s = stat(lens, 'Account health');
    // 3 healthy of (3+1+0)=4 known → 0.75 → 75% → healthTone → orange
    expect(s?.value).toBe('75%');
    expect(s?.tone).toBe('orange');
    expect(s?.hint).toBe('3/4 accounts healthy');
  });

  it("'Registry & health (real)' group splits production vs preview with an honest note", () => {
    expect(row(lens, REGISTRY_GROUP, 'Production (real adapter)')?.value).toBe('3/5');
    const previewRow = row(lens, REGISTRY_GROUP, 'Preview (catalog-only)');
    expect(previewRow?.value).toBe('2');
    expect(previewRow?.sub).toBe('not connectable — no data adapter yet');
    const note = group(lens, REGISTRY_GROUP)?.note ?? '';
    expect(note).toContain('catalog-only');
    expect(note).toContain('connected accounts, not connectors');
  });

  it("'Registry & health (real)' group carries the account health rows", () => {
    expect(row(lens, REGISTRY_GROUP, 'Connected')?.value).toBe('2/5');
    const healthyRow = row(lens, REGISTRY_GROUP, 'Accounts healthy');
    expect(healthyRow?.value).toBe('3/4');
    expect(healthyRow?.tone).toBe('orange');
    expect(row(lens, REGISTRY_GROUP, 'Accounts degraded')?.value).toBe('1');
    expect(row(lens, REGISTRY_GROUP, 'Accounts degraded')?.tone).toBe('orange');
    // down === 0 → no fabricated "Accounts down" row.
    expect(row(lens, REGISTRY_GROUP, 'Accounts down')).toBeUndefined();
  });

  it('never surfaces the marketplace "certified" badge as a live-connector signal', () => {
    const surfaced = [
      ...lens.stats.flatMap((s) => [s.label, s.value, s.hint ?? '']),
      ...lens.groups.flatMap((g) => [
        g.title,
        g.note ?? '',
        ...g.rows.flatMap((r) => [r.label, r.value, r.sub ?? '']),
      ]),
    ].join(' | ');
    expect(surfaced.toLowerCase()).not.toContain('certified');
    // The only place certification is mentioned is the honest gap.
    expect(lens.gaps.some((g) => g.requires.includes('certified'))).toBe(true);
  });

  it('always encodes the three honest gaps and the single Connectors deep-link', () => {
    expect(lens.gaps.map((g) => g.capability)).toEqual([
      'Connector certification',
      'Version/semver compatibility',
      'Connector-scoped deployment profiles',
    ]);
    expect(lens.gaps[0].requires).toContain('marketplace listings');
    expect(lens.gaps[1].requires).toContain('display-only');
    expect(lens.gaps[2].requires).toContain('commercial catalog');
    expect(lens.links).toEqual([{ label: 'Connectors', section: 'connectors' }]);
  });
});

describe('summarizeConnectors — honest empty state', () => {
  it('empty object → no stats, no groups, but the three gaps + link still present', () => {
    const lens = summarizeConnectors({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
    expect(lens.links).toHaveLength(1);
  });

  it('unpopulated (empty stats object + empty list) sources degrade to empty — no placeholders', () => {
    const lens = summarizeConnectors({ stats: {}, connectors: [] });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
  });

  it('undefined input does not throw and still lists the gaps', () => {
    const lens = summarizeConnectors(undefined as unknown as ConnectorsInput);
    expect(lens.stats).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
  });
});

describe('summarizeConnectors — honest partial states', () => {
  it('registry-only (list present, nothing connected) shows the split but no fabricated health', () => {
    const lens = summarizeConnectors({
      stats: {
        total: 22,
        configured: 8,
        connected: 0,
        accounts: 0,
        healthy: 0,
        degraded: 0,
        down: 0,
      },
      connectors: [
        ...Array.from({ length: 13 }, (_, i) => ({
          id: `p${i}`,
          lifecycle: 'production' as const,
          status: 'disconnected' as const,
          accounts: [],
        })),
        ...Array.from({ length: 9 }, (_, i) => ({
          id: `v${i}`,
          lifecycle: 'preview' as const,
          status: 'unavailable' as const,
          accounts: [],
        })),
      ],
    });
    // Only registry composition is known: Connectors + Production stats, no connection/health.
    expect(stat(lens, 'Connectors')?.value).toBe('22');
    expect(stat(lens, 'Connectors')?.hint).toBe('13 production · 9 preview');
    expect(stat(lens, 'Production connectors')?.value).toBe('13');
    expect(stat(lens, 'Connected')).toBeUndefined();
    expect(stat(lens, 'Account health')).toBeUndefined();
    // Group carries the split but no health rows, and the note omits the account caveat.
    expect(row(lens, REGISTRY_GROUP, 'Production (real adapter)')?.value).toBe('13/22');
    expect(row(lens, REGISTRY_GROUP, 'Accounts healthy')).toBeUndefined();
    expect(group(lens, REGISTRY_GROUP)?.note).not.toContain('connected accounts');
  });

  it('stats-only (no list) knows the total but cannot derive the lifecycle split', () => {
    const lens = summarizeConnectors({ stats: { total: 22, configured: 8 } });
    const s = stat(lens, 'Connectors');
    expect(s?.value).toBe('22');
    expect(s?.hint).toBe('8 configured'); // no production/preview split available
    expect(stat(lens, 'Production connectors')).toBeUndefined();
    expect(row(lens, REGISTRY_GROUP, 'Connectors in registry')?.value).toBe('22');
    expect(row(lens, REGISTRY_GROUP, 'Production (real adapter)')).toBeUndefined();
  });
});

describe('summarizeConnectors — account-health tone / threshold boundaries', () => {
  const health = (healthy: number, degraded: number, down: number): ConnectorsInput => ({
    stats: { total: 3, connected: 1, accounts: healthy + degraded + down, healthy, degraded, down },
    connectors: [{ id: 'a', lifecycle: 'production', status: 'connected', accounts: [{}] }],
  });

  it('healthy share ≥0.8 → green', () => {
    const s = stat(summarizeConnectors(health(4, 1, 0)), 'Account health'); // 4/5 = 0.8
    expect(s?.value).toBe('80%');
    expect(s?.tone).toBe('green');
  });

  it('healthy share at 0.5 → orange', () => {
    const s = stat(summarizeConnectors(health(1, 1, 0)), 'Account health'); // 1/2 = 0.5
    expect(s?.value).toBe('50%');
    expect(s?.tone).toBe('orange');
  });

  it('healthy share <0.5 → red, and a red "Accounts down" row appears', () => {
    const lens = summarizeConnectors(health(1, 0, 2)); // 1/3 ≈ 0.333
    expect(stat(lens, 'Account health')?.value).toBe('33%');
    expect(stat(lens, 'Account health')?.tone).toBe('red');
    const downRow = row(lens, REGISTRY_GROUP, 'Accounts down');
    expect(downRow?.value).toBe('2');
    expect(downRow?.tone).toBe('red');
  });
});
