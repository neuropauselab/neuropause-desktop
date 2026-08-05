/**
 * Sprint 3 shared types. REUSES the four-level ProductionEvidenceLevel from Wave 14 (live-verified /
 * adapter-verified / business-data-pending / infrastructure-pending) — the exact evidence model this
 * sprint requires. The integration layer composes on the reused Sprint-2 infrastructure, the
 * security, operations, connectors, ai-runtime, production, and business platforms; it never
 * re-implements their runtimes.
 */
import type { ProductionEvidenceLevel, ProductionPlatform } from '@neuropause/production';
import type { InfrastructurePlatform } from '@neuropause/infrastructure';
import type { SecurityPlatform } from '@neuropause/security';
import type { OperationsPlatform } from '@neuropause/operations';
import type { ConnectorPlatform } from '@neuropause/connectors';
import type { AiRuntime } from '@neuropause/ai-runtime';
import type { BusinessPlatform } from '@neuropause/business';

export type { ProductionEvidenceLevel, ProductionPlatform, InfrastructurePlatform, SecurityPlatform, OperationsPlatform, ConnectorPlatform, AiRuntime, BusinessPlatform };

/** Sprint 3 uses the Wave 14 evidence model verbatim. */
export type IntegrationEvidenceLevel = ProductionEvidenceLevel;

/** The reused platforms the integration layer composes on (all optional — represented when absent). */
export interface IntegrationContext {
  infrastructure?: InfrastructurePlatform;
  security?: SecurityPlatform;
  operations?: OperationsPlatform;
  connectors?: ConnectorPlatform;
  aiRuntime?: AiRuntime;
  production?: ProductionPlatform;
  business?: BusinessPlatform;
}
