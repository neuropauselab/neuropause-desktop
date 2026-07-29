/**
 * Module 16 — Worker SDK. Developers register workers, skills, tools, planning modules, memory
 * modules, and reasoning modules as definitions. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkforceGovernance } from './governance';
import { SDK_MODULE_KINDS, type SdkModuleKind } from './constants';

export interface WorkerModule {
  id: string;
  kind: SdkModuleKind;
  name: string;
  createdAt: number;
}

export class WorkerSDK {
  private readonly modules = new Map<string, WorkerModule>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkforceGovernance,
  ) {}

  async register(input: { kind: SdkModuleKind; name: string }): Promise<WorkerModule> {
    if (!SDK_MODULE_KINDS.includes(input.kind)) throw new Error(`unknown SDK module kind: ${input.kind}`);
    const m: WorkerModule = { id: randomId('mod'), kind: input.kind, name: input.name, createdAt: this.clock.now() };
    this.modules.set(m.id, m);
    await this.governance.record({ user: 'system', org: '_platform', worker: 'sdk', operation: `register.${input.kind}`, targetId: m.id, evidence: 'live-verified', reasoning: input.name });
    return m;
  }

  list(kind?: SdkModuleKind): WorkerModule[] {
    const all = [...this.modules.values()];
    return kind ? all.filter((m) => m.kind === kind) : all;
  }
  count(): number { return this.modules.size; }
}
