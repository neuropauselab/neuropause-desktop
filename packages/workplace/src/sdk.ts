/**
 * Module 19 — Workspace SDK. Developers register widgets, pages, commands, dashboards, workflows,
 * panels, and extensions as definitions. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import { SDK_ARTIFACTS, type SdkArtifact } from './constants';

export interface WorkspaceArtifact {
  id: string;
  kind: SdkArtifact;
  name: string;
  createdAt: number;
}

export class WorkspaceSDK {
  private readonly artifactsMap = new Map<string, WorkspaceArtifact>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async register(input: { kind: SdkArtifact; name: string }): Promise<WorkspaceArtifact> {
    if (!SDK_ARTIFACTS.includes(input.kind)) throw new Error(`unknown SDK artifact kind: ${input.kind}`);
    const a: WorkspaceArtifact = { id: randomId('art'), kind: input.kind, name: input.name, createdAt: this.clock.now() };
    this.artifactsMap.set(a.id, a);
    await this.governance.record({ actor: 'system', module: 'sdk', operation: `register.${input.kind}`, targetId: a.id, evidence: 'live-verified', detail: input.name });
    return a;
  }

  artifacts(kind?: SdkArtifact): WorkspaceArtifact[] {
    const all = [...this.artifactsMap.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }
  count(): number { return this.artifactsMap.size; }
}
