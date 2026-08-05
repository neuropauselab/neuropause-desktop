/**
 * EPIC 17 — Pilot Customer Profile. Relife Ortho is represented as a CONFIGURATION PROFILE — data, not
 * code. `apply` derives a configuration plan from the profile's declared modules, AI workers, and
 * integration categories; the same engine takes any enterprise profile. No customer-specific workflow
 * is hard-coded, and the profile contains NO proprietary customer data (only generic module names).
 */
import { RELIFE_ORTHO_PROFILE, type CustomerProfile } from './constants';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface ProfileApplication {
  deploymentId: string;
  profileKey: string;
  displayName: string;
  businessModules: string[];
  industryModules: string[];
  aiWorkers: string[];
  integrationCategories: string[];
  identityProvider: string;
  dataOnly: true;
}

export class PilotProfile {
  private readonly profiles = new Map<string, CustomerProfile>([[RELIFE_ORTHO_PROFILE.key, RELIFE_ORTHO_PROFILE]]);

  constructor(
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  profiles_(): CustomerProfile[] {
    return [...this.profiles.values()];
  }
  get(key: string): CustomerProfile | undefined {
    return this.profiles.get(key);
  }
  register(profile: CustomerProfile): void {
    this.profiles.set(profile.key, profile);
  }

  /** Apply a profile as configuration data. Generic — swap the profile for any enterprise. */
  async apply(input: { deploymentId: string; profileKey?: string; profile?: CustomerProfile }): Promise<ProfileApplication> {
    const deployment = this.require(input.deploymentId);
    const profile = input.profile ?? this.profiles.get(input.profileKey ?? RELIFE_ORTHO_PROFILE.key);
    if (!profile) throw new Error(`unknown profile: ${input.profileKey}`);
    const application: ProfileApplication = {
      deploymentId: input.deploymentId,
      profileKey: profile.key,
      displayName: profile.displayName,
      businessModules: profile.businessModules,
      industryModules: profile.industryModules,
      aiWorkers: profile.aiWorkers,
      integrationCategories: profile.integrationCategories,
      identityProvider: profile.identityProvider,
      dataOnly: true,
    };
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E17',
      operation: 'apply-profile',
      targetId: profile.key,
      evidence: 'live-verified',
      decision: `${profile.businessModules.length} business + ${profile.industryModules.length} industry modules`,
    });
    return application;
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
