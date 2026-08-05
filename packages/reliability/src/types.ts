/**
 * Sprint 4 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 (live-verified /
 * adapter-verified / business-data-pending / infrastructure-pending) — the exact evidence model this
 * sprint requires. The reliability layer composes on the reused security, operations, production,
 * deploy, infrastructure, integration, workforce, workplace, business, commercial, and AI-runtime
 * platforms; it never re-implements their runtimes and never modifies them.
 */
import type { ProductionEvidenceLevel, ProductionPlatform } from '@neuropause/production';
import type { SecurityPlatform } from '@neuropause/security';
import type { OperationsPlatform } from '@neuropause/operations';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { DeploymentFoundation } from '@neuropause/deploy';
import type { IntegrationPlatform } from '@neuropause/integration-platform';
import type { WorkforcePlatform } from '@neuropause/workforce';
import type { WorkplacePlatform } from '@neuropause/workplace';
import type { BusinessPlatform } from '@neuropause/business';
import type { CommercialPlatform } from '@neuropause/commercial';
import type { AiRuntime } from '@neuropause/ai-runtime';

export type {
  ProductionEvidenceLevel,
  ProductionPlatform,
  SecurityPlatform,
  OperationsPlatform,
  InfrastructurePlatform,
  DeploymentFoundation,
  IntegrationPlatform,
  WorkforcePlatform,
  WorkplacePlatform,
  BusinessPlatform,
  CommercialPlatform,
  AiRuntime,
};

/** Sprint 4 uses the Wave 14 evidence model verbatim. */
export type ReliabilityEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the reliability layer composes on (all optional — degraded honestly when absent). */
export interface ReliabilityContext {
  security?: SecurityPlatform;
  operations?: OperationsPlatform;
  production?: ProductionPlatform;
  infrastructure?: InfrastructurePlatform;
  deploy?: DeploymentFoundation;
  integrationPlatform?: IntegrationPlatform;
  workforce?: WorkforcePlatform;
  workplace?: WorkplacePlatform;
  business?: BusinessPlatform;
  commercial?: CommercialPlatform;
  aiRuntime?: AiRuntime;
}
