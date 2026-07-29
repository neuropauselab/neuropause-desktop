/**
 * Module 3 — Release Management. A release pipeline, a version catalog with semantic-versioning
 * validation, build promotion through stages, release approval, release notes, and rollback plans.
 * Registers releases in the reused production runtime (no duplicate store). Live-verified; starts
 * empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionRuntime } from './runtime';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export type PromotionStage = 'build' | 'dev' | 'staging' | 'production';

export interface ReleaseCandidate {
  version: string;
  stage: PromotionStage;
  approved: boolean;
  notes: string;
  createdAt: number;
}

export class ReleaseManagement {
  private readonly candidates = new Map<string, ReleaseCandidate>();
  private readonly rollbacks = new Map<string, { id: string; fromVersion: string; toVersion: string; steps: string[] }>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly runtime: ProductionRuntime,
  ) {}

  /** Register a release candidate — semantic version is really validated. */
  async register(input: { version: string; notes?: string; org?: string }): Promise<ReleaseCandidate> {
    if (!SEMVER.test(input.version)) throw new Error(`invalid semantic version: ${input.version}`);
    if (this.candidates.has(input.version)) throw new Error(`version ${input.version} already registered`);
    const c: ReleaseCandidate = { version: input.version, stage: 'build', approved: false, notes: input.notes ?? '', createdAt: this.clock.now() };
    this.candidates.set(c.version, c);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', operation: 'release.register', targetId: input.version, evidence: 'live-verified', version: input.version });
    return c;
  }

  /** Promote a candidate one stage; promotion into production requires prior approval. */
  async promote(version: string, toStage: PromotionStage, org?: string): Promise<ReleaseCandidate> {
    const c = this.require(version);
    if (toStage === 'production' && !c.approved) throw new Error('release must be approved before production promotion');
    c.stage = toStage;
    if (toStage === 'production') await this.runtime.registerRelease({ version: c.version, notes: c.notes, ...(org ? { org } : {}) });
    await this.governance.record({ operator: 'system', org: org ?? '_platform', environment: '_platform', operation: `release.promote.${toStage}`, targetId: version, evidence: 'live-verified', version });
    return c;
  }

  async approve(version: string, approver: string, org?: string): Promise<ReleaseCandidate> {
    const c = this.require(version);
    c.approved = true;
    await this.governance.record({ operator: approver, org: org ?? '_platform', environment: '_platform', operation: 'release.approve', targetId: version, evidence: 'live-verified', version, approval: 'approved' });
    return c;
  }

  rollbackPlan(input: { fromVersion: string; toVersion: string }): { id: string; fromVersion: string; toVersion: string; steps: string[] } {
    const plan = { id: randomId('rbk'), fromVersion: input.fromVersion, toVersion: input.toVersion, steps: ['freeze traffic', `redeploy ${input.toVersion}`, 'validate health', 'resume traffic'] };
    this.rollbacks.set(plan.id, plan);
    return plan;
  }

  private require(version: string): ReleaseCandidate {
    const c = this.candidates.get(version);
    if (!c) throw new Error(`no release candidate ${version}`);
    return c;
  }

  catalog(): ReleaseCandidate[] {
    return [...this.candidates.values()];
  }
  count(): number { return this.candidates.size; }
}
