/**
 * Launch Workstream 3 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14. The
 * enterprise-connectivity layer composes on the reused integration-platform, security, infrastructure,
 * ai-runtime, operations, platform-operations, and reliability platforms; it never re-implements their
 * runtimes and never modifies them.
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { IntegrationPlatform } from '@neuropause/integration-platform';
import type { SecurityPlatform } from '@neuropause/security';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { AiRuntime } from '@neuropause/ai-runtime';
import type { OperationsPlatform } from '@neuropause/operations';
import type { PlatformOperations } from '@neuropause/platform-operations';
import type { ReliabilityPlatform } from '@neuropause/reliability';

export type {
  ProductionEvidenceLevel,
  IntegrationPlatform,
  SecurityPlatform,
  InfrastructurePlatform,
  AiRuntime,
  OperationsPlatform,
  PlatformOperations,
  ReliabilityPlatform,
};

/** Launch Workstream 3 uses the Wave 14 evidence model verbatim. */
export type EcEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the connectivity layer composes on (all optional — degraded honestly when absent). */
export interface EcContext {
  integrationPlatform?: IntegrationPlatform;
  security?: SecurityPlatform;
  infrastructure?: InfrastructurePlatform;
  aiRuntime?: AiRuntime;
  operations?: OperationsPlatform;
  platformOperations?: PlatformOperations;
  reliability?: ReliabilityPlatform;
}
