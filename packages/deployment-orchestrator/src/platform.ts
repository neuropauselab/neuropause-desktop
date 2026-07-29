/**
 * Launch Workstream 5 composition root. `createDeploymentOrchestrator(runtime, …)` assembles the
 * deployment-orchestration & launch control plane on the EXISTING platform: it reuses the one runtime
 * audit chain + event bus (deployment governance), the Sprint-6 Release platform (the GA gate, RC
 * validation, and release management), and the composed readiness of platform-operations, customer-
 * experience, enterprise-connectivity, trust-platform, release, and reliability (launch-readiness
 * scoring). No subsystem is duplicated and no prior package is modified. No enterprise, government, or
 * public-sector deployment; procurement approval; signed contract; production revenue; or marketplace
 * publication is ever claimed — this is deployment READINESS, not claimed deployment.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { DO_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { DO_MATRIX, doReadiness, type CapabilityEvidence, type DoReadiness } from './evidence';
import type {
  DoContext,
  ReleasePlatform,
  TrustPlatform,
  EnterpriseConnectivity,
  CustomerExperience,
  PlatformOperations,
  ReliabilityPlatform,
  CustomerDeploymentPlatform,
  CommercialPlatform,
} from './types';
import { DeploymentOrchestratorGovernance } from './governance';
import { DeploymentOrchestrator } from './deploymentOrchestrator';
import { PilotProgram } from './pilotProgram';
import { GovernmentTemplates } from './governmentTemplates';
import { EnterpriseRollout } from './enterpriseRollout';
import { GaProgram } from './gaProgram';
import { CustomerSuccessOps } from './customerSuccess';
import { CommercialOps } from './commercialOps';
import { PartnerEcosystem } from './partnerEcosystem';
import { GovernmentReadiness } from './governmentReadiness';
import { TrainingEnablement } from './training';
import { LaunchDocumentation } from './documentation';
import { BusinessLaunchReadiness } from './businessLaunchReadiness';
import { LaunchOperationsCenter } from './launchOperationsCenter';
import { DeploymentOrchestratorSDK } from './sdk';

export interface DeploymentOrchestratorOptions {
  clock?: Clock;
  operator?: string;
  release?: ReleasePlatform;
  trustPlatform?: TrustPlatform;
  enterpriseConnectivity?: EnterpriseConnectivity;
  customerExperience?: CustomerExperience;
  platformOperations?: PlatformOperations;
  reliability?: ReliabilityPlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  commercial?: CommercialPlatform;
}

export interface DeploymentOrchestratorPlatform {
  version: string;
  deployments(): DeploymentOrchestrator;
  pilots(): PilotProgram;
  governmentTemplates(): GovernmentTemplates;
  rollout(): EnterpriseRollout;
  ga(): GaProgram;
  customerSuccess(): CustomerSuccessOps;
  commercial(): CommercialOps;
  partners(): PartnerEcosystem;
  governmentReadiness(): GovernmentReadiness;
  launchOps(): LaunchOperationsCenter;
  training(): TrainingEnablement;
  documentation(): LaunchDocumentation;
  launchReadiness(): BusinessLaunchReadiness;
  sdk(): DeploymentOrchestratorSDK;
  governance(): DeploymentOrchestratorGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): DoReadiness;
}

export function createDeploymentOrchestrator(runtime: EnterpriseRuntime, options: DeploymentOrchestratorOptions = {}): DeploymentOrchestratorPlatform {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'launch-runtime';
  const ctx: DoContext = {
    ...(options.release ? { release: options.release } : {}),
    ...(options.trustPlatform ? { trustPlatform: options.trustPlatform } : {}),
    ...(options.enterpriseConnectivity ? { enterpriseConnectivity: options.enterpriseConnectivity } : {}),
    ...(options.customerExperience ? { customerExperience: options.customerExperience } : {}),
    ...(options.platformOperations ? { platformOperations: options.platformOperations } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
    ...(options.customerDeployment ? { customerDeployment: options.customerDeployment } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
  };

  const gov = new DeploymentOrchestratorGovernance(runtime, clock);
  const deployments = new DeploymentOrchestrator(gov, operator);
  const pilots = new PilotProgram(gov, operator);
  const governmentTemplates = new GovernmentTemplates(gov, operator);
  const rollout = new EnterpriseRollout(gov, operator);
  const ga = new GaProgram(ctx, gov, operator);
  const customerSuccess = new CustomerSuccessOps(gov, operator);
  const commercial = new CommercialOps(gov, operator);
  const partners = new PartnerEcosystem(gov, operator);
  const governmentReadiness = new GovernmentReadiness(gov, operator);
  const training = new TrainingEnablement(gov, operator);
  const documentation = new LaunchDocumentation(gov, operator);
  const launchReadiness = new BusinessLaunchReadiness(ctx, { documentation, training }, gov, operator);
  const launchOps = new LaunchOperationsCenter({ deployment: deployments, rollout, government: governmentReadiness, commercial, launchReadiness });
  const sdk = new DeploymentOrchestratorSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: DO_VERSION,
    deployments: () => deployments,
    pilots: () => pilots,
    governmentTemplates: () => governmentTemplates,
    rollout: () => rollout,
    ga: () => ga,
    customerSuccess: () => customerSuccess,
    commercial: () => commercial,
    partners: () => partners,
    governmentReadiness: () => governmentReadiness,
    launchOps: () => launchOps,
    training: () => training,
    documentation: () => documentation,
    launchReadiness: () => launchReadiness,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => DO_MATRIX,
    readiness: () => doReadiness(),
  };
}
