/**
 * Sprint 6 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 (live-verified /
 * adapter-verified / business-data-pending / infrastructure-pending). The release layer composes on the
 * reused reliability, customer-deployment, commercial, operations, deploy, production, security,
 * infrastructure, business, workforce, workplace, and integration platforms; it never re-implements
 * their runtimes and never modifies them.
 */
import type { ProductionEvidenceLevel, ProductionPlatform } from '@neuropause/production';
import type { ReliabilityPlatform } from '@neuropause/reliability';
import type { CustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import type { CommercialPlatform } from '@neuropause/commercial';
import type { OperationsPlatform } from '@neuropause/operations';
import type { DeploymentFoundation } from '@neuropause/deploy';
import type { SecurityPlatform } from '@neuropause/security';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { BusinessPlatform } from '@neuropause/business';
import type { WorkforcePlatform } from '@neuropause/workforce';
import type { WorkplacePlatform } from '@neuropause/workplace';
import type { IntegrationPlatform } from '@neuropause/integration-platform';

export type {
  ProductionEvidenceLevel,
  ProductionPlatform,
  ReliabilityPlatform,
  CustomerDeploymentPlatform,
  CommercialPlatform,
  OperationsPlatform,
  DeploymentFoundation,
  SecurityPlatform,
  InfrastructurePlatform,
  BusinessPlatform,
  WorkforcePlatform,
  WorkplacePlatform,
  IntegrationPlatform,
};

/** Sprint 6 uses the Wave 14 evidence model verbatim. */
export type ReleaseEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the release layer composes on (all optional — degraded honestly when absent). */
export interface ReleaseContext {
  reliability?: ReliabilityPlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  commercial?: CommercialPlatform;
  operations?: OperationsPlatform;
  deploy?: DeploymentFoundation;
  production?: ProductionPlatform;
  security?: SecurityPlatform;
  infrastructure?: InfrastructurePlatform;
  business?: BusinessPlatform;
  workforce?: WorkforcePlatform;
  workplace?: WorkplacePlatform;
  integrationPlatform?: IntegrationPlatform;
}
