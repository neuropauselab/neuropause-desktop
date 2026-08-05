/**
 * EPIC 2 — Kubernetes Production Platform. A descriptor registry for the production Kubernetes resources
 * (namespaces, deployments, services, ingress, statefulsets, autoscaling, persistent volumes, network
 * policies, pod security, resource quotas, HPA, PDB). These are DESCRIPTORS — the manifests that WOULD
 * be applied. When the Sprint-1 deploy foundation is wired in, its real asset catalog enumerates the
 * actual k8s manifest files. Applying them to a running cluster is infrastructure-pending; this never
 * claims a resource is running.
 */
import { randomId } from '@neuropause/cloud-core';
import { K8S_RESOURCE_KINDS, type K8sResourceKind } from './constants';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface K8sDescriptor {
  id: string;
  namespace: string;
  kind: K8sResourceKind;
  name: string;
  applied: false; // descriptor only — applying requires a running cluster (infrastructure-pending)
}

export class KubernetesPlatform {
  private readonly descriptors = new Map<string, K8sDescriptor>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  kinds(): readonly K8sResourceKind[] {
    return K8S_RESOURCE_KINDS;
  }

  async declare(input: { namespace: string; kind: K8sResourceKind; name: string }): Promise<K8sDescriptor> {
    if (!K8S_RESOURCE_KINDS.includes(input.kind)) throw new Error(`unknown k8s kind: ${input.kind}`);
    const descriptor: K8sDescriptor = { id: randomId('k8s'), namespace: input.namespace, kind: input.kind, name: input.name, applied: false };
    this.descriptors.set(descriptor.id, descriptor);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: input.namespace, version: '_platform', epic: 'E2', operation: `declare.${input.kind}`, targetId: input.name, evidence: 'live-verified', decision: 'descriptor (not applied)' });
    return descriptor;
  }

  /** Count the real k8s manifest files the reused deploy asset catalog knows about. */
  manifestAssetCount(): { count: number; reusedDeploy: boolean } {
    if (this.ctx.deploy) {
      try {
        const k8s = this.ctx.deploy.assets().list().filter((a) => a.kind === 'k8s-manifest' || a.kind === 'helm-chart' || a.kind === 'helm-values' || a.kind === 'helm-template');
        return { count: k8s.length, reusedDeploy: true };
      } catch {
        return { count: 0, reusedDeploy: true };
      }
    }
    return { count: 0, reusedDeploy: false };
  }

  list(kind?: K8sResourceKind): K8sDescriptor[] {
    const all = [...this.descriptors.values()];
    return kind ? all.filter((d) => d.kind === kind) : all;
  }
  count(): number {
    return this.descriptors.size;
  }
}
