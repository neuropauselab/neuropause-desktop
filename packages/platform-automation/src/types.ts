/**
 * Version 1.1 Program 1B shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14. The
 * automation layer composes on the reused trust-platform (SBOM/supply-chain + secrets model), deployment-
 * orchestrator (GA gate), release (packaging + RC validation), and platform-operations (backup-recovery);
 * it never re-implements their runtimes and never modifies them. Every reused platform is optional — the
 * automation degrades honestly when a platform is absent (represented generators, no fabricated result).
 */
import type { ProductionEvidenceLevel } from '@neuropause/production';
import type { TrustPlatform } from '@neuropause/trust-platform';
import type { DeploymentOrchestratorPlatform } from '@neuropause/deployment-orchestrator';
import type { ReleasePlatform } from '@neuropause/release';
import type { PlatformOperations } from '@neuropause/platform-operations';
import type { ArtifactKind } from './constants';

export type {
  ProductionEvidenceLevel,
  TrustPlatform,
  DeploymentOrchestratorPlatform,
  ReleasePlatform,
  PlatformOperations,
};

/** Version 1.1 Program 1B uses the Wave 14 evidence model verbatim. */
export type PaEvidenceLevel = ProductionEvidenceLevel;

/** A generated automation artifact. It is TEXT to be reviewed and applied by an operator — never executed here. */
export interface Artifact {
  kind: ArtifactKind;
  name: string;
  format: 'yaml' | 'hcl' | 'json';
  content: string;
  note: string;
}

/** The reused platforms the automation layer composes on (all optional — degraded honestly when absent). */
export interface PaContext {
  trustPlatform?: TrustPlatform;
  deploymentOrchestrator?: DeploymentOrchestratorPlatform;
  release?: ReleasePlatform;
  platformOperations?: PlatformOperations;
}
