import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LEADS_MODULE_ID,
  OPPORTUNITIES_MODULE_ID,
  OPPORTUNITY_STAGES,
  QUOTES_MODULE_ID,
  calculateLeadScore,
  clampOpportunityProbability,
  leadFromRecord,
  nextOpportunityStage,
  deriveOpportunityPipeline,
  opportunityFromRecord,
  opportunityPipelineToKpis,
  opportunityWeightedValue,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLeadModule } from './leadModule';
import { createQuoteModule } from '../sales/quoteModule';
import { createOpportunityModule } from './opportunityModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('opportunity domain rules (pure)', () => {
  it('mirrors the business kernel stage set verbatim (kernel parity, never imported)', () => {
    expect(OPPORTUNITY_STAGES).toEqual([
      'prospecting', 'qualification', 'proposal', 'negotiation', 'closed-won', 'closed-lost',
    ]);
  });
  it('advances only through the open stages and stops at negotiation', () => {
    expect(nextOpportunityStage('prospecting')).toBe('qualification');
    expect(nextOpportunityStage('qualification')).toBe('proposal');
    expect(nextOpportunityStage('proposal')).toBe('negotiation');
    expect(nextOpportunityStage('negotiation')).toBeNull();
    expect(nextOpportunityStage('closed-won')).toBeNull();
  });
  it('pins closed probabilities, defaults blanks to the stage baseline, clamps the rest', () => {
    expect(clampOpportunityProbability('closed-won', 5)).toBe(100);
    expect(clampOpportunityProbability('closed-lost', 95)).toBe(0);
    expect(clampOpportunityProbability('proposal', undefined)).toBe(50);
    expect(clampOpportunityProbability('prospecting', 150)).toBe(100);
    expect(clampOpportunityProbability('negotiation', -5)).toBe(0);
    expect(clampOpportunityProbability('qualification', 33.4)).toBe(33);
  });
  it('computes the weighted value exactly, rounded to cents', () => {
    expect(opportunityWeightedValue(33.33, 25)).toBe(8.33);
    expect(opportunityWeightedValue(100000, 75)).toBe(75000);
    expect(opportunityWeightedValue(0, 50)).toBe(0);
  });

  it('rolls the pipeline into Executive Center insights + KPI tiles (W2.8)', () => {
    const T = '2026-08-06T00:00:00.000Z';
    const base = {
      id: 'o', name: 'D', account: '', sourceLeadRef: '', quoteRef: '', stage: 'proposal' as const,
      amount: 20000, probability: 50, weightedValue: 10000, expectedCloseDate: '2026-09-15',
      assignedTo: '', closedAt: null, outcome: null, lostReason: '', createdAt: T, updatedAt: T,
    };
    const nowMs = Date.parse(T);
    const insights = deriveOpportunityPipeline([
      base,
      { ...base, id: 'o2', expectedCloseDate: '2026-07-01' }, // past expected close → stale
      { ...base, id: 'o3', stage: 'closed-won' as const, outcome: 'won' as const, closedAt: T, amount: 40000 },
      { ...base, id: 'o4', stage: 'closed-lost' as const, outcome: 'lost' as const, closedAt: T },
    ], nowMs);
    expect(insights).toMatchObject({
      openDeals: 2, openValue: 40000, weightedPipeline: 20000, wonValue: 40000, winRate: 50, staleDeals: 1,
    });
    const kpis = opportunityPipelineToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'opp-open-deals', 'opp-pipeline-value', 'opp-weighted-pipeline', 'opp-win-rate', 'opp-stale-deals',
    ]);
    expect(kpis.find((k) => k.key === 'opp-win-rate')).toMatchObject({ display: '50%', band: 'healthy' });
    expect(deriveOpportunityPipeline([], nowMs).winRate).toBe(0); // nothing closed → 0, not fabricated
  });
});

