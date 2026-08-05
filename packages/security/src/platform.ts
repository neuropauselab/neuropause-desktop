/**
 * Security platform composition root (NCEA 14.0, Phase 12). `createSecurityPlatform
 * (runtime)` assembles the ONE identity/authorization/policy/governance plane onto
 * the existing Enterprise Runtime — its audit chain, event bus, and observability.
 * Exposes the runtime security surface: identity / authentication / authorization /
 * policy / security / compliance / audit / sessions / tenants / keys. One identity
 * registry, one authorization model, one policy engine, one audit chain, one key
 * manager — nothing duplicated, nothing bypassing runtime governance.
 */
import { systemClock, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { SECURITY_VERSION } from './constants';
import { SecurityAudit } from './audit';
import { ed25519Signer, KeyManager, type KeyProvider, type Signer } from './keys';
import { IdentityRegistry } from './identity';
import { AuthenticationService } from './authn';
import { SessionManager, type SessionPolicy } from './sessions';
import { AuthorizationEngine } from './authz';
import { PolicyEngine } from './policy';
import { TenantIsolation } from './tenancy';
import { AiGovernance } from './aiGovernance';
import { SecurityService } from './security';
import { ComplianceService } from './compliance';
import { SecurityObservability } from './observability';
import { SECURITY_MATRIX, THREAT_MODEL, readinessSummary, type CapabilityEntry, type Threat } from './matrix';

export interface SecurityPlatformOptions {
  clock?: Clock;
  signer?: Signer;
  signingSecret?: string;
  keyProvider?: KeyProvider;
  sessionPolicy?: SessionPolicy;
}

export interface SecurityPlatform {
  version: string;
  identity(): IdentityRegistry;
  authentication(): AuthenticationService;
  authorization(): AuthorizationEngine;
  policy(): PolicyEngine;
  security(): SecurityService;
  compliance(): ComplianceService;
  audit(): SecurityAudit;
  sessions(): SessionManager;
  tenants(): TenantIsolation;
  keys(): KeyManager;
  aiGovernance(): AiGovernance;
  observability(): SecurityObservability;
  matrix(): CapabilityEntry[];
  threatModel(): Threat[];
  readiness(): ReturnType<typeof readinessSummary>;
}

export function createSecurityPlatform(runtime: EnterpriseRuntime, options: SecurityPlatformOptions = {}): SecurityPlatform {
  const clock = options.clock ?? systemClock;
  const signer = options.signer ?? ed25519Signer();
  const signingSecret = options.signingSecret ?? randomId('sig');

  const audit = new SecurityAudit(runtime, clock, signer);
  const keys = new KeyManager(options.keyProvider);
  const identity = new IdentityRegistry(clock, audit);
  const authentication = new AuthenticationService(clock, audit);
  const sessions = new SessionManager(clock, audit, options.sessionPolicy);
  const authorization = new AuthorizationEngine(clock, audit);
  const policy = new PolicyEngine(audit);
  const tenants = new TenantIsolation(clock, audit);
  const aiGovernance = new AiGovernance(audit);
  const security = new SecurityService(clock, audit, signingSecret);
  const compliance = new ComplianceService(audit, clock);
  const observability = new SecurityObservability(runtime);

  return {
    version: SECURITY_VERSION,
    identity: () => identity,
    authentication: () => authentication,
    authorization: () => authorization,
    policy: () => policy,
    security: () => security,
    compliance: () => compliance,
    audit: () => audit,
    sessions: () => sessions,
    tenants: () => tenants,
    keys: () => keys,
    aiGovernance: () => aiGovernance,
    observability: () => observability,
    matrix: () => SECURITY_MATRIX,
    threatModel: () => THREAT_MODEL,
    readiness: () => readinessSummary(),
  };
}
