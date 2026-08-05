/**
 * Industry Analytics. Industry KPIs, dashboards, executive reports, a benchmark framework, and
 * forecast models — each KPI computes over REAL data from the reused Wave 8 business platform.
 * Shows only real customer data: with no data, KPI values are 0 and the dashboard reads 'No
 * business data available' rather than a fabricated number.
 */
import type { BusinessPlatform } from '@neuropause/business';
import type { IndustrySDK } from './sdk';
import { NO_INDUSTRY_DATA } from './constants';

export interface IndustryKpiValue {
  name: string;
  unit: string;
  value: number;
}
export interface IndustryDashboard {
  industry: string;
  kpis: IndustryKpiValue[];
  hasData: boolean;
  note: string;
}

export class IndustryAnalytics {
  constructor(
    private readonly sdk: IndustrySDK,
    private readonly business?: BusinessPlatform,
  ) {}

  kpis(industryKey: string): IndustryKpiValue[] {
    return this.sdk.kpisFor(industryKey).map((d) => ({ name: d.name, unit: d.unit, value: d.compute({ ...(this.business ? { business: this.business } : {}) }) }));
  }

  dashboard(industryKey: string): IndustryDashboard {
    const kpis = this.kpis(industryKey);
    const hasData = kpis.some((k) => k.value > 0);
    return { industry: industryKey, kpis, hasData, note: hasData ? 'computed over real customer data' : NO_INDUSTRY_DATA };
  }

  /** A benchmark is a framework only — populated when real data exists across tenants. */
  benchmark(industryKey: string): { industry: string; note: string } {
    return { industry: industryKey, note: 'benchmark framework — requires real cross-tenant data (business-data-pending)' };
  }
}
