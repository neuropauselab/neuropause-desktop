import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_STATUTORY_RULE_SET,
  calculateAnnualTds,
  calculateEsi,
  calculatePf,
  calculatePt,
  parsePfRules,
  parsePtRules,
  parseTdsRules,
  resolveStatutoryRuleSet,
  type EnterpriseEntity,
  type PfRules,
  type PtStateRules,
  type TdsRules,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const T0 = '2026-08-06T00:00:00.000Z';

const PF: PfRules = JSON.parse(DEFAULT_STATUTORY_RULE_SET.pfJson);
const PT: PtStateRules[] = JSON.parse(DEFAULT_STATUTORY_RULE_SET.ptJson);
const TDS: TdsRules = JSON.parse(DEFAULT_STATUTORY_RULE_SET.tdsJson);

describe('Statutory calculators (pure) — verified FY 2026-27 seed', () => {
  it('PF: ceiling restriction, the ₹1,250 EPS cap, and the unrestricted variant', () => {
    const high = calculatePf(PF, 40000);
    // Restricted to the ₹15,000 ceiling: 12% → 1,800 each side.
    expect(high.contributionBase).toBe(15000);
    expect(high.employee).toBe(1800);
    expect(high.employerEps).toBe(1250); // 8.33% of 15,000, rupee-rounded — the statutory cap
    expect(high.employerEpf).toBe(550);
    expect(high.edli).toBe(75);
    expect(high.admin).toBe(75);
    expect(high.employerTotal).toBe(1800);
    const low = calculatePf(PF, 10000);
    expect(low.employee).toBe(1200);
    expect(low.employerEps).toBe(833); // 8.33% of 10,000
    expect(low.employerEpf).toBe(367);
    // Unrestricted: shares on full wage, EPS/EDLI/admin STILL on the capped base.
    const full = calculatePf({ ...PF, restrictToCeiling: false }, 40000);
    expect(full.employee).toBe(4800);
    expect(full.employerEps).toBe(1250);
    expect(full.employerEpf).toBe(3550);
    expect(full.edli).toBe(75);
  });

  it('ESI: eligibility boundary at the ceiling, paise rounded UP, disability ceiling honored', () => {
    const at = calculateEsi(JSON.parse(DEFAULT_STATUTORY_RULE_SET.esiJson), 21000);
    expect(at.eligible).toBe(true);
    expect(at.employee).toBe(158); // 157.50 rounds UP
    expect(at.employer).toBe(683); // 682.50 rounds UP
    expect(calculateEsi(JSON.parse(DEFAULT_STATUTORY_RULE_SET.esiJson), 21001).eligible).toBe(false);
    expect(calculateEsi(JSON.parse(DEFAULT_STATUTORY_RULE_SET.esiJson), 24000, true).eligible).toBe(true);
    expect(calculateEsi(JSON.parse(DEFAULT_STATUTORY_RULE_SET.esiJson), 0).eligible).toBe(false);
  });

  it('PT: Gujarat boundary, unknown states refused (never zeroed silently), per-slab February amounts', () => {
    expect(calculatePt(PT, 'GJ', 12000, 8)).toEqual({ stateFound: true, amount: 0 });
    expect(calculatePt(PT, 'gj', 12001, 8)).toEqual({ stateFound: true, amount: 200 });
    expect(calculatePt(PT, 'KA', 50000, 8).stateFound).toBe(false);
    const mh: PtStateRules[] = [
      {
        state: 'MH',
        slabs: [
          { uptoMonthly: 7500, perMonth: 0, februaryPerMonth: null },
          { uptoMonthly: 10000, perMonth: 175, februaryPerMonth: null },
          { uptoMonthly: null, perMonth: 200, februaryPerMonth: 300 },
        ],
      },
    ];
    expect(calculatePt(mh, 'MH', 20000, 3).amount).toBe(200);
    expect(calculatePt(mh, 'MH', 20000, 2).amount).toBe(300); // the February quirk hits only ITS slab
    expect(calculatePt(mh, 'MH', 9000, 2).amount).toBe(175); // other slabs keep their own amount in February
  });

  it('TDS: rebate zeroes ₹12L, marginal relief just above, full slab walk with cess and §288B rounding', () => {
    // Gross 12.75L − 75k standard deduction → taxable 12L → slab tax 60k − 60k rebate = 0.
    const free = calculateAnnualTds(TDS, 1275000);
    expect(free.annualTaxable).toBe(1200000);
    expect(free.slabTax).toBe(60000);
    expect(free.rebateApplied).toBe(60000);
    expect(free.annualTax).toBe(0);
    expect(free.monthlyTds).toBe(0);
    // Just above the limit: marginal relief caps tax at the excess (10k), cess 4% → 10,400.
    const edge = calculateAnnualTds(TDS, 1285000);
    expect(edge.annualTaxable).toBe(1210000);
    expect(edge.marginalReliefApplied).toBe(true);
    expect(edge.taxAfterRebate).toBe(10000);
    expect(edge.annualTax).toBe(10400);
    expect(edge.monthlyTds).toBe(867);
    // Deep walk: taxable 30L → 480k + 4% cess = 499,200; flat monthly 41,600.
    const deep = calculateAnnualTds(TDS, 3075000);
    expect(deep.annualTaxable).toBe(3000000);
    expect(deep.slabTax).toBe(480000);
    expect(deep.annualTax).toBe(499200);
    expect(deep.monthlyTds).toBe(41600);
  });

  it('parsers refuse malformed tables loudly, and period resolution picks the latest effective set', () => {
    expect(parsePfRules('not json').errors[0]).toContain('not valid JSON');
    expect(parsePfRules(JSON.stringify({ ...PF, employerEpsRatePct: 13 })).errors[0]).toContain('cannot exceed');
    expect(parsePtRules(JSON.stringify([{ state: 'G', slabs: [{ uptoMonthly: null, perMonth: 0 }] }])).errors[0]).toContain('state code');
    expect(parseTdsRules(JSON.stringify({ ...TDS, slabs: [{ uptoAnnual: 100, ratePct: 0 }] })).errors[0]).toContain('"uptoAnnual": null');
    const rec = (id: string, effectiveFrom: string, over: Record<string, unknown> = {}): EnterpriseEntity => ({
      id, kind: 'statutoryRuleSet', title: id, status: 'active',
      fields: { ...DEFAULT_STATUTORY_RULE_SET, ruleSetCode: id, effectiveFrom, ...over },
      createdAt: T0, updatedAt: T0, createdBy: 't', updatedBy: 't',
    } as unknown as EnterpriseEntity);
    const records = [rec('IN-FY2025-26', '2025-04-01'), rec('IN-FY2026-27', '2026-04-01')];
    expect(resolveStatutoryRuleSet(records, '2026-08').ruleSet?.ruleSetCode).toBe('IN-FY2026-27');
    expect(resolveStatutoryRuleSet(records, '2026-03').ruleSet?.ruleSetCode).toBe('IN-FY2025-26');
    expect(resolveStatutoryRuleSet(records, '2025-01').ruleSet).toBeNull();
    // A winning-but-broken record surfaces errors — processing must refuse, not zero.
    const broken = resolveStatutoryRuleSet([rec('BAD', '2026-04-01', { pfJson: 'nope' })], '2026-08');
    expect(broken.ruleSet).toBeNull();
    expect(broken.errors.length).toBeGreaterThan(0);
  });
});

