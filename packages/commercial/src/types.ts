/**
 * Wave 13 shared types. Reuses the four-level EvidenceLevel from Wave 8 (composition, not
 * duplication). The commercial platform makes NEMS a multi-tenant SaaS product by composing on the
 * reused federation (multi-tenancy/marketplace), cloud-ops (deployment), business (customer
 * success), operations (observability), workforce/industry/workplace (provisioning) platforms — it
 * never re-implements their runtimes.
 */
import type { EvidenceLevel } from '@neuropause/business';
import type { FederationPlatform } from '@neuropause/federation';
import type { CloudOpsPlatform } from '@neuropause/cloudops';
import type { BusinessPlatform } from '@neuropause/business';
import type { OperationsPlatform } from '@neuropause/operations';
import type { WorkforcePlatform } from '@neuropause/workforce';
import type { IndustryPlatform } from '@neuropause/industry';
import type { WorkplacePlatform } from '@neuropause/workplace';

export type { EvidenceLevel, FederationPlatform, CloudOpsPlatform, BusinessPlatform, OperationsPlatform, WorkforcePlatform, IndustryPlatform, WorkplacePlatform };

/** The reused platforms the commercial runtime composes on (all optional — represented when absent). */
export interface CommercialContext {
  federation?: FederationPlatform;
  cloudops?: CloudOpsPlatform;
  business?: BusinessPlatform;
  operations?: OperationsPlatform;
  workforce?: WorkforcePlatform;
  industry?: IndustryPlatform;
  workplace?: WorkplacePlatform;
}
