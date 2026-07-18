import { describe, it, expect } from 'vitest';
import { summarizeExtensions, type ExtensionsInput } from './extensionsModel';

/**
 * A fully-populated input mirroring the REAL payload shapes:
 *   plugins    ← ipc.plugins.list()        (PluginDto[])
 *   extensions ← ipc.plugins.extensions()  (PluginExtension[])
 *   registry   ← ipc.registry.stats()      (RegistryStats)
 *
 * 4 plugins: 2 enabled, 1 disabled+incompatible, 1 crashed. 3 of 4 compatible.
 * 6 extensions across 5 kinds (3 consumed kinds, 2 not-yet-consumed).
 */
function populatedInput(overrides: Partial<ExtensionsInput> = {}): ExtensionsInput {
  return {
    plugins: [
      {
        id: 'p-graph',
        name: 'Graph Pack',
        version: '1.2.0',
        kind: 'background',
        state: 'enabled',
        runtimeStatus: 'running',
        health: 'healthy',
        compatible: true,
        engineRange: '>=0.1.0',
        permissions: ['background'],
        grantedPermissions: ['background'],
        contributions: [{ id: 'c1', surface: 'panel', title: 'Graph' }],
      },
      {
        id: 'p-kpi',
        name: 'KPI Pack',
        version: '0.9.0',
        kind: 'ui',
        state: 'enabled',
        runtimeStatus: 'running',
        health: 'degraded',
        compatible: true,
      },
      {
        id: 'p-crash',
        name: 'Flaky Pack',
        version: '0.3.1',
        kind: 'automation',
        state: 'error',
        runtimeStatus: 'crashed',
        health: 'unhealthy',
        compatible: true,
        lastError: 'boom',
      },
      {
        id: 'p-old',
        name: 'Legacy Pack',
        version: '0.1.0',
        kind: 'background',
        state: 'disabled',
        runtimeStatus: 'stopped',
        health: 'unknown',
        compatible: false,
        engineRange: '>=2.0.0',
      },
    ],
    extensions: [
      { id: 'e1', pluginId: 'p-graph', pluginVersion: '1.2.0', kind: 'graph_node', label: 'Node A' },
      { id: 'e2', pluginId: 'p-graph', pluginVersion: '1.2.0', kind: 'graph_node', label: 'Node B' },
      { id: 'e3', pluginId: 'p-graph', pluginVersion: '1.2.0', kind: 'graph_relationship', label: 'Rel A' },
      { id: 'e4', pluginId: 'p-kpi', pluginVersion: '0.9.0', kind: 'executive_kpi', label: 'KPI A' },
      { id: 'e5', pluginId: 'p-kpi', pluginVersion: '0.9.0', kind: 'timeline_provider', label: 'TL A' },
      { id: 'e6', pluginId: 'p-graph', pluginVersion: '1.2.0', kind: 'search_provider', label: 'Srch A' },
    ],
    registry: {
      totalInstalled: 5,
      totalLaunches: 42,
      totalDiskBytes: 1024,
      pinnedCount: 2,
      favoriteCount: 1,
      byType: { web: 3, native: 2 },
    },
    ...overrides,
  };
}

type Lens = ReturnType<typeof summarizeExtensions>;
const findStat = (lens: Lens, label: string) => lens.stats.find((s) => s.label === label);
const findGroup = (lens: Lens, title: string) => lens.groups.find((g) => g.title === title);
const findRow = (lens: Lens, title: string, label: string) =>
  findGroup(lens, title)?.rows.find((r) => r.label === label);

