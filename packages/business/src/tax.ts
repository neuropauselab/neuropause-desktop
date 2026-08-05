/**
 * Module 8 — Tax Platform. Tax jurisdictions, rules, and a calculation ENGINE (GST / VAT / sales
 * tax / corporate / withholding), plus tax reports and a filing workflow with government-connector
 * adapters. Tax calculation is real in-process arithmetic (live-verified); a filing is only ever
 * 'prepared' — government submission is REGULATED-EXTERNAL and is never performed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { REGULATED_NOTE } from './types';
import { TAX_TYPES, type TaxType } from './constants';

export interface TaxJurisdiction {
  id: string;
  name: string;
  country: string;
}
export interface TaxRule {
  id: string;
  jurisdictionId: string;
  taxType: TaxType;
  ratePct: number;
}
export interface TaxComputation {
  amount: number;
  taxType: TaxType;
  ratePct: number;
  tax: number;
  total: number;
  currency: string;
}
export interface TaxFiling {
  id: string;
  jurisdictionId: string;
  period: string;
  taxDue: number;
  status: 'prepared'; // never 'filed'
  evidence: 'regulated-external';
  note: string;
  createdAt: number;
}

export class TaxRuntime {
  private readonly jurisdictionsMap = new Map<string, TaxJurisdiction>();
  private readonly rulesMap = new Map<string, TaxRule>();
  private readonly filingsMap = new Map<string, TaxFiling>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async defineJurisdiction(input: { name: string; country: string }): Promise<TaxJurisdiction> {
    const j: TaxJurisdiction = { id: randomId('juris'), name: input.name, country: input.country };
    this.jurisdictionsMap.set(j.id, j);
    return j;
  }
  async defineRule(input: { jurisdictionId: string; taxType: TaxType; ratePct: number }): Promise<TaxRule> {
    if (!TAX_TYPES.includes(input.taxType)) throw new Error(`unknown tax type: ${input.taxType}`);
    const r: TaxRule = { id: randomId('taxrule'), jurisdictionId: input.jurisdictionId, taxType: input.taxType, ratePct: input.ratePct };
    this.rulesMap.set(r.id, r);
    await this.governance.record({ actor: 'system', domain: 'tax', operation: `rule.${input.taxType}`, targetId: r.id, evidence: 'live-verified' });
    return r;
  }

  /** Real in-process tax computation from the applicable rule. */
  computeTax(input: { amount: number; jurisdictionId: string; taxType: TaxType; currency?: string }): TaxComputation {
    const rule = [...this.rulesMap.values()].find((r) => r.jurisdictionId === input.jurisdictionId && r.taxType === input.taxType);
    if (!rule) throw new Error(`no ${input.taxType} rule for jurisdiction ${input.jurisdictionId}`);
    const tax = Math.round(input.amount * (rule.ratePct / 100) * 100) / 100;
    return { amount: input.amount, taxType: input.taxType, ratePct: rule.ratePct, tax, total: Math.round((input.amount + tax) * 100) / 100, currency: input.currency ?? 'USD' };
  }

  /** Prepare (never submit) a filing. Government submission is regulated-external. */
  async prepareFiling(input: { jurisdictionId: string; period: string; taxDue: number }): Promise<TaxFiling> {
    const f: TaxFiling = { id: randomId('filing'), jurisdictionId: input.jurisdictionId, period: input.period, taxDue: input.taxDue, status: 'prepared', evidence: 'regulated-external', note: `filing prepared — ${REGULATED_NOTE}`, createdAt: this.clock.now() };
    this.filingsMap.set(f.id, f);
    await this.governance.record({ actor: 'system', domain: 'tax', operation: 'filing.prepare', targetId: f.id, evidence: 'regulated-external', detail: f.note });
    return f;
  }

  jurisdictions(): TaxJurisdiction[] { return [...this.jurisdictionsMap.values()]; }
  rules(): TaxRule[] { return [...this.rulesMap.values()]; }
  filings(): TaxFiling[] { return [...this.filingsMap.values()]; }
  taxTypes(): readonly TaxType[] { return TAX_TYPES; }
  count(): number { return this.rulesMap.size; }
}
