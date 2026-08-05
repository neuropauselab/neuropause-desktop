/**
 * Version 1.1 Program 1C (Operator Deployment) shared types. REUSES the Wave 14 evidence model and the
 * Program 1C environment-provisioning orchestration as the provisioning engine. Never modifies a prior
 * package.
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { EnvironmentProvisioning, OperatorInputs } from '@neuropause/environment-provisioning';
import type { PlatformOperations } from '@neuropause/platform-operations';

export type { ProductionEvidenceLevel, EnvironmentProvisioning, OperatorInputs, PlatformOperations };

/** Version 1.1 Program 1C uses the Wave 14 evidence model verbatim. */
export type OdEvidenceLevel = ProductionEvidenceLevel;

/** The operator's wizard configuration. All fields are references/identifiers — never secret values. */
export interface WizardConfig {
  cloudProvider?: 'aws' | 'azure' | 'gcp' | 'self-hosted';
  region?: string;
  domain?: string;
  kubernetesRef?: string;
  postgresqlRef?: string;
  redisRef?: string;
  objectStorageRef?: string;
  containerRegistryRef?: string;
  secretsManagerRef?: string;
  credentialsRef?: string;
  dnsZoneRef?: string;
  tlsIssuerRef?: string;
}

/** The reused platforms the operator flow composes on (all optional — degraded honestly when absent). */
export interface OdContext {
  environmentProvisioning?: EnvironmentProvisioning;
  platformOperations?: PlatformOperations;
}
