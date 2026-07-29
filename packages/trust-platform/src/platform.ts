/**
 * Launch Workstream 4 composition root. `createTrustPlatform(runtime, …)` assembles the enterprise trust
 * control plane on the EXISTING platform: it reuses the one runtime audit chain + event bus (trust
 * governance + the audit timeline / chain of custody), the security platform (authorization decisions +
 * JIT grants, the identity registry, the KeyManager, and the ComplianceService), the Operations platform
 * (the incident registry), the Launch-Workstream-1 platform operations (backup-recovery), and the
 * Sprint-6 Release platform (packaging + RC validation). No subsystem is duplicated and no prior package
 * is modified. No ISO 27001 / SOC 2 / HIPAA / GDPR certification, completed penetration test, production
 * security incident, or external SIEM integration is ever claimed.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { TP_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { TP_MATRIX, tpReadiness, type CapabilityEvidence, type TpReadiness } from './evidence';
import type {
  TpContext,
  SecurityPlatform,
  OperationsPlatform,
  PlatformOperations,
  ReleasePlatform,
  EnterpriseConnectivity,
  InfrastructurePlatform,
  ReliabilityPlatform,
} from './types';
import { TrustGovernance } from './governance';
import { ZeroTrustRuntime } from './zeroTrust';
import { EnterpriseIdentitySecurity } from './identitySecurity';
import { SecretsManagement } from './secrets';
import { SecurityPolicyPlatform } from './securityPolicy';
import { VulnerabilityManagement } from './vulnerability';
import { SupplyChainSecurity } from './supplyChain';
import { RuntimeSecurity } from './runtimeSecurity';
import { AuditForensics } from './auditForensics';
import { DisasterRecoveryPlatform } from './disasterRecovery';
import { ComplianceReadiness } from './compliance';
import { SecurityOperationsCenter } from './soc';
import { EnterpriseTrustCenter } from './trustCenter';
import { SecurityDocumentation } from './documentation';
import { TrustPlatformSDK } from './sdk';

export interface TrustPlatformOptions {
  clock?: Clock;
  operator?: string;
  security?: SecurityPlatform;
  operations?: OperationsPlatform;
  platformOperations?: PlatformOperations;
  release?: ReleasePlatform;
  enterpriseConnectivity?: EnterpriseConnectivity;
  infrastructure?: InfrastructurePlatform;
  reliability?: ReliabilityPlatform;
}

export interface TrustPlatform {
  version: string;
  zeroTrust(): ZeroTrustRuntime;
  identitySecurity(): EnterpriseIdentitySecurity;
  secrets(): SecretsManagement;
  securityPolicy(): SecurityPolicyPlatform;
  vulnerability(): VulnerabilityManagement;
  supplyChain(): SupplyChainSecurity;
  runtimeSecurity(): RuntimeSecurity;
  auditForensics(): AuditForensics;
  disasterRecovery(): DisasterRecoveryPlatform;
  compliance(): ComplianceReadiness;
  soc(): SecurityOperationsCenter;
  trustCenter(): EnterpriseTrustCenter;
  documentation(): SecurityDocumentation;
  sdk(): TrustPlatformSDK;
  governance(): TrustGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): TpReadiness;
}

export function createTrustPlatform(runtime: EnterpriseRuntime, options: TrustPlatformOptions = {}): TrustPlatform {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'trust-runtime';
  const ctx: TpContext = {
    ...(options.security ? { security: options.security } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.platformOperations ? { platformOperations: options.platformOperations } : {}),
    ...(options.release ? { release: options.release } : {}),
    ...(options.enterpriseConnectivity ? { enterpriseConnectivity: options.enterpriseConnectivity } : {}),
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
  };

  const gov = new TrustGovernance(runtime, clock);
  const zeroTrust = new ZeroTrustRuntime(ctx, gov, operator);
  const identitySecurity = new EnterpriseIdentitySecurity(ctx, gov, operator);
  const secrets = new SecretsManagement(ctx, gov, operator);
  const securityPolicy = new SecurityPolicyPlatform(gov, operator);
  const vulnerability = new VulnerabilityManagement(gov, operator);
  const supplyChain = new SupplyChainSecurity(ctx, gov, operator);
  const runtimeSecurity = new RuntimeSecurity(gov, operator);
  const auditForensics = new AuditForensics(runtime, gov, operator);
  const disasterRecovery = new DisasterRecoveryPlatform(ctx, gov, operator);
  const compliance = new ComplianceReadiness(ctx, gov, operator);
  const soc = new SecurityOperationsCenter(ctx, gov, operator);
  const trustCenter = new EnterpriseTrustCenter({ compliance, soc }, gov, operator);
  const documentation = new SecurityDocumentation(gov, operator);
  const sdk = new TrustPlatformSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: TP_VERSION,
    zeroTrust: () => zeroTrust,
    identitySecurity: () => identitySecurity,
    secrets: () => secrets,
    securityPolicy: () => securityPolicy,
    vulnerability: () => vulnerability,
    supplyChain: () => supplyChain,
    runtimeSecurity: () => runtimeSecurity,
    auditForensics: () => auditForensics,
    disasterRecovery: () => disasterRecovery,
    compliance: () => compliance,
    soc: () => soc,
    trustCenter: () => trustCenter,
    documentation: () => documentation,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => TP_MATRIX,
    readiness: () => tpReadiness(),
  };
}
