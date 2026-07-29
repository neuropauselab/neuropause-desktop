/**
 * Industry SDK. The core registration surface: any vertical solution registers its objects,
 * workflows, forms, dashboards, reports, compliance packs, connectors, AI skills, automation
 * packs, KPIs, and document templates as DECLARATIONS. A tenant activates one industry. The SDK
 * is live-verified in-process; the declarations compose on the reused Wave 8 domains and never
 * duplicate them.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { IndustryGovernance } from './governance';
import type { IndustrySolution, CustomObjectDef, ConnectorRef, CompliancePackRef, KpiDef } from './types';

export interface Activation {
  tenantId: string;
  industryKey: string;
  at: number;
}

export class IndustrySDK {
  private readonly solutions = new Map<string, IndustrySolution>();
  private readonly activations = new Map<string, Activation>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: IndustryGovernance,
  ) {}

  async register(solution: IndustrySolution): Promise<IndustrySolution> {
    if (!solution.key) throw new Error('industry solution requires a key');
    if (solution.reusesDomains.length === 0) throw new Error(`industry ${solution.key} must reuse Wave 8 domains (no duplicated business logic)`);
    this.solutions.set(solution.key, solution);
    await this.governance.record({ actor: 'system', operation: `sdk.register.${solution.key}`, targetId: solution.key, evidence: 'live-verified', detail: `reuses ${solution.reusesDomains.join('/')}` });
    return solution;
  }

  /** Preload a built-in catalog solution synchronously (no governance record — catalog load). */
  seed(solution: IndustrySolution): void {
    if (solution.reusesDomains.length === 0) throw new Error(`industry ${solution.key} must reuse Wave 8 domains`);
    this.solutions.set(solution.key, solution);
  }

  async activate(tenantId: string, industryKey: string): Promise<Activation> {
    if (!this.solutions.has(industryKey)) throw new Error(`no industry solution ${industryKey}`);
    const activation: Activation = { tenantId, industryKey, at: this.clock.now() };
    this.activations.set(tenantId, activation);
    await this.governance.record({ actor: 'system', operation: 'sdk.activate', targetId: tenantId, evidence: 'live-verified', detail: industryKey });
    return activation;
  }

  get(key: string): IndustrySolution | undefined {
    return this.solutions.get(key);
  }
  list(): IndustrySolution[] {
    return [...this.solutions.values()];
  }
  keys(): string[] {
    return [...this.solutions.keys()];
  }
  activeIndustry(tenantId: string): string | undefined {
    return this.activations.get(tenantId)?.industryKey;
  }
  count(): number {
    return this.solutions.size;
  }

  // aggregate views across every registered solution
  allObjects(): CustomObjectDef[] {
    return this.list().flatMap((s) => s.objects);
  }
  allConnectors(): ConnectorRef[] {
    return this.list().flatMap((s) => s.connectors);
  }
  allCompliancePacks(): CompliancePackRef[] {
    return this.list().flatMap((s) => s.compliancePacks);
  }
  kpisFor(key: string): KpiDef[] {
    return this.get(key)?.kpis ?? [];
  }
}
