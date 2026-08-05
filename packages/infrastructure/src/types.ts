/**
 * Sprint 2 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 (live-verified /
 * adapter-verified / business-data-pending / infrastructure-pending) — the exact evidence model this
 * sprint requires — rather than defining a new one. The infrastructure/identity/security layer
 * composes on the reused security, Sprint-1 deploy, cloud-ops, operations, production, federation,
 * and commercial platforms; it never re-implements their runtimes.
 */
import type { ProductionEvidenceLevel, ProductionPlatform } from '@neuropause/production';
import type { SecurityPlatform } from '@neuropause/security';
import type { DeploymentFoundation } from '@neuropause/deploy';
import type { CloudOpsPlatform } from '@neuropause/cloudops';
import type { OperationsPlatform } from '@neuropause/operations';
import type { FederationPlatform } from '@neuropause/federation';
import type { CommercialPlatform } from '@neuropause/commercial';

export type { ProductionEvidenceLevel, ProductionPlatform, SecurityPlatform, DeploymentFoundation, CloudOpsPlatform, OperationsPlatform, FederationPlatform, CommercialPlatform };

/** Sprint 2 uses the Wave 14 evidence model verbatim. */
export type InfraEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the infrastructure layer composes on (all optional — represented when absent). */
export interface InfraContext {
  security?: SecurityPlatform;
  deploy?: DeploymentFoundation;
  cloudops?: CloudOpsPlatform;
  operations?: OperationsPlatform;
  production?: ProductionPlatform;
  federation?: FederationPlatform;
  commercial?: CommercialPlatform;
}
