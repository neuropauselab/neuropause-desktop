/**
 * Module 18 — Enterprise Marketplace. Install workspace apps, industry apps, internal apps, AI
 * skills, widgets, dashboards, and templates. Installs are an in-process registry (live-verified);
 * real cross-org distribution reuses the Wave 6 federation marketplace and is not performed here.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import { MARKETPLACE_APP_KINDS, type MarketplaceAppKind } from './constants';

export interface InstalledApp {
  id: string;
  kind: MarketplaceAppKind;
  name: string;
  publisher: string;
  installedAt: number;
}

export class WorkspaceMarketplace {
  private readonly installs = new Map<string, InstalledApp>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async install(input: { kind: MarketplaceAppKind; name: string; publisher?: string }): Promise<InstalledApp> {
    if (!MARKETPLACE_APP_KINDS.includes(input.kind)) throw new Error(`unknown marketplace app kind: ${input.kind}`);
    const app: InstalledApp = { id: randomId('app'), kind: input.kind, name: input.name, publisher: input.publisher ?? 'internal', installedAt: this.clock.now() };
    this.installs.set(app.id, app);
    await this.governance.record({ actor: 'system', module: 'marketplace', operation: `install.${input.kind}`, targetId: app.id, evidence: 'live-verified', detail: input.name });
    return app;
  }

  installed(kind?: MarketplaceAppKind): InstalledApp[] {
    const all = [...this.installs.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }
  count(): number { return this.installs.size; }
}
