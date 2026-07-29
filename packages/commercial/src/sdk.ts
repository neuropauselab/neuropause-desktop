/**
 * Module 18 — Commercial SDK. Register commercial extensions, licensing providers, billing
 * providers, marketplace apps, and customer integrations as definitions. Each extension must declare
 * at least one reused platform capability — extensions compose on the commercial platform, they do
 * not fork it; a definition that reuses nothing is rejected. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import { COMMERCIAL_SDK_KINDS, type CommercialSdkKind } from './constants';

export interface CommercialModule {
  id: string;
  kind: CommercialSdkKind;
  name: string;
  reuses: string[];
  createdAt: number;
}

export class CommercialSDK {
  private readonly modules = new Map<string, CommercialModule>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async register(input: { kind: CommercialSdkKind; name: string; reuses: string[] }): Promise<CommercialModule> {
    if (!COMMERCIAL_SDK_KINDS.includes(input.kind)) throw new Error(`unknown commercial SDK kind: ${input.kind}`);
    if (input.reuses.length === 0) throw new Error('a commercial extension must reuse at least one platform capability — extensions compose, they do not fork');
    const m: CommercialModule = { id: randomId('cmod'), kind: input.kind, name: input.name, reuses: input.reuses, createdAt: this.clock.now() };
    this.modules.set(m.id, m);
    await this.governance.record({ actor: 'system', org: '_platform', tenant: '_platform', operation: `sdk.register.${input.kind}`, targetId: m.id, evidence: 'live-verified', decision: `reuses ${input.reuses.join(', ')}` });
    return m;
  }

  list(kind?: CommercialSdkKind): CommercialModule[] {
    const all = [...this.modules.values()];
    return kind ? all.filter((m) => m.kind === kind) : all;
  }
  count(): number { return this.modules.size; }
}
