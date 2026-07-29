/**
 * Version 1.1 Program 1C composition root. `createEnvironmentProvisioning(runtime, …)` assembles the
 * provisioning-orchestration control plane on the EXISTING platform: it reuses the one runtime audit
 * chain + event bus (provisioning governance) and the Program 1B platform-automation as the artifact
 * generator (Terraform/Kubernetes/database/DNS-TLS/secrets/monitoring/CI-CD), and — where wired — the
 * deployment-orchestrator and platform-operations. No subsystem is duplicated and no prior package is
 * modified. Preview provisions nothing; provision stops at PENDING when operator inputs are missing and
 * otherwise only prepares — nothing is provisioned, applied, or claimed successful.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { EP_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { EP_MATRIX, epReadiness, type CapabilityEvidence, type EpReadiness } from './evidence';
import type { EpContext, PlatformAutomation, DeploymentOrchestratorPlatform, PlatformOperations } from './types';
import { EnvironmentProvisioningGovernance } from './governance';
import { PrerequisiteGate } from './prerequisites';
import { PhaseProvisioner } from './provisioners';
import { CloudProvisioningRuntime } from './cloudRuntime';
import { AcceptanceValidator } from './acceptance';
import { EvidencePromotion } from './evidencePromotion';
import { ProvisioningDashboard } from './opsDashboard';
import { EnvironmentProvisioningSDK } from './sdk';

export interface EnvironmentProvisioningOptions {
  clock?: Clock;
  operator?: string;
  platformAutomation?: PlatformAutomation;
  deploymentOrchestrator?: DeploymentOrchestratorPlatform;
  platformOperations?: PlatformOperations;
}

export interface EnvironmentProvisioning {
  version: string;
  cloud(): CloudProvisioningRuntime;
  prerequisites(): PrerequisiteGate;
  provisioner(): PhaseProvisioner;
  acceptance(): AcceptanceValidator;
  evidencePromotion(): EvidencePromotion;
  dashboard(): ProvisioningDashboard;
  sdk(): EnvironmentProvisioningSDK;
  governance(): EnvironmentProvisioningGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): EpReadiness;
}

export function createEnvironmentProvisioning(runtime: EnterpriseRuntime, options: EnvironmentProvisioningOptions = {}): EnvironmentProvisioning {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'provisioning-runtime';
  const ctx: EpContext = {
    ...(options.platformAutomation ? { platformAutomation: options.platformAutomation } : {}),
    ...(options.deploymentOrchestrator ? { deploymentOrchestrator: options.deploymentOrchestrator } : {}),
    ...(options.platformOperations ? { platformOperations: options.platformOperations } : {}),
  };

  const gov = new EnvironmentProvisioningGovernance(runtime, clock);
  const gate = new PrerequisiteGate();
  const provisioner = new PhaseProvisioner(ctx, gate, gov, operator);
  const cloud = new CloudProvisioningRuntime(gate, provisioner, gov, operator);
  const acceptance = new AcceptanceValidator(ctx, gov, operator);
  const evidencePromotion = new EvidencePromotion(gov, operator);
  const dashboard = new ProvisioningDashboard();
  const sdk = new EnvironmentProvisioningSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: EP_VERSION,
    cloud: () => cloud,
    prerequisites: () => gate,
    provisioner: () => provisioner,
    acceptance: () => acceptance,
    evidencePromotion: () => evidencePromotion,
    dashboard: () => dashboard,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => EP_MATRIX,
    readiness: () => epReadiness(),
  };
}
