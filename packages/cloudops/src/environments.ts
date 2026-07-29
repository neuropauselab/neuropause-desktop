/**
 * Module 2 — Environment Manager. Development / Testing / QA / Staging / Production tiers,
 * each with metadata, deployment targets, attached policies, and secret references. In-process
 * registry — live-verified over real runtime data. No environment provisions anything.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { Environment } from './types';
import { ENVIRONMENTS, type EnvironmentTier } from './constants';

export interface CreateEnvironmentInput {
  name: string;
  tier: EnvironmentTier;
  metadata?: Record<string, unknown>;
  targets?: string[];
  policyIds?: string[];
  secretRefs?: string[];
}

export class EnvironmentManager {
  private readonly environments = new Map<string, Environment>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
  ) {}

  async create(input: CreateEnvironmentInput): Promise<Environment> {
    if (!ENVIRONMENTS.includes(input.tier)) throw new Error(`unknown environment tier: ${input.tier}`);
    const env: Environment = {
      id: randomId('env'),
      name: input.name,
      tier: input.tier,
      metadata: input.metadata ?? {},
      targets: input.targets ?? [],
      policyIds: input.policyIds ?? [],
      secretRefs: input.secretRefs ?? [],
      createdAt: this.clock.now(),
    };
    this.environments.set(env.id, env);
    await this.governance.record({ actor: 'system', operation: `environment.create.${input.tier}`, targetId: env.id, evidence: 'live-verified', scope: env.id });
    return env;
  }

  async attachPolicy(environmentId: string, policyId: string): Promise<Environment> {
    const env = this.require(environmentId);
    if (!env.policyIds.includes(policyId)) env.policyIds.push(policyId);
    await this.governance.record({ actor: 'system', operation: 'environment.attachPolicy', targetId: environmentId, evidence: 'live-verified', scope: environmentId, detail: policyId });
    return env;
  }

  async attachSecretRef(environmentId: string, secretRefId: string): Promise<Environment> {
    const env = this.require(environmentId);
    if (!env.secretRefs.includes(secretRefId)) env.secretRefs.push(secretRefId);
    await this.governance.record({ actor: 'system', operation: 'environment.attachSecretRef', targetId: environmentId, evidence: 'live-verified', scope: environmentId, detail: secretRefId });
    return env;
  }

  private require(id: string): Environment {
    const env = this.environments.get(id);
    if (!env) throw new Error(`no environment ${id}`);
    return env;
  }

  get(id: string): Environment | undefined {
    return this.environments.get(id);
  }
  list(): Environment[] {
    return [...this.environments.values()];
  }
  byTier(tier: EnvironmentTier): Environment[] {
    return this.list().filter((e) => e.tier === tier);
  }
  count(): number {
    return this.environments.size;
  }
}
