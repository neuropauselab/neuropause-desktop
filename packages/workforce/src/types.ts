/**
 * Wave 11 shared types. Reuses the four-level EvidenceLevel from Wave 8 (composition, not
 * duplication). AI workers compose on the reused business/industry/workplace platforms — they
 * operate THROUGH the existing runtime, governance, HITL, and tools, and never replace them.
 */
import type { EvidenceLevel, BusinessPlatform } from '@neuropause/business';
import type { IndustryPlatform } from '@neuropause/industry';
import type { WorkplacePlatform } from '@neuropause/workplace';

export type { EvidenceLevel, BusinessPlatform, IndustryPlatform, WorkplacePlatform };

/** The reused platforms an AI worker operates through (all optional — represented when absent). */
export interface WorkforceContext {
  business?: BusinessPlatform;
  industry?: IndustryPlatform;
  workplace?: WorkplacePlatform;
}

/** A single piece of evidence — collected from a REAL source, never fabricated. */
export interface Evidence {
  source: string;
  kind: 'runtime-data' | 'audit' | 'document' | 'tool-result';
  detail: string;
}
