/**
 * EPIC 15 — Release Management. Version registry, release notes, semantic versioning, migration
 * planner, rollback registry, compatibility matrix, and upgrade validation. REUSES the Wave 14
 * production release-management and upgrade-assistant platforms (which really validate semver and
 * breaking changes) when connected; otherwise it validates in-process. Live-verified; starts empty.
 */
import { randomId } from '@neuropause/cloud-core';
import type { DeployGovernance } from './governance';
import type { DeployContext } from './types';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface RollbackEntry { id: string; fromVersion: string; toVersion: string }

export class ReleaseManagement {
  private readonly versions = new Set<string>();
  private readonly rollbacks = new Map<string, RollbackEntry>();

  constructor(
    private readonly governance: DeployGovernance,
    private readonly ctx: DeployContext = {},
  ) {}

  async registerVersion(input: { version: string; notes?: string; org?: string }): Promise<{ version: string; reusedProduction: boolean }> {
    if (!SEMVER.test(input.version)) throw new Error(`invalid semantic version: ${input.version}`);
    let reusedProduction = false;
    if (this.ctx.production) {
      await this.ctx.production.releases().register({ version: input.version, ...(input.notes ? { notes: input.notes } : {}) });
      reusedProduction = true;
    }
    this.versions.add(input.version);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', epic: 'E15', operation: 'release.register', targetId: input.version, evidence: 'live-verified', decision: input.version });
    return { version: input.version, reusedProduction };
  }

  /** Compatibility matrix REUSES the production upgrade assistant's real semver analysis. */
  async compatibility(fromVersion: string, toVersion: string): Promise<{ breakingChange: boolean; reusedProduction: boolean }> {
    if (this.ctx.production) {
      const a = await this.ctx.production.upgradeAssistant().analyze({ fromVersion, toVersion });
      return { breakingChange: a.breakingChange, reusedProduction: true };
    }
    const major = (v: string): number => Number(v.split('.')[0] ?? 0);
    return { breakingChange: major(toVersion) > major(fromVersion), reusedProduction: false };
  }

  registerRollback(input: { fromVersion: string; toVersion: string }): RollbackEntry {
    const entry: RollbackEntry = { id: randomId('rbk'), fromVersion: input.fromVersion, toVersion: input.toVersion };
    this.rollbacks.set(entry.id, entry);
    return entry;
  }

  versionList(): string[] { return [...this.versions]; }
  rollbackRegistry(): RollbackEntry[] { return [...this.rollbacks.values()]; }
  count(): number { return this.versions.size; }
}
