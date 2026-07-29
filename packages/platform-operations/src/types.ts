/**
 * Launch Workstream 1 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14. The
 * platform-operations control plane composes on the reused infrastructure, deploy, reliability, release,
 * customer-deployment, operations, production, security, ai-runtime, integration, and commercial
 * platforms; it never re-implements their runtimes and never modifies them.
 */
import type { ProductionEvidenceLevel, ProductionPlatform } from '@neuropause/production';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { DeploymentFoundation } from '@neuropause/deploy';
import type { ReliabilityPlatform } from '@neuropause/reliability';
import type { ReleasePlatform } from '@neuropause/release';
import type { CustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import type { OperationsPlatform } from '@neuropause/operations';
import type { SecurityPlatform } from '@neuropause/security';
import type { AiRuntime } from '@neuropause/ai-runtime';
import type { IntegrationPlatform } from '@neuropause/integration-platform';
import type { CommercialPlatform } from '@neuropause/commercial';

export type {
  ProductionEvidenceLevel,
  ProductionPlatform,
  InfrastructurePlatform,
  DeploymentFoundation,
  ReliabilityPlatform,
  ReleasePlatform,
  CustomerDeploymentPlatform,
  OperationsPlatform,
  SecurityPlatform,
  AiRuntime,
  IntegrationPlatform,
  CommercialPlatform,
};

/** Launch Workstream 1 uses the Wave 14 evidence model verbatim. */
export type PlatformOpsEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the control plane composes on (all optional — degraded honestly when absent). */
export interface PlatformOpsContext {
  infrastructure?: InfrastructurePlatform;
  deploy?: DeploymentFoundation;
  reliability?: ReliabilityPlatform;
  release?: ReleasePlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  operations?: OperationsPlatform;
  production?: ProductionPlatform;
  security?: SecurityPlatform;
  aiRuntime?: AiRuntime;
  integrationPlatform?: IntegrationPlatform;
  commercial?: CommercialPlatform;
}
