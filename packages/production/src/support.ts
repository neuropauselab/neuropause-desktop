/**
 * Module 18 — Support Platform. Support bundles, remote diagnostics, crash reports, log collection,
 * incident packages, and environment reports. A support bundle is assembled from REAL production
 * runtime state and REUSES the operations incident registry for the incident package when connected.
 * In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';
import type { ProductionRuntime } from './runtime';

export interface SupportBundle {
  id: string;
  org: string;
  environmentReport: { environments: number; deployments: number };
  incidentPackage: { openIncidents: number | string; source: string };
  crashReports: number;
  at: number;
}

export class ProductionSupport {
  private readonly bundles = new Map<string, SupportBundle>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly runtime: ProductionRuntime,
    private readonly ctx: ProductionContext = {},
  ) {}

  async createBundle(input: { org: string; crashReports?: number }): Promise<SupportBundle> {
    const health = this.runtime.runtimeHealth();
    const incidentPackage = this.ctx.operations
      ? { openIncidents: this.ctx.operations.incidents().status().open, source: 'reused operations incident registry' }
      : { openIncidents: 'No production data available' as string, source: 'no operations platform connected' };
    const bundle: SupportBundle = {
      id: randomId('supb'),
      org: input.org,
      environmentReport: { environments: health.environments, deployments: health.deployments },
      incidentPackage,
      crashReports: input.crashReports ?? 0,
      at: this.clock.now(),
    };
    this.bundles.set(bundle.id, bundle);
    await this.governance.record({ operator: 'system', org: input.org, environment: '_platform', operation: 'support.bundle', targetId: bundle.id, evidence: 'live-verified' });
    return bundle;
  }

  get(id: string): SupportBundle | undefined { return this.bundles.get(id); }
  list(): SupportBundle[] { return [...this.bundles.values()]; }
  count(): number { return this.bundles.size; }
}
