/**
 * Launch Workstream 5 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14. The
 * deployment-orchestration layer composes on the reused release, trust, enterprise-connectivity,
 * customer-experience, platform-operations, reliability, customer-deployment, and commercial platforms;
 * it never re-implements their runtimes and never modifies them. Every reused platform is optional — the
 * launch layer degrades honestly when a platform is absent (empty registries, represented profiles, a
 * lower launch-readiness score — never a fabricated deployment, contract, or customer).
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { ReleasePlatform } from '@neuropause/release';
import type { TrustPlatform } from '@neuropause/trust-platform';
import type { EnterpriseConnectivity } from '@neuropause/enterprise-connectivity';
import type { CustomerExperience } from '@neuropause/customer-experience';
import type { PlatformOperations } from '@neuropause/platform-operations';
import type { ReliabilityPlatform } from '@neuropause/reliability';
import type { CustomerDeploymentPlatform } from '@neuropause/customer-deployment';
import type { CommercialPlatform } from '@neuropause/commercial';

export type {
  ProductionEvidenceLevel,
  ReleasePlatform,
  TrustPlatform,
  EnterpriseConnectivity,
  CustomerExperience,
  PlatformOperations,
  ReliabilityPlatform,
  CustomerDeploymentPlatform,
  CommercialPlatform,
};

/** Launch Workstream 5 uses the Wave 14 evidence model verbatim. */
export type DoEvidenceLevel = ProductionEvidenceLevel;

/** The common readiness shape every reused platform exposes — used to compose the launch-readiness score. */
export interface ReadinessLike {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

/** The reused platforms the launch layer composes on (all optional — degraded honestly when absent). */
export interface DoContext {
  release?: ReleasePlatform;
  trustPlatform?: TrustPlatform;
  enterpriseConnectivity?: EnterpriseConnectivity;
  customerExperience?: CustomerExperience;
  platformOperations?: PlatformOperations;
  reliability?: ReliabilityPlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  commercial?: CommercialPlatform;
}
