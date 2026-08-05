/**
 * Sprint 5 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 (live-verified /
 * adapter-verified / business-data-pending / infrastructure-pending). The customer-deployment layer
 * composes on the reused security, infrastructure, deploy, reliability, integration, business,
 * industry, workplace, workforce, operations, commercial, production, and AI-runtime platforms; it
 * never re-implements their runtimes and never modifies them.
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { SecurityPlatform } from '@neuropause/security';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { DeploymentFoundation } from '@neuropause/deploy';
import type { ReliabilityPlatform } from '@neuropause/reliability';
import type { IntegrationPlatform } from '@neuropause/integration-platform';
import type { BusinessPlatform } from '@neuropause/business';
import type { IndustryPlatform } from '@neuropause/industry';
import type { WorkplacePlatform } from '@neuropause/workplace';
import type { WorkforcePlatform } from '@neuropause/workforce';
import type { OperationsPlatform } from '@neuropause/operations';
import type { CommercialPlatform } from '@neuropause/commercial';
import type { ProductionPlatform } from '@neuropause/production';
import type { AiRuntime } from '@neuropause/ai-runtime';

export type {
  ProductionEvidenceLevel,
  SecurityPlatform,
  InfrastructurePlatform,
  DeploymentFoundation,
  ReliabilityPlatform,
  IntegrationPlatform,
  BusinessPlatform,
  IndustryPlatform,
  WorkplacePlatform,
  WorkforcePlatform,
  OperationsPlatform,
  CommercialPlatform,
  ProductionPlatform,
  AiRuntime,
};

/** Sprint 5 uses the Wave 14 evidence model verbatim. */
export type DeploymentEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the customer-deployment layer composes on (all optional — degraded honestly when absent). */
export interface CustomerDeploymentContext {
  security?: SecurityPlatform;
  infrastructure?: InfrastructurePlatform;
  deploy?: DeploymentFoundation;
  reliability?: ReliabilityPlatform;
  integrationPlatform?: IntegrationPlatform;
  business?: BusinessPlatform;
  industry?: IndustryPlatform;
  workplace?: WorkplacePlatform;
  workforce?: WorkforcePlatform;
  operations?: OperationsPlatform;
  commercial?: CommercialPlatform;
  production?: ProductionPlatform;
  aiRuntime?: AiRuntime;
}
