/**
 * Sprint 1 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 (live-verified /
 * adapter-verified / business-data-pending / infrastructure-pending) — the exact evidence model this
 * sprint requires — rather than defining a new one. The deployment foundation composes on the reused
 * Wave 7 cloud-ops, Wave 12 operations, Wave 13 commercial, Wave 14 production, and security
 * platforms; it never re-implements their runtimes.
 */
import type { ProductionEvidenceLevel, ProductionPlatform } from '@neuropause/production';
import type { CloudOpsPlatform } from '@neuropause/cloudops';
import type { OperationsPlatform } from '@neuropause/operations';
import type { SecurityPlatform } from '@neuropause/security';
import type { CommercialPlatform } from '@neuropause/commercial';

export type { ProductionEvidenceLevel, ProductionPlatform, CloudOpsPlatform, OperationsPlatform, SecurityPlatform, CommercialPlatform };

/** Sprint 1 uses the Wave 14 evidence model verbatim. */
export type DeployEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the deployment foundation composes on (all optional — represented when absent). */
export interface DeployContext {
  production?: ProductionPlatform;
  cloudops?: CloudOpsPlatform;
  operations?: OperationsPlatform;
  security?: SecurityPlatform;
  commercial?: CommercialPlatform;
}
