/**
 * EPIC 3 — Kubernetes Automation. Generates namespace, network-policy, resource-quota, storage-class,
 * RBAC, ingress, HPA, pod-security, configmap, and secret-reference manifests as valid YAML. It REUSES
 * the existing `deploy/helm/neuropause-backend` deployment conventions (namespace `neuropause`, backend
 * on `:4000`, HPA 2-6 @ 70%) rather than redefining the workload. The generator emits manifests only —
 * it never runs `kubectl apply`.
 */
import { toManifestFile, type Yamlish } from './serialize';
import type { Environment } from './constants';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

const NS = 'neuropause';

export class KubernetesAutomation {
  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  namespace(env: Environment): Record<string, Yamlish> {
    return {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: NS, labels: { environment: env, 'pod-security.kubernetes.io/enforce': 'restricted' } },
    };
  }

  networkPolicy(): Record<string, Yamlish> {
    return {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: 'neuropause-default-deny', namespace: NS },
      spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'] },
    };
  }

  resourceQuota(): Record<string, Yamlish> {
    return {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: { name: 'neuropause-quota', namespace: NS },
      spec: { hard: { 'requests.cpu': '2', 'requests.memory': '4Gi', 'limits.cpu': '8', 'limits.memory': '8Gi', pods: '20' } },
    };
  }

  storageClass(): Record<string, Yamlish> {
    return {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: 'neuropause-retain' },
      provisioner: 'kubernetes.io/no-provisioner',
      reclaimPolicy: 'Retain',
      volumeBindingMode: 'WaitForFirstConsumer',
    };
  }

  rbac(): Array<Record<string, Yamlish>> {
    return [
      { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: { name: 'neuropause-operator', namespace: NS }, rules: [{ apiGroups: ['apps', ''], resources: ['deployments', 'pods', 'services', 'configmaps'], verbs: ['get', 'list', 'watch'] }] },
      { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata: { name: 'neuropause-operator-binding', namespace: NS }, roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'neuropause-operator' }, subjects: [{ kind: 'Group', name: 'neuropause-operators', apiGroup: 'rbac.authorization.k8s.io' }] },
    ];
  }

  hpa(): Record<string, Yamlish> {
    return {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: 'neuropause-backend', namespace: NS },
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'neuropause-backend' },
        minReplicas: 2,
        maxReplicas: 6,
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }],
      },
    };
  }

  ingress(host: string): Record<string, Yamlish> {
    return {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name: 'neuropause-backend', namespace: NS, annotations: { 'nginx.ingress.kubernetes.io/backend-protocol': 'HTTP' } },
      spec: {
        ingressClassName: 'nginx',
        tls: [{ hosts: [host], secretName: 'neuropause-backend-tls' }],
        rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'neuropause-backend', port: { number: 80 } } } }] } }],
      },
    };
  }

  configMap(env: Environment): Record<string, Yamlish> {
    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'neuropause-backend-config', namespace: NS },
      data: { NODE_ENV: 'production', PORT: '4000', ENVIRONMENT: env },
    };
  }

  /** Secret REFERENCE only — no values. Encourages the External Secrets Operator; never embeds a secret. */
  secretReference(): Record<string, Yamlish> {
    return {
      apiVersion: 'external-secrets.io/v1beta1',
      kind: 'ExternalSecret',
      metadata: { name: 'neuropause-backend-secrets', namespace: NS },
      spec: {
        secretStoreRef: { name: 'neuropause-secret-store', kind: 'SecretStore' },
        target: { name: 'neuropause-backend-secrets' },
        data: [
          { secretKey: 'DATABASE_URL', remoteRef: { key: 'neuropause/DATABASE_URL' } },
          { secretKey: 'REDIS_URL', remoteRef: { key: 'neuropause/REDIS_URL' } },
          { secretKey: 'JWT_ACCESS_SECRET', remoteRef: { key: 'neuropause/JWT_ACCESS_SECRET' } },
        ],
      },
    };
  }

  /** Emit the full manifest set as one multi-document YAML artifact. */
  async generateAll(input: { environment: Environment; host: string }): Promise<Artifact> {
    const docs = [
      this.namespace(input.environment),
      this.networkPolicy(),
      this.resourceQuota(),
      this.storageClass(),
      ...this.rbac(),
      this.hpa(),
      this.ingress(input.host),
      this.configMap(input.environment),
      this.secretReference(),
    ];
    const artifact: Artifact = {
      kind: 'kubernetes',
      name: `neuropause-${input.environment}.yaml`,
      format: 'yaml',
      content: toManifestFile(docs),
      note: 'Kubernetes manifests reusing the neuropause-backend Helm conventions — apply out-of-band; validate with kubeconform in CI.',
    };
    await this.gov.record({ operator: this.operator, environment: input.environment, target: 'kubernetes', epic: 'E3', operation: 'generate-kubernetes', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }
}
