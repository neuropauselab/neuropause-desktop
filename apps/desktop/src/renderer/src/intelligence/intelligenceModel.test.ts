/**
 * Enterprise Intelligence Workspace v1.0 — intelligence model tests. Lock the pure lens: the keyword state-tone
 * (defensive against positive substrings), the band → tone map, the signing label/tone, the intelligence-gap
 * catalog (never empty / always reasoned / honest "Requires …" badges), and the pure summaries over the real
 * intelligence DTO shapes (module family roll-up, KPI band tally, compliance findings, averages, money format).
 */
import { describe, expect, it } from 'vitest';
import type { ComplianceFinding, EnterpriseModuleSummary, ExecutiveKpi } from '@neuropause/shared';
import {
  INTELLIGENCE_GAPS,
  averageHealth,
  bandTone,
  formatUsd,
  groupModulesByFamily,
  intelGapKindMeta,
  signingLabel,
  signingTone,
  stateTone,
  summarizeFindings,
  summarizeKpis,
  type IntelGapKind,
} from './intelligenceModel';

const mod = (group: string | undefined, records: number, active: number): EnterpriseModuleSummary =>
  ({ id: group ?? 'x', title: group ?? 'x', group, recordCount: records, activeCount: active } as unknown as EnterpriseModuleSummary);
const kpi = (band: ExecutiveKpi['band']): ExecutiveKpi =>
  ({ key: `k.${band ?? 'none'}`, label: 'K', value: 1, display: '1', band } as ExecutiveKpi);
const finding = (status: ComplianceFinding['status']): ComplianceFinding =>
  ({ ruleId: 'r', ruleName: 'r', category: 'c', severity: 'info', status, detail: '', evidence: [] } as unknown as ComplianceFinding);

describe('status → tone maps', () => {
  it('band tone maps each severity band directly, nullish → gray', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('orange');
    expect(bandTone('at-risk')).toBe('red');
    expect(bandTone('critical')).toBe('red');
    expect(bandTone(undefined)).toBe('gray');
    expect(bandTone(null)).toBe('gray');
  });

  it('keyword state tone classifies varying string states defensively', () => {
    expect(stateTone('ok')).toBe('green');
    expect(stateTone('pass')).toBe('green');
    expect(stateTone('connected')).toBe('green');
    expect(stateTone('degraded')).toBe('orange');
    expect(stateTone('warning')).toBe('orange');
    expect(stateTone('recovering')).toBe('orange');
    expect(stateTone('down')).toBe('red');
    expect(stateTone('failed')).toBe('red');
    // negatives that CONTAIN a positive substring must still read negative
    expect(stateTone('unhealthy')).toBe('red');
    expect(stateTone('disconnected')).toBe('red');
    expect(stateTone('unknown')).toBe('gray');
    expect(stateTone(null)).toBe('gray');
  });

  it('signing label + tone are honest', () => {
    expect(signingLabel('signed-notarized')).toBe('Signed & notarized');
    expect(signingLabel('unsigned')).toBe('Unsigned');
    expect(signingLabel('not-applicable')).toBe('N/A (dev)');
    expect(signingTone('signed')).toBe('green');
    expect(signingTone('unsigned')).toBe('orange');
    expect(signingTone('not-applicable')).toBe('gray');
  });
});

describe('intelligence-gap catalog (honesty ledger)', () => {
  it('is non-empty and every gap carries a lens, metric, valid kind, reason and a blue "Requires …" badge', () => {
    expect(INTELLIGENCE_GAPS.length).toBeGreaterThan(0);
    const kinds: IntelGapKind[] = ['telemetry', 'aggregation', 'architecture'];
    for (const g of INTELLIGENCE_GAPS) {
      expect(g.lens.length).toBeGreaterThan(0);
      expect(g.metric.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(kinds).toContain(g.kind);
      const meta = intelGapKindMeta(g.kind);
      expect(meta.tone).toBe('blue');
      expect(meta.label.startsWith('Requires ')).toBe(true);
    }
  });

  it('records CI coverage, MRR/ARR/churn and per-plugin telemetry as the labeled gaps', () => {
    const by = (needle: string) => INTELLIGENCE_GAPS.find((g) => g.metric.toLowerCase().includes(needle));
    expect(by('ci')?.kind).toBe('telemetry');
    expect(by('coverage')?.kind).toBe('telemetry');
    expect(by('mrr')?.kind).toBe('aggregation');
    expect(by('churn')?.kind).toBe('aggregation');
    expect(by('per-plugin')?.kind).toBe('telemetry');
    // all three requirement kinds are represented
    expect(new Set(INTELLIGENCE_GAPS.map((g) => g.kind))).toEqual(new Set(['telemetry', 'aggregation', 'architecture']));
  });

  it('every gap badge label matches its kind', () => {
    expect(intelGapKindMeta('telemetry').label).toBe('Requires telemetry');
    expect(intelGapKindMeta('aggregation').label).toBe('Requires aggregation');
    expect(intelGapKindMeta('architecture').label).toBe('Requires architecture');
  });
});

describe('pure intelligence summaries', () => {
  it('groupModulesByFamily groups by descriptor group and sums records + active', () => {
    const families = groupModulesByFamily([
      mod('Finance', 10, 4),
      mod('Finance', 5, 1),
      mod('Operations', 8, 8),
      mod(undefined, 2, 0),
    ]);
    expect(families).toEqual([
      { family: 'Finance', modules: 2, records: 15, active: 5 },
      { family: 'Operations', modules: 1, records: 8, active: 8 },
      { family: 'Other', modules: 1, records: 2, active: 0 },
    ]);
  });

  it('summarizeKpis tallies bands and reports the worst band present', () => {
    const s = summarizeKpis([kpi('healthy'), kpi('healthy'), kpi('watch'), kpi('at-risk'), kpi(undefined)]);
    expect(s).toMatchObject({ total: 5, healthy: 2, watch: 1, atRisk: 1, critical: 0, worst: 'at-risk' });
    expect(summarizeKpis([]).worst).toBeNull();
    expect(summarizeKpis([kpi('critical'), kpi('healthy')]).worst).toBe('critical');
  });

  it('summarizeFindings tallies pass/warn/fail with an honest overall tone', () => {
    expect(summarizeFindings([finding('pass'), finding('pass')]).tone).toBe('green');
    expect(summarizeFindings([finding('pass'), finding('warn')]).tone).toBe('orange');
    expect(summarizeFindings([finding('pass'), finding('fail')]).tone).toBe('red');
    expect(summarizeFindings([]).tone).toBe('gray');
    expect(summarizeFindings([finding('pass'), finding('warn'), finding('fail')])).toMatchObject({ total: 3, pass: 1, warn: 1, fail: 1 });
  });

  it('averageHealth means a set of scores, 0 for empty', () => {
    expect(averageHealth([100, 50, 0])).toBe(50);
    expect(averageHealth([75, 76])).toBe(76);
    expect(averageHealth([])).toBe(0);
  });

  it('formatUsd formats money defensively', () => {
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(null)).toBe('$0.00');
    expect(formatUsd(undefined)).toBe('$0.00');
  });
});
