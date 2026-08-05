/**
 * EPIC 7 — Runtime Security. A runtime policy engine, a container-policy registry, an API-protection
 * registry, process monitoring, a security-event registry, and a threat-detection registry. The policy
 * and signature registries are REAL in-process records, and threat detection is a REAL match of a
 * provided sample against registered signatures. But there is no production traffic here: real production
 * security EVENTS, process telemetry, and threat intelligence are business-data-pending and reported as
 * such — never fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { NO_SECURITY_DATA, RUNTIME_DOMAINS, type RuntimeDomain } from './constants';
import type { TrustGovernance } from './governance';

export interface RuntimePolicy {
  id: string;
  name: string;
  rule: string;
  enforce: boolean;
}
export interface ContainerPolicy {
  id: string;
  image: string;
  runAsNonRoot: boolean;
  readOnlyRootFs: boolean;
}
export interface ApiProtection {
  id: string;
  route: string;
  rateLimitPerMin: number;
  requireAuth: boolean;
}
export interface ThreatSignature {
  id: string;
  name: string;
  pattern: string;
}
export interface ThreatMatch {
  matched: boolean;
  signatures: string[];
}

export class RuntimeSecurity {
  private readonly policies = new Map<string, RuntimePolicy>();
  private readonly containerPolicies = new Map<string, ContainerPolicy>();
  private readonly apiProtections = new Map<string, ApiProtection>();
  private readonly signatures = new Map<string, ThreatSignature>();
  private sampleEvents = 0;

  constructor(
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  domains(): readonly RuntimeDomain[] {
    return RUNTIME_DOMAINS;
  }

  async defineRuntimePolicy(input: { name: string; rule: string; enforce?: boolean }): Promise<RuntimePolicy> {
    const policy: RuntimePolicy = { id: randomId('rtp'), name: input.name, rule: input.rule, enforce: input.enforce ?? true };
    this.policies.set(policy.id, policy);
    await this.gov.record({ actor: this.operator, environment: '_runtime', resource: input.name, policy: 'runtime-policy', epic: 'E7', operation: 'define-runtime-policy', targetId: policy.id, evidence: 'live-verified', decision: policy.enforce ? 'enforce' : 'audit' });
    return policy;
  }

  async registerContainerPolicy(input: { image: string; runAsNonRoot?: boolean; readOnlyRootFs?: boolean }): Promise<ContainerPolicy> {
    const policy: ContainerPolicy = { id: randomId('cpol'), image: input.image, runAsNonRoot: input.runAsNonRoot ?? true, readOnlyRootFs: input.readOnlyRootFs ?? true };
    this.containerPolicies.set(policy.id, policy);
    await this.gov.record({ actor: this.operator, environment: '_runtime', resource: input.image, policy: 'container-policy', epic: 'E7', operation: 'register-container-policy', targetId: policy.id, evidence: 'live-verified', decision: 'registered' });
    return policy;
  }

  async registerApiProtection(input: { route: string; rateLimitPerMin: number; requireAuth?: boolean }): Promise<ApiProtection> {
    const prot: ApiProtection = { id: randomId('apip'), route: input.route, rateLimitPerMin: input.rateLimitPerMin, requireAuth: input.requireAuth ?? true };
    this.apiProtections.set(prot.id, prot);
    await this.gov.record({ actor: this.operator, environment: '_runtime', resource: input.route, policy: 'api-protection', epic: 'E7', operation: 'register-api-protection', targetId: prot.id, evidence: 'live-verified', decision: `${input.rateLimitPerMin}/min` });
    return prot;
  }

  async registerThreatSignature(input: { name: string; pattern: string }): Promise<ThreatSignature> {
    const sig: ThreatSignature = { id: randomId('sig'), name: input.name, pattern: input.pattern };
    this.signatures.set(sig.id, sig);
    await this.gov.record({ actor: this.operator, environment: '_runtime', resource: input.name, policy: 'threat-detection', epic: 'E7', operation: 'register-signature', targetId: sig.id, evidence: 'live-verified', decision: 'registered' });
    return sig;
  }

  /** REAL detection: match a provided sample against registered signatures (case-insensitive substring). */
  detectThreat(sample: string): ThreatMatch {
    const hay = sample.toLowerCase();
    const hits = [...this.signatures.values()].filter((s) => hay.includes(s.pattern.toLowerCase())).map((s) => s.name);
    return { matched: hits.length > 0, signatures: hits };
  }

  /** Record a REPRESENTED sample security event. Production events remain business-data-pending. */
  async recordSampleEvent(input: { type: string; detail: string }): Promise<{ recorded: true; production: false }> {
    this.sampleEvents += 1;
    await this.gov.record({ actor: this.operator, environment: '_runtime', resource: input.type, policy: 'security-event', epic: 'E7', operation: 'record-sample-event', targetId: input.type, evidence: 'business-data-pending', decision: 'sample' });
    return { recorded: true, production: false };
  }

  /** Process monitoring + production security events — no production telemetry flows here. */
  productionStatus(): { live: false; note: string; sampleEvents: number } {
    return { live: false, note: NO_SECURITY_DATA, sampleEvents: this.sampleEvents };
  }

  policyCount(): number {
    return this.policies.size;
  }
  signatureCount(): number {
    return this.signatures.size;
  }
}
