/**
 * Sprint 4 composition root. `createReliabilityPlatform(runtime, …)` assembles the production-
 * validation, reliability, and security-hardening layer on the EXISTING platform: it reuses the one
 * runtime audit chain + event bus (reliability governance), the operations PerformanceMonitor (real
 * measurement), production backups/DR/diagnostics/compliance/docs, the security platform (identity/
 * authn/authz), and — when provided — infrastructure, deploy, the integration platform, workforce,
 * workplace, business, commercial, and the AI runtime. No subsystem is duplicated and no prior
 * package is modified. Measurements are never fabricated, compliance is never claimed, and no GA is
 * declared.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { PerformanceMonitor } from '@neuropause/operations';
import { RELIABILITY_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { RELIABILITY_MATRIX, reliabilityReadiness, type CapabilityEvidence, type ReliabilityReadiness } from './evidence';
import type {
  ReliabilityContext,
  SecurityPlatform,
  OperationsPlatform,
  ProductionPlatform,
  InfrastructurePlatform,
  DeploymentFoundation,
  IntegrationPlatform,
  WorkforcePlatform,
  WorkplacePlatform,
  BusinessPlatform,
  CommercialPlatform,
  AiRuntime,
} from './types';
import { ReliabilityGovernance } from './governance';
import { ValidationRuntime } from './runtime';
import { EndToEndValidation } from './endToEnd';
import { PerformanceEngineering, type PerfHarness } from './performance';
import { LoadStressEndurance } from './loadTesting';
import { ChaosEngineering } from './chaos';
import { RecoveryValidation } from './recovery';
import { SecurityHardening } from './hardening';
import { PenetrationTestingFramework } from './pentest';
import { ComplianceReadiness } from './compliance';
import { ReliabilityEngineering } from './reliabilityEngineering';
import { SloSlaPlatform } from './slo';
import { OperationalReadiness } from './operationalReadiness';
import { ReleaseCandidatePlatform } from './releaseCandidate';
import { ProductionDiagnostics } from './diagnostics';
import { ObservabilityValidation } from './observabilityValidation';
import { ProductionReadinessScoring } from './readinessScoring';
import { ReliabilitySDK } from './sdk';
import { ReliabilityDocumentation } from './documentation';

export interface ReliabilityPlatformOptions {
  clock?: Clock;
  org?: string;
  operator?: string;
  security?: SecurityPlatform;
  operations?: OperationsPlatform;
  production?: ProductionPlatform;
  infrastructure?: InfrastructurePlatform;
  deploy?: DeploymentFoundation;
  integrationPlatform?: IntegrationPlatform;
  workforce?: WorkforcePlatform;
  workplace?: WorkplacePlatform;
  business?: BusinessPlatform;
  commercial?: CommercialPlatform;
  aiRuntime?: AiRuntime;
  /** Extra source roots for the real security scans (defaults to the reliability package src). */
  scanRoots?: string[];
}

export interface ReliabilityPlatform {
  version: string;
  validation(): ValidationRuntime;
  endToEnd(): EndToEndValidation;
  performance(): PerformanceEngineering;
  loadTesting(): LoadStressEndurance;
  chaos(): ChaosEngineering;
  recovery(): RecoveryValidation;
  hardening(): SecurityHardening;
  pentest(): PenetrationTestingFramework;
  compliance(): ComplianceReadiness;
  reliabilityEngineering(): ReliabilityEngineering;
  slo(): SloSlaPlatform;
  operationalReadiness(): OperationalReadiness;
  releaseCandidate(): ReleaseCandidatePlatform;
  diagnostics(): ProductionDiagnostics;
  observabilityValidation(): ObservabilityValidation;
  readinessScoring(): ProductionReadinessScoring;
  sdk(): ReliabilitySDK;
  documentation(): ReliabilityDocumentation;
  governance(): ReliabilityGovernance;
  // reuse + honesty accessors
  performanceReusesOperations(): boolean;
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): ReliabilityReadiness;
}

export function createReliabilityPlatform(runtime: EnterpriseRuntime, options: ReliabilityPlatformOptions = {}): ReliabilityPlatform {
  const clock = options.clock ?? systemClock;
  const org = options.org ?? '_reliability';
  const operator = options.operator ?? 'reliability-runtime';
  const ctx: ReliabilityContext = {
    ...(options.security ? { security: options.security } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.production ? { production: options.production } : {}),
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.deploy ? { deploy: options.deploy } : {}),
    ...(options.integrationPlatform ? { integrationPlatform: options.integrationPlatform } : {}),
    ...(options.workforce ? { workforce: options.workforce } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
    ...(options.business ? { business: options.business } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
    ...(options.aiRuntime ? { aiRuntime: options.aiRuntime } : {}),
  };

  const gov = new ReliabilityGovernance(runtime, clock);
  const harness: PerfHarness = ctx.operations ? { monitor: ctx.operations.performance(), reused: true } : { monitor: new PerformanceMonitor(clock), reused: false };

  const validation = new ValidationRuntime(clock, gov, org, operator);
  const endToEnd = new EndToEndValidation(clock, ctx, gov, org, operator);
  const performance = new PerformanceEngineering(harness, gov, org, operator);
  const loadTesting = new LoadStressEndurance(harness, gov, org, operator);
  const chaos = new ChaosEngineering(clock, gov, org, operator);
  const recovery = new RecoveryValidation(clock, ctx, gov, org, operator);
  const hardening = new SecurityHardening(clock, ctx, gov, org, operator, options.scanRoots);
  const pentest = new PenetrationTestingFramework(clock, gov, org, operator);
  const compliance = new ComplianceReadiness(clock, ctx, gov, org, operator);
  const reliabilityEngineering = new ReliabilityEngineering(clock, gov, org, operator);
  const slo = new SloSlaPlatform(clock, gov, org, operator);
  const operationalReadiness = new OperationalReadiness(clock, ctx, gov, org, operator);
  const releaseCandidate = new ReleaseCandidatePlatform(clock, gov, org, operator);
  const diagnostics = new ProductionDiagnostics(clock, ctx, gov, org, operator);
  const observabilityValidation = new ObservabilityValidation(clock, runtime, ctx, gov, org, operator);
  const readinessScoring = new ProductionReadinessScoring(clock, gov, org, operator);
  const sdk = new ReliabilitySDK();
  const documentation = new ReliabilityDocumentation(clock, ctx, gov, org, operator);

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: RELIABILITY_VERSION,
    validation: () => validation,
    endToEnd: () => endToEnd,
    performance: () => performance,
    loadTesting: () => loadTesting,
    chaos: () => chaos,
    recovery: () => recovery,
    hardening: () => hardening,
    pentest: () => pentest,
    compliance: () => compliance,
    reliabilityEngineering: () => reliabilityEngineering,
    slo: () => slo,
    operationalReadiness: () => operationalReadiness,
    releaseCandidate: () => releaseCandidate,
    diagnostics: () => diagnostics,
    observabilityValidation: () => observabilityValidation,
    readinessScoring: () => readinessScoring,
    sdk: () => sdk,
    documentation: () => documentation,
    governance: () => gov,
    performanceReusesOperations: () => performance.reusesOperations(),
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => RELIABILITY_MATRIX,
    readiness: () => reliabilityReadiness(),
  };
}