describe('Statutory rules module over a real store — seeded defaults, lock marker', () => {
  let dir: string;
  let rules: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-statrules-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    rules = createStatutoryRuleModule(join(dir, 'rules.json'));
    await rules.store.load();
    ctx = { actor: () => 't@np', now: () => T0, authorize: () => undefined, moduleFor: () => null, emit: () => undefined };
  });

  afterEach(async () => {
    await rules.store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('an untouched create yields the VERIFIED seed via descriptor defaults — sourced, validated, audited', async () => {
    const v = rules.hooks.validate({ fields: {} });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.ruleSetCode).toBe('IN-FY2026-27');
    expect(v.values.effectiveFrom).toBe('2026-04-01');
    expect(String(v.values.sourceNote)).toContain('Verified 2026-08-06');
    const rec = rules.store.create({ title: String(v.values.ruleSetCode), fields: v.values, actor: 't@np', now: T0 });
    const summary = await rules.hooks.summarize!(rules.store.get(rec.id)!);
    expect(summary.headline).toContain('IN-FY2026-27 · effective 2026-04-01');
    expect(summary.summary).toContain('ceiling 15,000'); // en-US pinned, read from the TABLE
    expect(summary.summary).toContain('PT states: GJ');
    expect(summary.risk).toBe('medium'); // unlocked — lock before payroll relies on it
  });

  it('broken tables are refused at validate with field-mapped errors', () => {
    const bad = rules.hooks.validate({ fields: { pfJson: '{', tdsJson: JSON.stringify({ slabs: [] }) } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(String(bad.errors.pfJson)).toContain('not valid JSON');
      expect(String(bad.errors.tdsJson)).toContain('non-empty');
    }
  });

  it('lock freezes the rule set — edits refused, double-lock refused, forged markers refused', async () => {
    const v = rules.hooks.validate({ fields: {} });
    if (!v.ok) throw new Error('unreachable');
    const rec = rules.store.create({ title: 'IN-FY2026-27', fields: v.values, actor: 't@np', now: T0 });
    const locked = await rules.hooks.runAction!('lock', rec, ctx);
    expect(locked.ok).toBe(true);
    const frozen = rules.store.get(rec.id)!;
    expect(frozen.fields.status).toBe('locked');
    expect(rules.hooks.validate({ fields: { ...frozen.fields, ruleSetCode: 'EDITED' } }).ok).toBe(false);
    expect((await rules.hooks.runAction!('lock', frozen, ctx)).ok).toBe(false);
    expect(rules.hooks.validate({ fields: { lockedAt: T0 } }).ok).toBe(false); // forged marker
    // A corrupted (legacy) record cannot be locked — fix first.
    const v2 = rules.hooks.validate({ fields: { ruleSetCode: 'IN-NEXT', effectiveFrom: '2027-04-01' } });
    if (!v2.ok) throw new Error('unreachable');
    const rec2 = rules.store.create({ title: 'IN-NEXT', fields: v2.values, actor: 't@np', now: T0 });
    rules.store.update(rec2.id, { fields: { pfJson: 'corrupt' }, actor: 't@np', now: T0 });
    const refuse = await rules.hooks.runAction!('lock', rules.store.get(rec2.id)!, ctx);
    expect(refuse.ok).toBe(false);
    if (!refuse.ok) expect(String(refuse.error)).toContain('unparseable');
  });
});
