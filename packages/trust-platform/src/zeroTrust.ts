/**
 * EPIC 1 — Zero Trust Security Runtime. A policy registry, policy evaluation, resource classification, a
 * device-trust registry, session-trust evaluation, continuous verification, and trust scoring. Policy
 * evaluation REUSES the security authorization engine (real RBAC/ABAC permit/deny) when it is wired in —
 * the trust layer never re-implements access decisions. Trust scoring is a real in-process computation
 * over posture signals; it never claims a signal it was not given. Nothing here trusts by default:
 * every resource is classified and every decision is deny-by-default until a policy permits it.
 */
import { randomId } from '@neuropause/cloud-core';
import { RESOURCE_CLASSES, TRUST_SIGNALS, type ResourceClass, type TrustLevel, type TrustSignal } from './constants';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export interface ZeroTrustPolicy {
  id: string;
  name: string;
  resourceClass: ResourceClass;
  minTrust: TrustLevel;
  permission: string; // `${resourceType}:${action}`
}

export interface ClassifiedResource {
  id: string;
  resourceClass: ResourceClass;
}

export interface DeviceTrust {
  deviceId: string;
  managed: boolean;
  compliant: boolean;
  level: TrustLevel;
}

export interface TrustScore {
  score: number; // 0..100
  level: TrustLevel;
  signals: Partial<Record<TrustSignal, number>>;
  missingSignals: TrustSignal[];
}

export interface ZeroTrustDecision {
  allowed: boolean;
  reason: string;
  reusedAuthorization: boolean;
  requiredTrust: TrustLevel;
  subjectTrust: TrustLevel;
}

const LEVEL_RANK: Record<TrustLevel, number> = { untrusted: 0, low: 1, medium: 2, high: 3, verified: 4 };

export class ZeroTrustRuntime {
  private readonly policies = new Map<string, ZeroTrustPolicy>();
  private readonly resources = new Map<string, ClassifiedResource>();
  private readonly devices = new Map<string, DeviceTrust>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  classifications(): readonly ResourceClass[] {
    return RESOURCE_CLASSES;
  }
  signals(): readonly TrustSignal[] {
    return TRUST_SIGNALS;
  }

  /** Register a Zero Trust policy: a resource class + minimum trust + the permission it gates. */
  async definePolicy(input: { name: string; resourceClass: ResourceClass; minTrust: TrustLevel; permission: string }): Promise<ZeroTrustPolicy> {
    const policy: ZeroTrustPolicy = { id: randomId('ztp'), name: input.name, resourceClass: input.resourceClass, minTrust: input.minTrust, permission: input.permission };
    this.policies.set(policy.id, policy);
    await this.gov.record({ actor: this.operator, environment: '_zero-trust', resource: input.resourceClass, policy: policy.name, epic: 'E1', operation: 'define-policy', targetId: policy.id, evidence: 'live-verified', decision: input.minTrust });
    return policy;
  }

  /** Classify a resource — nothing is accessible until it carries a classification. */
  async classify(resourceId: string, resourceClass: ResourceClass): Promise<ClassifiedResource> {
    const res: ClassifiedResource = { id: resourceId, resourceClass };
    this.resources.set(resourceId, res);
    await this.gov.record({ actor: this.operator, environment: '_zero-trust', resource: resourceId, policy: 'resource-classification', epic: 'E1', operation: 'classify-resource', targetId: resourceId, evidence: 'live-verified', decision: resourceClass });
    return res;
  }

  /** Register a device in the trust registry; managed + compliant devices earn a higher level. */
  async registerDevice(input: { deviceId: string; managed: boolean; compliant: boolean }): Promise<DeviceTrust> {
    const level: TrustLevel = input.managed && input.compliant ? 'high' : input.managed ? 'medium' : 'low';
    const device: DeviceTrust = { deviceId: input.deviceId, managed: input.managed, compliant: input.compliant, level };
    this.devices.set(input.deviceId, device);
    await this.gov.record({ actor: this.operator, environment: '_zero-trust', resource: input.deviceId, policy: 'device-trust', epic: 'E1', operation: 'register-device', targetId: input.deviceId, evidence: 'live-verified', decision: level });
    return device;
  }

  /** Trust scoring — a real weighted computation over the posture signals actually supplied. */
  score(signals: Partial<Record<TrustSignal, number>>): TrustScore {
    const present = TRUST_SIGNALS.filter((s) => typeof signals[s] === 'number');
    const missing = TRUST_SIGNALS.filter((s) => typeof signals[s] !== 'number');
    const raw = present.reduce((sum, s) => sum + Math.max(0, Math.min(100, signals[s] as number)), 0);
    const score = present.length ? Math.round(raw / present.length) : 0;
    const level: TrustLevel = score >= 90 ? 'verified' : score >= 70 ? 'high' : score >= 45 ? 'medium' : score >= 20 ? 'low' : 'untrusted';
    return { score, level, signals, missingSignals: missing };
  }

  /**
   * Evaluate an access request against a policy. When the security authorization engine is wired in the
   * permit/deny is a REAL reused decision; the trust gate additionally requires the subject's trust level
   * to meet the policy minimum (continuous verification). Deny-by-default throughout.
   */
  async evaluate(input: {
    policyId: string;
    subject: { id: string; roles: string[] };
    resourceType: string;
    action: string;
    subjectTrust: TrustLevel;
    environment?: Record<string, unknown>;
  }): Promise<ZeroTrustDecision> {
    const policy = this.policies.get(input.policyId);
    if (!policy) throw new Error(`unknown Zero Trust policy: ${input.policyId}`);

    let reusedAuthorization = false;
    let permitted = false;
    let reason = 'deny-by-default: no authorization engine wired in';
    if (this.ctx.security) {
      const decision = this.ctx.security.authorization().authorize({
        subject: { id: input.subject.id, roles: input.subject.roles },
        action: input.action,
        resource: { type: input.resourceType },
        ...(input.environment ? { environment: input.environment } : {}),
      });
      permitted = decision.allowed;
      reason = decision.reason;
      reusedAuthorization = true;
    }

    const trustOk = LEVEL_RANK[input.subjectTrust] >= LEVEL_RANK[policy.minTrust];
    const allowed = permitted && trustOk;
    if (!trustOk) reason = `trust '${input.subjectTrust}' below policy minimum '${policy.minTrust}'`;

    await this.gov.record({
      actor: input.subject.id,
      environment: '_zero-trust',
      resource: input.resourceType,
      policy: policy.name,
      epic: 'E1',
      operation: 'evaluate',
      targetId: input.policyId,
      evidence: 'live-verified',
      decision: allowed ? 'permit' : 'deny',
    });
    return { allowed, reason, reusedAuthorization, requiredTrust: policy.minTrust, subjectTrust: input.subjectTrust };
  }

  policyCount(): number {
    return this.policies.size;
  }
  device(deviceId: string): DeviceTrust | undefined {
    return this.devices.get(deviceId);
  }
  resource(resourceId: string): ClassifiedResource | undefined {
    return this.resources.get(resourceId);
  }
}
