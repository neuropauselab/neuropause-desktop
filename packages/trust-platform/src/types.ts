/**
 * Launch Workstream 4 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14. The
 * trust platform composes on the reused security, operations, platform-operations, release, enterprise-
 * connectivity, infrastructure, and reliability platforms; it never re-implements their runtimes and
 * never modifies them. Every reused platform is optional — the trust layer degrades honestly when a
 * platform is absent (empty registries, "represented", certified:false, never fabricated results).
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { SecurityPlatform } from '@neuropause/security';
import type { OperationsPlatform } from '@neuropause/operations';
import type { PlatformOperations } from '@neuropause/platform-operations';
import type { ReleasePlatform } from '@neuropause/release';
import type { EnterpriseConnectivity } from '@neuropause/enterprise-connectivity';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { ReliabilityPlatform } from '@neuropause/reliability';

export type {
  ProductionEvidenceLevel,
  SecurityPlatform,
  OperationsPlatform,
  PlatformOperations,
  ReleasePlatform,
  EnterpriseConnectivity,
  InfrastructurePlatform,
  ReliabilityPlatform,
};

/** Launch Workstream 4 uses the Wave 14 evidence model verbatim. */
export type TpEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the trust layer composes on (all optional — degraded honestly when absent). */
export interface TpContext {
  security?: SecurityPlatform;
  operations?: OperationsPlatform;
  platformOperations?: PlatformOperations;
  release?: ReleasePlatform;
  enterpriseConnectivity?: EnterpriseConnectivity;
  infrastructure?: InfrastructurePlatform;
  reliability?: ReliabilityPlatform;
}
