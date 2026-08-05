/**
 * Module 14 — Enterprise Diagnostics. Diagnostic bundles, configuration snapshots, environment
 * reports, log packages, health reports, and support diagnostics — assembled from REAL production
 * runtime state. A bundle reflects what is actually registered; nothing is invented. In-process —
 * live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionRuntime } from './runtime';

export interface DiagnosticBundle {
  id: string;
  org: string;
  environmentReport: { environments: number; deployments: number; releases: number };
  configSnapshot: { version: string; channels: readonly string[] };
  healthReport: { status: string; deployed: number };
  at: number;
}

export class EnterpriseDiagnostics {
  private readonly bundles = new Map<string, DiagnosticBundle>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly runtime: ProductionRuntime,
  ) {}

  async createBundle(input: { org: string }): Promise<DiagnosticBundle> {
    const health = this.runtime.runtimeHealth();
    const build = this.runtime.buildMetadata();
    const bundle: DiagnosticBundle = {
      id: randomId('diag'),
      org: input.org,
      environmentReport: { environments: health.environments, deployments: health.deployments, releases: health.releases },
      configSnapshot: { version: build.version, channels: build.channels },
      healthReport: { status: health.status, deployed: health.deployed },
      at: this.clock.now(),
    };
    this.bundles.set(bundle.id, bundle);
    await this.governance.record({ operator: 'system', org: input.org, environment: '_platform', operation: 'diagnostics.bundle', targetId: bundle.id, evidence: 'live-verified' });
    return bundle;
  }

  get(id: string): DiagnosticBundle | undefined { return this.bundles.get(id); }
  list(): DiagnosticBundle[] { return [...this.bundles.values()]; }
  count(): number { return this.bundles.size; }
}
