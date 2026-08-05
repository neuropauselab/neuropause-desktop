/**
 * Module 7 — Feature Flag Platform. Feature flags, canary releases, beta features, and organization
 * / environment overrides. Resolution precedence is real and deterministic: an org override wins
 * over an environment override, which wins over the flag's default. Canary and beta flags default
 * OFF unless explicitly overridden on. In-process — live-verified; starts empty.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import { FEATURE_STAGES, type FeatureStage } from './constants';

export interface FeatureFlag {
  key: string;
  stage: FeatureStage;
  defaultOn: boolean;
  orgOverrides: Record<string, boolean>;
  envOverrides: Record<string, boolean>;
  createdAt: number;
}

export class FeatureFlagPlatform {
  private readonly flags = new Map<string, FeatureFlag>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async define(input: { key: string; stage?: FeatureStage; defaultOn?: boolean }): Promise<FeatureFlag> {
    const stage = input.stage ?? 'ga';
    if (!FEATURE_STAGES.includes(stage)) throw new Error(`unknown feature stage: ${stage}`);
    // canary/beta default OFF unless explicitly turned on
    const defaultOn = input.defaultOn ?? stage === 'ga';
    const flag: FeatureFlag = { key: input.key, stage, defaultOn, orgOverrides: {}, envOverrides: {}, createdAt: this.clock.now() };
    this.flags.set(flag.key, flag);
    await this.governance.record({ actor: 'system', org: '_platform', tenant: '_platform', operation: `feature.define.${stage}`, targetId: flag.key, evidence: 'live-verified' });
    return flag;
  }

  setOrgOverride(key: string, orgId: string, on: boolean): FeatureFlag {
    const f = this.require(key);
    f.orgOverrides[orgId] = on;
    return f;
  }
  setEnvOverride(key: string, env: string, on: boolean): FeatureFlag {
    const f = this.require(key);
    f.envOverrides[env] = on;
    return f;
  }

  /** Deterministic resolution: org override → env override → default. */
  isEnabled(key: string, ctx: { orgId?: string; env?: string } = {}): boolean {
    const f = this.flags.get(key);
    if (!f) return false;
    if (ctx.orgId !== undefined && ctx.orgId in f.orgOverrides) return f.orgOverrides[ctx.orgId]!;
    if (ctx.env !== undefined && ctx.env in f.envOverrides) return f.envOverrides[ctx.env]!;
    return f.defaultOn;
  }

  private require(key: string): FeatureFlag {
    const f = this.flags.get(key);
    if (!f) throw new Error(`no feature flag ${key}`);
    return f;
  }

  get(key: string): FeatureFlag | undefined { return this.flags.get(key); }
  list(stage?: FeatureStage): FeatureFlag[] {
    const all = [...this.flags.values()];
    return stage ? all.filter((f) => f.stage === stage) : all;
  }
  count(): number { return this.flags.size; }
}
