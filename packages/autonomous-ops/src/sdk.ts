/**
 * Module 17 — Operations SDK. Register custom operations modules, mission types, schedulers,
 * simulations, dashboards, KPIs, and coordinators as definitions. Each extension must declare at
 * least one reused platform capability — extensions compose on the platform, they do not fork it;
 * a module that reuses nothing is rejected. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import { OPS_SDK_KINDS, type OpsSdkKind } from './constants';

export interface OpsModule {
  id: string;
  kind: OpsSdkKind;
  name: string;
  reuses: string[];
  createdAt: number;
}

export class OperationsSDK {
  private readonly modules = new Map<string, OpsModule>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  async register(input: { kind: OpsSdkKind; name: string; reuses: string[] }): Promise<OpsModule> {
    if (!OPS_SDK_KINDS.includes(input.kind)) throw new Error(`unknown operations SDK kind: ${input.kind}`);
    if (input.reuses.length === 0) throw new Error('an operations module must reuse at least one platform capability — extensions compose, they do not fork');
    const m: OpsModule = { id: randomId('opsmod'), kind: input.kind, name: input.name, reuses: input.reuses, createdAt: this.clock.now() };
    this.modules.set(m.id, m);
    await this.governance.record({ user: 'system', org: '_platform', mission: '_sdk', operation: `sdk.register.${input.kind}`, targetId: m.id, evidence: 'live-verified', decision: `reuses ${input.reuses.join(', ')}` });
    return m;
  }

  list(kind?: OpsSdkKind): OpsModule[] {
    const all = [...this.modules.values()];
    return kind ? all.filter((m) => m.kind === kind) : all;
  }
  count(): number { return this.modules.size; }
}
