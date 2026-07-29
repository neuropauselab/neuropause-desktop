/**
 * Module 4 — Kubernetes Operations. Produces manifest DESCRIPTORS for eleven resource kinds
 * and validates their shape. Manifests are validated only — they are NEVER applied. Real
 * `kubectl apply` against a cluster is INFRA-PENDING (needs a real cluster + kubeconfig).
 */
import { randomId } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { K8sManifest, ManifestValidation } from './types';
import { K8S_KINDS, type K8sKind } from './constants';

export interface DescribeManifestInput {
  name: string;
  namespace?: string;
  image?: string;
  replicas?: number;
  labels?: Record<string, string>;
  ports?: number[];
  data?: Record<string, string>;
  storage?: string;
  minReplicas?: number;
  maxReplicas?: number;
  host?: string;
}

function buildManifest(kind: K8sKind, i: DescribeManifestInput): Record<string, unknown> {
  const name = i.name;
  const namespace = i.namespace ?? 'default';
  const labels = i.labels ?? { app: name };
  const image = i.image ?? 'neuropause/nems:preview';
  const replicas = i.replicas ?? 1;
  const ports = i.ports ?? [8080];
  const container = { name, image, ports: ports.map((p) => ({ containerPort: p })), resources: { limits: { cpu: '500m', memory: '512Mi' }, requests: { cpu: '250m', memory: '256Mi' } }, securityContext: { runAsNonRoot: true } };
  const podTemplate = { metadata: { labels }, spec: { containers: [container] } };
  switch (kind) {
    case 'Namespace':
      return { apiVersion: 'v1', kind, metadata: { name, labels } };
    case 'Deployment':
      return { apiVersion: 'apps/v1', kind, metadata: { name, namespace, labels }, spec: { replicas, selector: { matchLabels: labels }, template: podTemplate } };
    case 'StatefulSet':
      return { apiVersion: 'apps/v1', kind, metadata: { name, namespace, labels }, spec: { serviceName: name, replicas, selector: { matchLabels: labels }, template: podTemplate } };
    case 'DaemonSet':
      return { apiVersion: 'apps/v1', kind, metadata: { name, namespace, labels }, spec: { selector: { matchLabels: labels }, template: podTemplate } };
    case 'Service':
      return { apiVersion: 'v1', kind, metadata: { name, namespace, labels }, spec: { selector: labels, ports: ports.map((p) => ({ port: p, targetPort: p })) } };
    case 'ConfigMap':
      return { apiVersion: 'v1', kind, metadata: { name, namespace }, data: i.data ?? { 'app.conf': 'key=value' } };
    case 'Secret':
      // reference-only: names the keys, never real secret material.
      return { apiVersion: 'v1', kind, metadata: { name, namespace }, type: 'Opaque', stringDataKeys: Object.keys(i.data ?? { token: '' }), note: 'reference shape only — no secret material' };
    case 'Ingress':
      return { apiVersion: 'networking.k8s.io/v1', kind, metadata: { name, namespace }, spec: { rules: [{ host: i.host ?? `${name}.example.com`, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name, port: { number: ports[0] } } } }] } }] } };
    case 'HorizontalPodAutoscaler':
      return { apiVersion: 'autoscaling/v2', kind, metadata: { name, namespace }, spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name }, minReplicas: i.minReplicas ?? 1, maxReplicas: i.maxReplicas ?? 5, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }] } };
    case 'NetworkPolicy':
      return { apiVersion: 'networking.k8s.io/v1', kind, metadata: { name, namespace }, spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress', 'Egress'], ingress: [{ from: [{ podSelector: { matchLabels: labels } }] }] } };
    case 'PersistentVolumeClaim':
      return { apiVersion: 'v1', kind, metadata: { name, namespace }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: i.storage ?? '1Gi' } } } };
  }
}

/** Kind-specific required paths, checked against the produced manifest. */
const REQUIRED: Record<K8sKind, string[]> = {
  Namespace: ['metadata.name'],
  Deployment: ['spec.selector', 'spec.template'],
  StatefulSet: ['spec.serviceName', 'spec.template'],
  DaemonSet: ['spec.selector', 'spec.template'],
  Service: ['spec.ports'],
  ConfigMap: ['data'],
  Secret: ['type'],
  Ingress: ['spec.rules'],
  HorizontalPodAutoscaler: ['spec.scaleTargetRef', 'spec.maxReplicas'],
  NetworkPolicy: ['spec.podSelector', 'spec.policyTypes'],
  PersistentVolumeClaim: ['spec.accessModes', 'spec.resources'],
};

function hasPath(obj: Record<string, unknown>, path: string): boolean {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(seg in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur !== undefined;
}

export class KubernetesOperations {
  private readonly manifests = new Map<string, K8sManifest>();

  constructor(private readonly governance: CloudOpsGovernance) {}

  async describe(kind: K8sKind, input: DescribeManifestInput): Promise<K8sManifest> {
    if (!K8S_KINDS.includes(kind)) throw new Error(`unknown Kubernetes kind: ${kind}`);
    const manifest: K8sManifest = {
      id: randomId('k8s'),
      kind,
      name: input.name,
      namespace: input.namespace ?? 'default',
      spec: buildManifest(kind, input),
      evidence: 'adapter-verified',
      note: `${kind} manifest shape validated — real apply is INFRA-PENDING (needs a real cluster + kubeconfig)`,
    };
    this.manifests.set(manifest.id, manifest);
    await this.governance.record({ actor: 'system', operation: `k8s.describe.${kind}`, targetId: manifest.id, evidence: 'adapter-verified', detail: manifest.note });
    return manifest;
  }

  /** Validate the manifest SHAPE. Real cluster admission is not performed. */
  validate(manifest: K8sManifest): ManifestValidation {
    const problems: string[] = [];
    const spec = manifest.spec;
    if (!spec['apiVersion']) problems.push('missing apiVersion');
    if (spec['kind'] !== manifest.kind) problems.push('kind mismatch');
    if (!hasPath(spec, 'metadata.name')) problems.push('missing metadata.name');
    for (const path of REQUIRED[manifest.kind]) {
      if (!hasPath(spec, path)) problems.push(`missing ${path}`);
    }
    return { kind: manifest.kind, valid: problems.length === 0, problems };
  }

  get(id: string): K8sManifest | undefined {
    return this.manifests.get(id);
  }
  list(kind?: K8sKind): K8sManifest[] {
    const all = [...this.manifests.values()];
    return kind ? all.filter((m) => m.kind === kind) : all;
  }
  kinds(): readonly K8sKind[] {
    return K8S_KINDS;
  }
  count(): number {
    return this.manifests.size;
  }
}
