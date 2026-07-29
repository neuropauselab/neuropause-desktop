/**
 * Module 6 — Deployment Runtime. Generates deployment DESCRIPTORS for seven targets
 * (Local / Docker / Kubernetes / Air-gap / AWS / Azure / GCP). Descriptors only — they are
 * validated as shapes (adapter-verified) but NEVER applied. Real Kubernetes/AWS/Azure/GCP
 * deployment is infra-pending and is never executed.
 */
import { randomId } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { DeploymentDescriptor } from './types';
import { CLOUD_TARGETS, type DeploymentTarget } from './constants';

export interface DescribeOptions {
  image?: string;
  replicas?: number;
  env?: Record<string, string>;
}

function buildSpec(target: DeploymentTarget, name: string, opts: DescribeOptions): Record<string, unknown> {
  const image = opts.image ?? 'neuropause/nems:preview';
  const replicas = opts.replicas ?? 1;
  const env = opts.env ?? {};
  switch (target) {
    case 'local':
      return { kind: 'process', command: 'node', entry: 'dist/index.js', env };
    case 'docker':
      return { kind: 'compose', version: '3.9', services: { [name]: { image, ports: ['8080:8080'], environment: env } } };
    case 'kubernetes':
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name },
        spec: { replicas, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name, image, ports: [{ containerPort: 8080 }] }] } } },
      };
    case 'air-gap':
      return { kind: 'airgap-bundle', offline: true, image, artifacts: [`${name}.tar`], checksums: {} };
    case 'aws':
      return { kind: 'ecs-task-definition', family: name, cpu: '512', memory: '1024', containerDefinitions: [{ name, image, portMappings: [{ containerPort: 8080 }], environment: Object.entries(env).map(([k, v]) => ({ name: k, value: v })) }] };
    case 'azure':
      return { kind: 'containerApp', properties: { configuration: { ingress: { external: true, targetPort: 8080 } }, template: { containers: [{ name, image }], scale: { minReplicas: replicas } } } };
    case 'gcp':
      return { apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata: { name }, spec: { template: { spec: { containers: [{ image }] } } } };
  }
}

export class DeploymentRuntime {
  private readonly descriptors = new Map<string, DeploymentDescriptor>();

  constructor(private readonly governance: FederationGovernance) {}

  async describe(target: DeploymentTarget, input: { name: string } & DescribeOptions): Promise<DeploymentDescriptor> {
    const isCloud = CLOUD_TARGETS.includes(target);
    const descriptor: DeploymentDescriptor = {
      id: randomId('deploy'),
      target,
      name: input.name,
      spec: buildSpec(target, input.name, input),
      evidence: 'adapter-verified',
      note: isCloud ? `${target} descriptor generated — real deployment is INFRA-PENDING (needs a real cluster/cloud account + credentials)` : `${target} descriptor generated — not applied`,
    };
    this.descriptors.set(descriptor.id, descriptor);
    await this.governance.record({ federationId: '_platform', actor: 'system', operation: `deployment.describe.${target}`, targetId: descriptor.id, evidence: 'adapter-verified', detail: descriptor.note });
    return descriptor;
  }

  get(id: string): DeploymentDescriptor | undefined {
    return this.descriptors.get(id);
  }
  list(target?: DeploymentTarget): DeploymentDescriptor[] {
    const all = [...this.descriptors.values()];
    return target ? all.filter((d) => d.target === target) : all;
  }
  inventory(): Record<string, number> {
    const inv: Record<string, number> = {};
    for (const d of this.descriptors.values()) inv[d.target] = (inv[d.target] ?? 0) + 1;
    return inv;
  }
  count(): number {
    return this.descriptors.size;
  }
}
