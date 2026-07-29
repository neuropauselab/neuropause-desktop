/**
 * Wave 12 shared types. Reuses the four-level EvidenceLevel from Wave 8 (composition, not
 * duplication). The operations platform coordinates humans, AI workers, and organizations by
 * composing on the reused business/workplace/workforce/cloudops platforms — it never re-implements
 * their runtimes.
 */
import type { EvidenceLevel, BusinessPlatform } from '@neuropause/business';
import type { WorkplacePlatform } from '@neuropause/workplace';
import type { WorkforcePlatform } from '@neuropause/workforce';
import type { CloudOpsPlatform } from '@neuropause/cloudops';

export type { EvidenceLevel, BusinessPlatform, WorkplacePlatform, WorkforcePlatform, CloudOpsPlatform };

/** The reused platforms the operations runtime composes on (all optional — represented when absent). */
export interface OpsContext {
  business?: BusinessPlatform;
  workplace?: WorkplacePlatform;
  workforce?: WorkforcePlatform;
  cloudops?: CloudOpsPlatform;
}
