/**
 * Version 1.1 Program 1C (Operator Deployment) composition root. `createOperatorDeployment(runtime, …)`
 * assembles the operator first-deployment workflow on the EXISTING platform: it reuses the one runtime
 * audit chain (governance) and the 1C environment-provisioning orchestration (which itself reuses the 1B
 * automation) as the deployment engine. No subsystem is duplicated and no prior package is modified. The
 * validator STOPS at PENDING when a dependency is unverified; the executor runs only after approval AND
 * successful validation and never fabricates success; nothing is Verified without real evidence.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { OD_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { OD_MATRIX, odReadiness, type CapabilityEvidence, type OdReadiness } from './evidence';
import type { OdContext, EnvironmentProvisioning, PlatformOperations } from './types';
import { OperatorDeploymentGovernance } from './governance';
import { DeploymentWizard } from './wizard';
import { EnvironmentValidator } from './validator';
import { DeploymentExecutor } from './executor';
import { LiveValidation } from './liveValidation';
import { RollbackEngine } from './rollback';
import { EvidencePackageBuilder } from './evidencePackage';
import { OperatorDashboard } from './dashboard';
import { OperatorDocumentation } from './documentation';
import { OperatorDeploymentSDK } from './sdk';

export interface OperatorDeploymentOptions {
  clock?: Clock;
  operator?: string;
  environmentProvisioning?: EnvironmentProvisioning;
  platformOperations?: PlatformOperations;
}

export interface OperatorDeployment {
  version: string;
  wizard(): DeploymentWizard;
  validator(): EnvironmentValidator;
  executor(): DeploymentExecutor;
  liveValidation(): LiveValidation;
  rollback(): RollbackEngine;
  evidencePackage(): EvidencePackageBuilder;
  dashboard(): OperatorDashboard;
  documentation(): OperatorDocumentation;
  sdk(): OperatorDeploymentSDK;
  governance(): OperatorDeploymentGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): OdReadiness;
}

export function createOperatorDeployment(runtime: EnterpriseRuntime, options: OperatorDeploymentOptions = {}): OperatorDeployment {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'operator-runtime';
  const ctx: OdContext = {
    ...(options.environmentProvisioning ? { environmentProvisioning: options.environmentProvisioning } : {}),
    ...(options.platformOperations ? { platformOperations: options.platformOperations } : {}),
  };

  const gov = new OperatorDeploymentGovernance(runtime, clock);
  const wizard = new DeploymentWizard(gov, operator);
  const validator = new EnvironmentValidator(gov, operator);
  const executor = new DeploymentExecutor(ctx, gov, operator);
  const liveValidation = new LiveValidation(ctx, gov, operator);
  const rollback = new RollbackEngine(ctx, gov, operator);
  const evidencePackage = new EvidencePackageBuilder(ctx, gov, operator);
  const dashboard = new OperatorDashboard();
  const documentation = new OperatorDocumentation(gov, operator);
  const sdk = new OperatorDeploymentSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: OD_VERSION,
    wizard: () => wizard,
    validator: () => validator,
    executor: () => executor,
    liveValidation: () => liveValidation,
    rollback: () => rollback,
    evidencePackage: () => evidencePackage,
    dashboard: () => dashboard,
    documentation: () => documentation,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => OD_MATRIX,
    readiness: () => odReadiness(),
  };
}
