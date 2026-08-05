/**
 * Launch Workstream 2 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14. The
 * customer-experience layer composes on the reused security, commercial, release, customer-deployment,
 * operations, workplace, ai-runtime, reliability, and production platforms; it never re-implements their
 * runtimes and never modifies them.
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { SecurityPlatform } from '@neuropause/security';
import type { CommercialPlatform } from '@neuropause/commercial';
import type { ReleasePlatform } from '@neuropause/release';
import type { CustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import type { OperationsPlatform } from '@neuropause/operations';
import type { WorkplacePlatform } from '@neuropause/workplace';
import type { AiRuntime } from '@neuropause/ai-runtime';
import type { ReliabilityPlatform } from '@neuropause/reliability';
import type { ProductionPlatform } from '@neuropause/production';

export type {
  ProductionEvidenceLevel,
  SecurityPlatform,
  CommercialPlatform,
  ReleasePlatform,
  CustomerDeploymentPlatform,
  OperationsPlatform,
  WorkplacePlatform,
  AiRuntime,
  ReliabilityPlatform,
  ProductionPlatform,
};

/** Launch Workstream 2 uses the Wave 14 evidence model verbatim. */
export type CxEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the customer-experience layer composes on (all optional — degraded honestly). */
export interface CxContext {
  security?: SecurityPlatform;
  commercial?: CommercialPlatform;
  release?: ReleasePlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  operations?: OperationsPlatform;
  workplace?: WorkplacePlatform;
  aiRuntime?: AiRuntime;
  reliability?: ReliabilityPlatform;
  production?: ProductionPlatform;
}
