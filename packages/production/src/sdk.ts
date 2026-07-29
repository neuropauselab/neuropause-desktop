/**
 * Module 19 — Production SDK. Register deployment, monitoring, health-check, diagnostics, installer,
 * and upgrade extensions as definitions. Each extension must declare at least one reused platform
 * capability — extensions compose on the production platform, they do not fork it; a definition that
 * reuses nothing is rejected. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import { PROD_SDK_KINDS, type ProdSdkKind } from './constants';

export interface ProductionModule {
  id: string;
  kind: ProdSdkKind;
  name: string;
  reuses: string[];
  createdAt: number;
}

export class ProductionSDK {
  private readonly modules = new Map<string, ProductionModule>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
  ) {}

  async register(input: { kind: ProdSdkKind; name: string; reuses: string[] }): Promise<ProductionModule> {
    if (!PROD_SDK_KINDS.includes(input.kind)) throw new Error(`unknown production SDK kind: ${input.kind}`);
    if (input.reuses.length === 0) throw new Error('a production extension must reuse at least one platform capability — extensions compose, they do not fork');
    const m: ProductionModule = { id: randomId('pmod'), kind: input.kind, name: input.name, reuses: input.reuses, createdAt: this.clock.now() };
    this.modules.set(m.id, m);
    await this.governance.record({ operator: 'system', org: '_platform', environment: '_platform', operation: `sdk.register.${input.kind}`, targetId: m.id, evidence: 'live-verified', decision: `reuses ${input.reuses.join(', ')}` });
    return m;
  }

  list(kind?: ProdSdkKind): ProductionModule[] {
    const all = [...this.modules.values()];
    return kind ? all.filter((m) => m.kind === kind) : all;
  }
  count(): number { return this.modules.size; }
}
