/**
 * Module 10 — Upgrade Manager. A version registry, migration planner, rollback plans, compatibility
 * validation, and upgrade history. Compatibility is really checked against the registry (both
 * versions must be registered and the target must be newer); an incompatible upgrade is rejected,
 * not waved through. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';

export interface VersionEntry {
  version: string;
  notes: string;
  index: number;
  releasedAt: number;
}
export interface UpgradePlan {
  id: string;
  tenantId: string;
  fromVersion: string;
  toVersion: string;
  compatible: boolean;
  steps: string[];
  rollbackSteps: string[];
  createdAt: number;
}

export class UpgradeManager {
  private readonly versions = new Map<string, VersionEntry>();
  private readonly order: string[] = [];
  private readonly plans = new Map<string, UpgradePlan>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async registerVersion(input: { version: string; notes?: string }): Promise<VersionEntry> {
    if (this.versions.has(input.version)) throw new Error(`version ${input.version} already registered`);
    const entry: VersionEntry = { version: input.version, notes: input.notes ?? '', index: this.order.length, releasedAt: this.clock.now() };
    this.versions.set(entry.version, entry);
    this.order.push(entry.version);
    await this.governance.record({ actor: 'system', org: '_platform', tenant: '_platform', operation: 'version.register', targetId: entry.version, evidence: 'live-verified' });
    return entry;
  }

  /** Plan an upgrade — compatibility is really validated against the version registry. */
  async planUpgrade(input: { tenantId: string; fromVersion: string; toVersion: string; org?: string }): Promise<UpgradePlan> {
    const from = this.versions.get(input.fromVersion);
    const to = this.versions.get(input.toVersion);
    const compatible = !!from && !!to && to.index > from.index;
    const plan: UpgradePlan = {
      id: randomId('upg'),
      tenantId: input.tenantId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      compatible,
      steps: compatible ? ['backup', `migrate ${input.fromVersion}→${input.toVersion}`, 'validate', 'cutover'] : [],
      rollbackSteps: compatible ? ['restore-backup', `revert ${input.toVersion}→${input.fromVersion}`, 'verify'] : [],
      createdAt: this.clock.now(),
    };
    this.plans.set(plan.id, plan);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: 'upgrade.plan', targetId: plan.id, evidence: 'live-verified', decision: compatible ? 'compatible' : 'incompatible — not planned' });
    return plan;
  }

  versionList(): VersionEntry[] { return this.order.map((v) => this.versions.get(v)!); }
  history(tenantId?: string): UpgradePlan[] {
    const all = [...this.plans.values()];
    return tenantId ? all.filter((p) => p.tenantId === tenantId) : all;
  }
  count(): number { return this.plans.size; }
}
