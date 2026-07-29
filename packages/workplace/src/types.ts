/**
 * Wave 10 shared types. Reuses the four-level EvidenceLevel from Wave 8 (composition, not
 * duplication). The workplace composes on the reused Wave 8 business platform and Wave 9 industry
 * platform — it never re-implements their runtimes.
 */
import type { EvidenceLevel, BusinessPlatform } from '@neuropause/business';
import type { IndustryPlatform } from '@neuropause/industry';

export type { EvidenceLevel, BusinessPlatform, IndustryPlatform };

/** The reused platforms the workplace composes on (all optional — represented when absent). */
export interface WorkplaceContext {
  business?: BusinessPlatform;
  industry?: IndustryPlatform;
}