describe('summarizeExtensions — populated (real plugin/extension signals)', () => {
  it('derives the installed/enabled/crashed headline stats from real fields', () => {
    const lens = summarizeExtensions(populatedInput());
    expect(findStat(lens, 'Plugins installed')?.value).toBe('4');
    expect(findStat(lens, 'Plugins installed')?.hint).toBe('2 enabled');
    expect(findStat(lens, 'Enabled')?.value).toBe('2');
    expect(findStat(lens, 'Crashed plugins')?.value).toBe('1');
  });

  it('computes compatible % from the real `compatible` boolean', () => {
    const lens = summarizeExtensions(populatedInput());
    const c = findStat(lens, 'Compatible');
    expect(c?.value).toBe('75%'); // pctText(3/4)
    expect(c?.tone).toBe('orange'); // healthTone(0.75) → 0.5..0.8
    expect(c?.hint).toBe('3/4 host-compatible');
  });

  it('counts extension contributions and how many kinds are present', () => {
    const lens = summarizeExtensions(populatedInput());
    const ec = findStat(lens, 'Extension contributions');
    expect(ec?.value).toBe('6');
    expect(ec?.hint).toBe('5 of 10 kinds');
  });

  it('lists installed plugins with real state/health/compatible detail, worst first', () => {
    const lens = summarizeExtensions(populatedInput());
    const g = findGroup(lens, 'Installed extensions');
    expect(g).toBeDefined();
    // crashed plugin surfaces first (severity ordering).
    expect(g?.rows[0]?.label).toBe('Flaky Pack');
    expect(g?.rows[0]?.value).toBe('Crashed');
    expect(g?.rows[0]?.tone).toBe('red');
    // enabled/healthy plugin.
    expect(findRow(lens, 'Installed extensions', 'Graph Pack')?.value).toBe('Enabled');
    expect(findRow(lens, 'Installed extensions', 'Graph Pack')?.tone).toBe('green');
    // enabled but degraded → orange.
    expect(findRow(lens, 'Installed extensions', 'KPI Pack')?.tone).toBe('orange');
    // incompatible detail is surfaced honestly in the sub-line.
    expect(findRow(lens, 'Installed extensions', 'Legacy Pack')?.sub).toMatch(/incompatible/);
    expect(findRow(lens, 'Installed extensions', 'Legacy Pack')?.sub).toMatch(/needs >=2\.0\.0/);
    expect(g?.note).toBe('2 enabled · 1 disabled · 1 crashed · 1 incompatible');
  });

  it('groups extension contributions by kind and honestly marks consumption', () => {
    const lens = summarizeExtensions(populatedInput());
    const g = findGroup(lens, 'Extension contributions by kind');
    expect(g).toBeDefined();
    const gn = findRow(lens, 'Extension contributions by kind', 'Graph node');
    expect(gn?.value).toBe('2'); // most frequent → first
    expect(g?.rows[0]?.label).toBe('Graph node');
    expect(gn?.tone).toBe('green'); // consumed
    expect(gn?.sub).toBe('consumed');
    const tl = findRow(lens, 'Extension contributions by kind', 'Timeline provider');
    expect(tl?.value).toBe('1');
    expect(tl?.tone).toBe('gray'); // registers but not consumed
    expect(tl?.sub).toMatch(/not yet consumed/);
    expect(g?.note).toMatch(/graph_node, graph_relationship, executive_kpi/);
  });

  it('reuses ipc.registry.stats() as a real, labeled group', () => {
    const lens = summarizeExtensions(populatedInput());
    const g = findGroup(lens, 'Local application registry (reuse)');
    expect(g).toBeDefined();
    expect(findRow(lens, 'Local application registry (reuse)', 'Installed apps')?.value).toBe('5');
    expect(findRow(lens, 'Local application registry (reuse)', 'Total launches')?.value).toBe('42');
    expect(findRow(lens, 'Local application registry (reuse)', 'Type · web')?.value).toBe('3');
    expect(g?.note).toMatch(/ipc\.registry\.stats/);
  });

  it('accepts the pre-aggregated PluginExtensionCounts variant (union input)', () => {
    const lens = summarizeExtensions({
      extensions: { total: 9, byKind: { graph_node: 4, memory_projector: 5 } },
    });
    expect(findStat(lens, 'Extension contributions')).toBeUndefined(); // no plugins → no plugin block, but…
    const g = findGroup(lens, 'Extension contributions by kind');
    expect(g).toBeDefined();
    expect(findRow(lens, 'Extension contributions by kind', 'Memory projector')?.value).toBe('5');
    expect(findRow(lens, 'Extension contributions by kind', 'Memory projector')?.tone).toBe('gray');
    expect(findRow(lens, 'Extension contributions by kind', 'Graph node')?.tone).toBe('green');
  });

  it('deep-links to the Developer and Marketplace surfaces (reuse, not duplicate)', () => {
    const lens = summarizeExtensions(populatedInput());
    const sections = (lens.links ?? []).map((l) => l.section);
    expect(sections).toEqual(['developer', 'marketplace']);
    expect(lens.links?.find((l) => l.section === 'developer')?.label).toBe('Developer');
  });
});

