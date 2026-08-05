/**
 * Version 1.1 Program 1C shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 and the
 * Program 1B platform-automation as the primary generation engine. The provisioning layer never
 * re-implements a generator or a runtime and never modifies a prior package.
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { PlatformAutomation } from '@neuropause/platform-automation';
import type { DeploymentOrchestratorPlatform } from '@neuropause/deployment-orchestrator';
import type { PlatformOperations } from '@neuropause/platform-operations';
import type { CloudProvider, ProvisioningPhase, ProvisionStatus } from './constants';

export type {
  ProductionEvidenceLevel,
  PlatformAutomation,
  DeploymentOrchestratorPlatform,
  PlatformOperations,
};

/** Version 1.1 Program 1C uses the Wave 14 evidence model verbatim. */
export type EpEvidenceLevel = ProductionEvidenceLevel;

/** Operator-provided inputs. All are REFERENCES/identifiers — never real secrets or credentials. */
export interface OperatorInputs {
  cloudProvider?: CloudProvider;
  cloudCredentialsRef?: string;
  domain?: string;
  containerRegistryRef?: string;
  dnsZoneRef?: string;
  tlsAuthorityRef?: string;
  secretsManagerRef?: string;
  approval?: { operator: string; approved: boolean };
}

/** One provisioning step's outcome. `provisioned` is ALWAYS false — this control plane applies nothing. */
export interface ProvisioningStep {
  phase: ProvisioningPhase;
  epic: string;
  status: ProvisionStatus;
  provisioned: false;
  missing: string[];
  artifactName: string | null;
  applyCommands: string[];
  evidenceRequired: string[];
  note: string;
}

/** The reused platforms the provisioning layer composes on (all optional — degraded honestly when absent). */
export interface EpContext {
  platformAutomation?: PlatformAutomation;
  deploymentOrchestrator?: DeploymentOrchestratorPlatform;
  platformOperations?: PlatformOperations;
}
