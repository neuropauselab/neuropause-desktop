/**
 * Phase 6 Stage 9 — the Service Catalog: state derivation cites the REAL
 * measuring aggregate per signal, ownership resolves live units (no lead → an
 * honest gap; no unit → an honest gap), none-measured services are honestly
 * unknown, KPI joins flag missing live keys, and per-source failures isolate.
 */
import { describe, expect, it } from 'vitest';
import { buildServiceCatalog, resolveOwner, type CatalogInput, type CatalogSignals } from './serviceCatalog';

const NOW_ISO = '2026-07-31T09:00:00.000Z';

function signals(over: Partial<CatalogSignals> = {}): CatalogSignals {
  return {
    executions: { active: 1, queued: 2, successRate: 0.95, averageRuntimeMs: 1200 },
    workforce: { queueDepth: 3, awaitingApproval: 1, oldestApprovalHours: 2 },
    automation: { running: 0, completed: 10, failed: 1, paused: 0 },
    connectors: [
      { id: 'slack', name: 'Slack', configured: true, health: 'healthy' },
      { id: 'github', name: 'GitHub', configured: true, health: 'healthy' },
      { id: 'notion', name: 'Notion', configured: false, health: 'unknown' },
    ],
    aiState: 'ready',
    kpiKeys: ['engineering-health', 'ai-adoption', 'connector-health'],
    units: [
      { id: 'u-ops', name: 'Operations', leadUserId: 'p1' },
      { id: 'u-it', name: 'IT', leadUserId: null },
      { id: 'u-ai', name: 'AI Team', leadUserId: null },
      { id: 'u-pe', name: 'Product & Engineering', leadUserId: null },
      { id: 'u-biz', name: 'Business', leadUserId: null },
    ],
    users: [{ id: 'p1', name: 'Priya' }],
    ...over,
  };
}

function input(over: Partial<CatalogInput> = {}): CatalogInput {
  return { nowIso: NOW_ISO, signals: signals(), failures: {}, ...over };
}

describe('resolveOwner', () => {
  it('resolves case-insensitively, joins the lead name, and returns null when unmatched', () => {
    const s = signals();
    expect(resolveOwner('operations', s.units, s.users)).toEqual({ unitId: 'u-ops', unitName: 'Operations', leadUserId: 'p1', leadName: 'Priya' });
    expect(resolveOwner('IT', s.units, s.users)?.leadName).toBeNull();
    expect(resolveOwner('Ghost Unit', s.units, s.users)).toBeNull();
    expect(resolveOwner('Operations', null, null)).toBeNull();
  });
});

describe('buildServiceCatalog — states cite their measuring aggregates', () => {
  it('healthy signals → operational rows with computed detail', () => {
    const c = buildServiceCatalog(input());
    const exec = c.entries.find((e) => e.serviceId === 'execution-runtime')!;
    expect(exec.state).toBe('operational');
    expect(exec.stateDetail).toContain('success rate 95%');
    const conn = c.entries.find((e) => e.serviceId === 'connector-fleet')!;
    expect(conn.state).toBe('operational');
    expect(conn.stateDetail).toBe('2/2 configured connector(s) healthy');
    const ai = c.entries.find((e) => e.serviceId === 'ai-runtime')!;
    expect(ai.state).toBe('operational');
  });

  it('degradation thresholds: low success → degraded; very low → failed', () => {
    const degraded = buildServiceCatalog(input({ signals: signals({ executions: { active: 0, queued: 0, successRate: 0.7, averageRuntimeMs: 100 } }) }));
    expect(degraded.entries.find((e) => e.serviceId === 'execution-runtime')!.state).toBe('degraded');
    const failed = buildServiceCatalog(input({ signals: signals({ executions: { active: 0, queued: 0, successRate: 0.3, averageRuntimeMs: 100 } }) }));
    expect(failed.entries.find((e) => e.serviceId === 'execution-runtime')!.state).toBe('failed');
  });

  it('none-measured services are honestly unknown, with the declared-signal gap recorded', () => {
    const c = buildServiceCatalog(input());
    const assistant = c.entries.find((e) => e.serviceId === 'assistant-experience')!;
    expect(assistant.state).toBe('unknown');
    expect(assistant.stateDetail).toContain('declared, not estimated');
    expect(c.gaps.some((g) => g.kind === 'signal' && g.subject === 'assistant-experience')).toBe(true);
    expect(c.gaps.some((g) => g.kind === 'signal' && g.subject === 'notification-delivery')).toBe(true);
  });

  it('a null signal makes the row unknown — never invented', () => {
    const c = buildServiceCatalog(input({ signals: signals({ executions: null, aiState: null }) }));
    expect(c.entries.find((e) => e.serviceId === 'execution-runtime')!.state).toBe('unknown');
    expect(c.entries.find((e) => e.serviceId === 'ai-runtime')!.state).toBe('unknown');
  });

  it('ownership gaps: a unit without a lead AND an unmatched unit name both surface', () => {
    const c = buildServiceCatalog(input());
    // IT exists but has no lead (automations + connectors domains).
    expect(c.gaps.some((g) => g.kind === 'ownership' && g.subject === 'automations' && g.detail.includes('no lead assigned'))).toBe(true);
    // 'Departments' maps to 'Business' which exists (no-lead gap), but remove it → unresolvable gap.
    const withoutBusiness = buildServiceCatalog(
      input({ signals: signals({ units: signals().units!.filter((u) => u.name !== 'Business') }) }),
    );
    expect(withoutBusiness.gaps.some((g) => g.kind === 'ownership' && g.subject === 'departments' && g.detail.includes('no org unit named'))).toBe(true);
  });

  it('KPI joins mark live presence and record missing live keys as gaps', () => {
    const c = buildServiceCatalog(input({ signals: signals({ kpiKeys: ['ai-adoption'] }) }));
    const exec = c.entries.find((e) => e.serviceId === 'execution-runtime')!;
    expect(exec.kpiKeys).toEqual([{ key: 'engineering-health', present: false }]);
    expect(c.gaps.some((g) => g.kind === 'kpi' && g.subject === 'execution-runtime')).toBe(true);
    // A null KPI read produces no false "missing" gaps.
    const nullKpis = buildServiceCatalog(input({ signals: signals({ kpiKeys: null }) }));
    expect(nullKpis.gaps.some((g) => g.kind === 'kpi')).toBe(false);
  });

  it('zero configured connectors is operational-with-nothing, not failure', () => {
    const c = buildServiceCatalog(input({ signals: signals({ connectors: [{ id: 'x', name: 'X', configured: false, health: 'unknown' }] }) }));
    const conn = c.entries.find((e) => e.serviceId === 'connector-fleet')!;
    expect(conn.state).toBe('operational');
    expect(conn.stateDetail).toContain('no connectors configured');
  });

  it('failures pass through as unavailable and totals add up', () => {
    const c = buildServiceCatalog(input({ failures: { insight: 'offline' } }));
    expect(c.unavailable).toContainEqual({ system: 'insight', reason: 'offline' });
    const t = c.totals;
    expect(t.operational + t.degraded + t.failed + t.unknown).toBe(t.services);
    expect(t.services).toBe(7);
  });
});