describe('summarizeExtensions — honest empty state', () => {
  it('empty input yields no stats/groups but keeps gaps + links', () => {
    const lens = summarizeExtensions({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps.length).toBe(3);
    expect(lens.links?.length).toBe(2);
  });

  it('all-null signals behave the same as empty (defensive)', () => {
    const lens = summarizeExtensions({ plugins: null, extensions: null, registry: null });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps.length).toBe(3);
  });

  it('an empty plugins[] shows through as empty — no placeholder plugin stats', () => {
    const lens = summarizeExtensions({ plugins: [] });
    expect(findStat(lens, 'Plugins installed')).toBeUndefined();
    expect(findGroup(lens, 'Installed extensions')).toBeUndefined();
    expect(lens.gaps.length).toBe(3);
  });

  it('a registry present but all-zero is treated as no signal (no empty group)', () => {
    const lens = summarizeExtensions({
      registry: { totalInstalled: 0, totalLaunches: 0, byType: {} },
    });
    expect(findGroup(lens, 'Local application registry (reuse)')).toBeUndefined();
  });

  it('plugins present without extensions: installed stats show, contributions do not', () => {
    const lens = summarizeExtensions({
      plugins: [{ id: 'p1', name: 'Solo', state: 'enabled', runtimeStatus: 'running', compatible: true }],
    });
    expect(findStat(lens, 'Plugins installed')?.value).toBe('1');
    expect(findStat(lens, 'Extension contributions')).toBeUndefined();
    expect(findGroup(lens, 'Extension contributions by kind')).toBeUndefined();
  });
});

describe('summarizeExtensions — crashed-plugin riskTone boundaries', () => {
  const crashedStat = (total: number, crashed: number) => {
    const plugins = Array.from({ length: total }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      state: i < crashed ? 'error' : 'enabled',
      runtimeStatus: i < crashed ? 'crashed' : 'running',
      compatible: true,
    }));
    return findStat(summarizeExtensions({ plugins }), 'Crashed plugins');
  };

  it('>= 0.66 crashed ratio is red', () => {
    const s = crashedStat(3, 2); // 2/3 ≈ 0.667
    expect(s?.value).toBe('2');
    expect(s?.tone).toBe('red');
  });

  it('0.33..0.66 crashed ratio is orange (boundary at 0.33)', () => {
    const s = crashedStat(3, 1); // 1/3 ≈ 0.333
    expect(s?.value).toBe('1');
    expect(s?.tone).toBe('orange');
  });

  it('zero crashes is green (riskTone(0))', () => {
    const s = crashedStat(4, 0);
    expect(s?.value).toBe('0');
    expect(s?.tone).toBe('green');
  });
});

describe('summarizeExtensions — authenticity: absences are gaps, never fabricated values', () => {
  it('discloses dependency validation, sandbox jail, and inactive kinds as honest gaps', () => {
    const lens = summarizeExtensions(populatedInput());
    const caps = lens.gaps.map((g) => g.capability);
    expect(caps).toContain('Dependency validation');
    expect(caps).toContain('Hardened sandbox jail');
    expect(caps).toContain('Active extension kinds');
    expect(lens.gaps.every((g) => g.requires.length > 0)).toBe(true);
    // the inactive-kinds gap states the honest 7-of-10 limitation.
    const kinds = lens.gaps.find((g) => g.capability === 'Active extension kinds');
    expect(kinds?.requires).toMatch(/7 of 10/);
    expect(kinds?.note).toMatch(/all 10 kinds/);
  });

  it('never presents the missing capabilities as delivered in the rendered surface', () => {
    const lens = summarizeExtensions(populatedInput());
    const claimSurface = [
      ...lens.stats.map((s) => `${s.label} ${s.value} ${s.hint ?? ''}`),
      ...lens.groups.flatMap((g) => [
        g.title,
        g.note ?? '',
        ...g.rows.map((r) => `${r.label} ${r.value} ${r.sub ?? ''}`),
      ]),
    ].join(' \n ');
    // A seccomp jail / dependency resolver are architecturally absent — they must
    // not appear anywhere except inside the honest gap disclosures.
    expect(claimSurface).not.toMatch(/seccomp/i);
    expect(claimSurface).not.toMatch(/dependency resolver/i);
  });
});
