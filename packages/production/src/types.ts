/**
 * Wave 14 shared types. Wave 14 uses a four-level evidence boundary whose fourth level is
 * INFRASTRUCTURE-PENDING (real HA clusters, multi-region failover, production DR, global
 * replication) rather than the regulated-external level used by the commercial wave — so a local
 * ProductionEvidenceLevel is defined here (additive; the business EvidenceLevel is not reused for
 * this axis). The production platform composes on the reused cloud-ops, operations, security,
 * mission-control, commercial, business, workforce, and workplace platforms — it never
 * re-implements their runtimes.
 */
import type { CloudOpsPlatform } from '@neuropause/cloudops';
import type { OperationsPlatform } from '@neuropause/operations';
import type { SecurityPlatform } from '@neuropause/security';
import type { AutonomousOpsPlatform } from '@neuropause/autonomous-ops';
import type { CommercialPlatform } from '@neuropause/commercial';
import type { BusinessPlatform } from '@neuropause/business';
import type { WorkforcePlatform } from '@neuropause/workforce';
import type { WorkplacePlatform } from '@neuropause/workplace';

export type { CloudOpsPlatform, OperationsPlatform, SecurityPlatform, AutonomousOpsPlatform, CommercialPlatform, BusinessPlatform, WorkforcePlatform, WorkplacePlatform };

/** The four-level honesty boundary for Wave 14 (infrastructure-pending replaces regulated-external). */
export type ProductionEvidenceLevel = 'live-verified' | 'adapter-verified' | 'business-data-pending' | 'infrastructure-pending';

/** The reused platforms the production runtime composes on (all optional — represented when absent). */
export interface ProductionContext {
  cloudops?: CloudOpsPlatform;
  operations?: OperationsPlatform;
  security?: SecurityPlatform;
  autonomousOps?: AutonomousOpsPlatform;
  commercial?: CommercialPlatform;
  business?: BusinessPlatform;
  workforce?: WorkforcePlatform;
  workplace?: WorkplacePlatform;
}