describe('Opportunities over real stores — lead wiring, stage machine, closure immutability', () => {
  let dir: string;
  let leads: EnterpriseModule;
  let quotes: EnterpriseModule;
  let opps: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;
  let emitted: Array<{ moduleId: string; action: string; recordId: string }>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-opp-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    leads = createLeadModule(join(dir, 'leads.json'));
    quotes = createQuoteModule(join(dir, 'quotes.json'));
    opps = createOpportunityModule(join(dir, 'opps.json'), leads.store, quotes.store);
    await Promise.all([leads.store.load(), quotes.store.load(), opps.store.load()]);
    emitted = [];
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEADS_MODULE_ID ? leads
        : id === QUOTES_MODULE_ID ? quotes
        : id === OPPORTUNITIES_MODULE_ID ? opps
        : null,
      emit: (module, action, record) =>
        void emitted.push({ moduleId: module.descriptor.id, action, recordId: record.id }),
    };
  });

  afterEach(async () => {
    await Promise.all([leads.store.flush(), quotes.store.flush(), opps.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const newLead = (over: Record<string, unknown> = {}): EnterpriseEntity => {
    const v = leads.hooks.validate({
      fields: {
        name: 'Acme Renewal', company: 'Acme Inc.', dealValue: 25000, stage: 'new',
        priority: 'high', source: 'referral', assignedTo: 'kinjal', ...over,
      },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return leads.store.create({ title: 'Acme Renewal', fields: v.values, actor: 't@np', now: T0 });
  };

  const newOpportunity = async (fields: Record<string, unknown>): Promise<EnterpriseEntity> => {
    const v = opps.hooks.validate({ fields: { name: 'Acme expansion', amount: 0, stage: 'prospecting', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = opps.store.create({ title: 'Acme expansion', fields: v.values, actor: 't@np', now: T0 });
    await opps.hooks.onChange!({ action: 'created', record: rec }, ctx);
    return opps.store.get(rec.id)!;
  };

  it('creation from a lead snapshots its context and lifts a brand-new lead to qualified', async () => {
    const lead = newLead();
    const rec = await newOpportunity({ sourceLeadRef: lead.id });
    const opp = opportunityFromRecord(rec);
    expect(opp.account).toBe('Acme Inc.');
    expect(opp.amount).toBe(25000); // snapshotted from the lead's dealValue
    expect(opp.assignedTo).toBe('kinjal');
    expect(opp.probability).toBe(10); // prospecting baseline
    expect(opp.weightedValue).toBe(2500);
    const syncedLead = leadFromRecord(leads.store.get(lead.id)!);
    expect(syncedLead.stage).toBe('qualified');
    expect(syncedLead.leadScore).toBe(
      calculateLeadScore({ stage: 'qualified', dealValue: 25000, priority: 'high', source: 'referral' }),
    );
    expect(emitted).toContainEqual({ moduleId: LEADS_MODULE_ID, action: 'updated', recordId: lead.id });
    // A lead already past `new` is never regressed by another opportunity.
    const rec2 = await newOpportunity({ name: 'Second deal', sourceLeadRef: lead.id, amount: 1000 });
    expect(rec2).toBeTruthy();
    expect(leadFromRecord(leads.store.get(lead.id)!).stage).toBe('qualified');
  });

  it('refuses unknown lead refs, unknown quote refs, forged closed stages, and zero value', async () => {
    expect(opps.hooks.validate({ fields: { name: 'X', amount: 10, stage: 'prospecting', sourceLeadRef: 'nope' } }).ok).toBe(false);
    expect(opps.hooks.validate({ fields: { name: 'X', amount: 10, stage: 'prospecting', quoteRef: 'Q-404' } }).ok).toBe(false);
    const forged = opps.hooks.validate({ fields: { name: 'X', amount: 10, stage: 'closed-won' } });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(JSON.stringify(forged.errors)).toContain('Mark Won / Mark Lost');
    expect(opps.hooks.validate({ fields: { name: 'X', amount: 0, stage: 'prospecting' } }).ok).toBe(false);
    // A real quote resolves by quote number (the payments-module ref rule).
    quotes.store.create({ title: 'Q-77', fields: { quoteNumber: 'Q-77' }, actor: 't@np', now: T0 });
    expect(opps.hooks.validate({ fields: { name: 'X', amount: 10, stage: 'prospecting', quoteRef: 'Q-77' } }).ok).toBe(true);
  });

  it('advances stage by stage with re-baselined probability, then demands closure', async () => {
    const rec = await newOpportunity({ amount: 10000 });
    const walk: Array<[string, number]> = [['qualification', 25], ['proposal', 50], ['negotiation', 75]];
    for (const [stage, probability] of walk) {
      const res = await opps.hooks.runAction!('advanceStage', opps.store.get(rec.id)!, ctx);
      expect(res.ok, res.ok ? '' : res.error).toBe(true);
      const opp = opportunityFromRecord(opps.store.get(rec.id)!);
      expect(opp.stage).toBe(stage);
      expect(opp.probability).toBe(probability);
      expect(opp.weightedValue).toBe(opportunityWeightedValue(10000, probability));
    }
    const beyond = await opps.hooks.runAction!('advanceStage', opps.store.get(rec.id)!, ctx);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(String(beyond.error)).toContain('Mark Won or Mark Lost');
  });

  it('Mark Won stamps closure, syncs the lead to won, and freezes the record', async () => {
    const lead = newLead();
    const rec = await newOpportunity({ sourceLeadRef: lead.id });
    const res = await opps.hooks.runAction!('markWon', opps.store.get(rec.id)!, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const opp = opportunityFromRecord(opps.store.get(rec.id)!);
    expect(opp.stage).toBe('closed-won');
    expect(opp.outcome).toBe('won');
    expect(opp.closedAt).toBe(T0);
    expect(opp.probability).toBe(100);
    expect(opp.weightedValue).toBe(25000);
    const wonLead = leadFromRecord(leads.store.get(lead.id)!);
    expect(wonLead.stage).toBe('won');
    expect(wonLead.leadScore).toBe(100);
    // Immutable history: merged-field edits are refused, further actions too.
    const edit = opps.hooks.validate({ fields: { ...opps.store.get(rec.id)!.fields, amount: 1 } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
    const again = await opps.hooks.runAction!('markLost', opps.store.get(rec.id)!, ctx);
    expect(again.ok).toBe(false);
  });

  it('Mark Lost zeroes the weighted pipeline and syncs the lead to lost', async () => {
    const lead = newLead({ name: 'Beta deal' });
    const rec = await newOpportunity({ name: 'Beta deal', sourceLeadRef: lead.id, amount: 5000 });
    const res = await opps.hooks.runAction!('markLost', opps.store.get(rec.id)!, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (res.ok) expect(String(res.message)).toContain('lost reason'); // none recorded → prompted
    const opp = opportunityFromRecord(opps.store.get(rec.id)!);
    expect(opp.stage).toBe('closed-lost');
    expect(opp.outcome).toBe('lost');
    expect(opp.probability).toBe(0);
    expect(opp.weightedValue).toBe(0);
    const lostLead = leadFromRecord(leads.store.get(lead.id)!);
    expect(lostLead.stage).toBe('lost');
    expect(lostLead.leadScore).toBe(0);
  });

  it('summarize is deterministic and stage-aware', async () => {
    const rec = await newOpportunity({ amount: 12000, probability: 40 });
    const summary = await opps.hooks.summarize!(opps.store.get(rec.id)!);
    expect(summary.headline).toBe('Acme expansion · Prospecting · 12,000 · 40%');
    expect(summary.model).toBe('none');
    expect(summary.grounded).toBe(false);
    expect(summary.summary).toContain('4,800 weighted');
  });
});
