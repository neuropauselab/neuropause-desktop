/**
 * Module 9 — Infrastructure Policy Engine. Defines and EVALUATES policies against manifest
 * descriptors, entirely in-process (live-verified). Kinds: resource-limits, security-context,
 * namespace-isolation, deployment-approval, required-labels, image-policy, and an aggregate
 * compliance check. No admission controller runs; this is a real evaluation of descriptor shape.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { InfraPolicy, PolicyEvaluation, K8sManifest } from './types';
import { POLICY_KINDS, type PolicyKind } from './constants';

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function containersOf(manifest: K8sManifest): Array<Record<string, unknown>> {
  const spec = getPath(manifest.spec, 'spec');
  const nested = getPath(spec, 'template.spec.containers');
  const direct = getPath(spec, 'containers');
  const list = (Array.isArray(nested) ? nested : Array.isArray(direct) ? direct : []) as unknown[];
  return list.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null);
}

function podSecurityContext(manifest: K8sManifest): Record<string, unknown> | undefined {
  const ctx = getPath(manifest.spec, 'spec.template.spec.securityContext') ?? getPath(manifest.spec, 'spec.securityContext');
  return typeof ctx === 'object' && ctx !== null ? (ctx as Record<string, unknown>) : undefined;
}

export interface DefinePolicyInput {
  kind: PolicyKind;
  name: string;
  rule?: Record<string, unknown>;
}

export interface EvaluateOptions {
  approved?: boolean;
}

export interface ComplianceResult {
  targetId: string;
  passed: boolean;
  evaluations: PolicyEvaluation[];
}

export class InfrastructurePolicyEngine {
  private readonly policies = new Map<string, InfraPolicy>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
  ) {}

  async define(input: DefinePolicyInput): Promise<InfraPolicy> {
    if (!POLICY_KINDS.includes(input.kind)) throw new Error(`unknown policy kind: ${input.kind}`);
    const policy: InfraPolicy = { id: randomId('pol'), kind: input.kind, name: input.name, rule: input.rule ?? {}, createdAt: this.clock.now() };
    this.policies.set(policy.id, policy);
    await this.governance.record({ actor: 'system', operation: `policy.define.${input.kind}`, targetId: policy.id, evidence: 'live-verified', detail: input.name });
    return policy;
  }

  /** Evaluate one policy against one manifest. Real in-process computation. */
  evaluate(policyId: string, manifest: K8sManifest, opts: EvaluateOptions = {}): PolicyEvaluation {
    const policy = this.require(policyId);
    const violations = this.check(policy, manifest, opts);
    return { policyId, kind: policy.kind, targetId: manifest.id, passed: violations.length === 0, violations, evidence: 'live-verified' };
  }

  private check(policy: InfraPolicy, manifest: K8sManifest, opts: EvaluateOptions): string[] {
    const v: string[] = [];
    switch (policy.kind) {
      case 'resource-limits': {
        for (const c of containersOf(manifest)) {
          const limits = getPath(c, 'resources.limits');
          if (!limits || getPath(limits, 'cpu') === undefined || getPath(limits, 'memory') === undefined) {
            v.push(`container ${String(c['name'] ?? '?')} missing cpu/memory limits`);
          }
        }
        break;
      }
      case 'security-context': {
        const pod = podSecurityContext(manifest);
        for (const c of containersOf(manifest)) {
          const ctx = getPath(c, 'securityContext');
          const nonRoot = (ctx && getPath(ctx, 'runAsNonRoot') === true) || (pod && pod['runAsNonRoot'] === true);
          if (!nonRoot) v.push(`container ${String(c['name'] ?? '?')} not runAsNonRoot`);
        }
        break;
      }
      case 'required-labels': {
        const required = Array.isArray(policy.rule['requiredLabels']) ? (policy.rule['requiredLabels'] as string[]) : ['app'];
        const labels = (getPath(manifest.spec, 'metadata.labels') ?? {}) as Record<string, unknown>;
        for (const key of required) if (!(key in labels)) v.push(`missing required label: ${key}`);
        break;
      }
      case 'image-policy': {
        const allowed = Array.isArray(policy.rule['allowedRegistries']) ? (policy.rule['allowedRegistries'] as string[]) : ['neuropause/'];
        for (const c of containersOf(manifest)) {
          const image = String(c['image'] ?? '');
          if (!allowed.some((prefix) => image.startsWith(prefix))) v.push(`image ${image} not from an allowed registry`);
        }
        break;
      }
      case 'deployment-approval': {
        if (opts.approved !== true) v.push('deployment not approved');
        break;
      }
      case 'namespace-isolation': {
        // single-manifest form: a workload must declare a podSelector-scoped policy is handled at
        // bundle level; here we require the manifest to carry a namespace.
        if (!manifest.namespace || manifest.namespace === 'default') v.push('workload in default namespace — no isolation');
        break;
      }
      case 'compliance': {
        // aggregate placeholder — real aggregate is via compliance(); a lone compliance policy passes.
        break;
      }
    }
    return v;
  }

  /** Bundle rule: every workload namespace must be covered by a NetworkPolicy. */
  evaluateIsolation(policyId: string, manifests: K8sManifest[]): PolicyEvaluation {
    const policy = this.require(policyId);
    const workloadNs = new Set(manifests.filter((m) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(m.kind)).map((m) => m.namespace));
    const covered = new Set(manifests.filter((m) => m.kind === 'NetworkPolicy').map((m) => m.namespace));
    const violations = [...workloadNs].filter((ns) => !covered.has(ns)).map((ns) => `namespace ${ns} has no NetworkPolicy`);
    return { policyId, kind: policy.kind, targetId: 'bundle', passed: violations.length === 0, violations, evidence: 'live-verified' };
  }

  /** Run every applicable policy against a manifest; passes only if all pass. */
  compliance(manifest: K8sManifest, opts: EvaluateOptions = {}): ComplianceResult {
    const evaluations = [...this.policies.values()]
      .filter((p) => p.kind !== 'compliance' && p.kind !== 'namespace-isolation')
      .map((p) => this.evaluate(p.id, manifest, opts));
    return { targetId: manifest.id, passed: evaluations.every((e) => e.passed), evaluations };
  }

  private require(id: string): InfraPolicy {
    const p = this.policies.get(id);
    if (!p) throw new Error(`no policy ${id}`);
    return p;
  }

  get(id: string): InfraPolicy | undefined {
    return this.policies.get(id);
  }
  list(kind?: PolicyKind): InfraPolicy[] {
    const all = [...this.policies.values()];
    return kind ? all.filter((p) => p.kind === kind) : all;
  }
  count(): number {
    return this.policies.size;
  }
}
