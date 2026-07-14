/**
 * Kubernetes DomainCollectors (P6.4). Each collector discovers ONE Kubernetes object type via the P6.0
 * `DomainCollector` contract — it lists a resource across ALL namespaces (or cluster-wide) through the bearer
 * transport, maps each object into a `CloudResource` with its typed relationships, and returns a `DiscoveryPage`
 * carrying the `metadata.continue` token as the incremental cursor. The Discovery Engine drives paging, persists
 * the cursor, degrades a domain on 401/403 (unauthorized) / 404 (API not installed → unprovisioned), and sinks
 * resources into the Resource Store + Graph.
 *
 * Kubernetes specifics: discovery is CLUSTER-wide (`accountId` = cluster). Objects reference each other by
 * `ownerReferences` (owner→owned) and by name (spec.nodeName, volume secretName, roleRef, …). Every resource's
 * `nativeId` is a `Kind/namespace/name` (or `Kind/name` for cluster-scoped) reference, and relationships build
 * targets with the SAME helper, so the graph resolves owner/namespace/secret/node/PVC edges. The `continue`
 * token is run-scoped (a fresh run restarts the current-state snapshot; store-dedup makes re-walk the correct
 * incremental model, matching the P6.0 full-list pattern).
 */
import {
  makeResource,
  parseDiscoveryCursor,
  toDiscoveryCursor,
  type DomainCollector,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { k8sList } from './kubernetesClient';

/** Page size for list requests (the API caps at ~500 and returns a `continue` token). */
const PAGE_LIMIT = 500;

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
};

interface K8sCollectorSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  /** The Kubernetes Kind (drives the `nativeId` and how other objects reference this one). */
  kind: string;
  /** The relative list path (all-namespaces or cluster-wide), e.g. `/api/v1/pods`. */
  path: string;
  map: (item: Rec) => MappedResource;
}

/** Build a `DomainCollector` from a spec — cursor handling, mapping, and `makeResource` are uniform. */
function makeKubernetesCollector(spec: K8sCollectorSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const c = parseDiscoveryCursor(ctx.cursor);
      // Run-scoped continue token: a fresh run restarts the snapshot (a K8s list is current-state).
      const token = c && c.runAt === ctx.now ? (c.token ?? null) : null;
      const url = `${spec.path}?limit=${PAGE_LIMIT}${token ? `&continue=${encodeURIComponent(token)}` : ''}`;
      const { items, continueToken } = await k8sList(ctx.http, url);
      const resources = items.map((item) => {
        const m = spec.map(item);
        return makeResource({
          platformId: ctx.platformId,
          provider: 'kubernetes',
          accountId: ctx.accountId,
          domain: spec.domain,
          resourceType: spec.resourceType,
          region: null, // Kubernetes has no region; the namespace is an attribute + a `member_of` edge.
          now: ctx.now,
          nativeId: m.nativeId,
          name: m.name,
          status: m.status,
          health: m.health,
          tags: m.tags,
          attributes: m.attributes,
          relationships: m.relationships,
        });
      });
      return { resources, cursor: continueToken ? toDiscoveryCursor({ token: continueToken, runAt: ctx.now }) : null, hasMore: !!continueToken };
    },
  };
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);
const meta = (item: Rec): Rec => (item.metadata && typeof item.metadata === 'object' ? (item.metadata as Rec) : {});
const spec = (item: Rec): Rec => (item.spec && typeof item.spec === 'object' ? (item.spec as Rec) : {});
const statusOf = (item: Rec): Rec => (item.status && typeof item.status === 'object' ? (item.status as Rec) : {});
const nm = (item: Rec): string => s(meta(item).name) ?? '';
const ns = (item: Rec): string | null => s(meta(item).namespace);
function labelsOf(item: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  const l = meta(item).labels;
  if (l && typeof l === 'object') for (const [k, v] of Object.entries(l as Rec)) out[k] = v == null ? '' : String(v);
  return out;
}
function pget(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}
/** A canonical `Kind/namespace/name` (or `Kind/name` for cluster-scoped) reference — the nativeId scheme every
 *  object and every relationship target uses, so refs resolve against their target's own nativeId. */
function ref(kind: string, namespace: string | null | undefined, name: string | null | undefined): string | null {
  const n = s(name);
  if (!n) return null;
  return namespace ? `${kind}/${namespace}/${n}` : `${kind}/${n}`;
}
/** The `member_of` edge to the object's namespace (every namespaced resource declares it). */
const inNamespace = (item: Rec): ResourceRelationship[] => rel('member_of', ns(item) ? ref('Namespace', null, ns(item)) : null);
/** `member_of` edges to each ownerReference (a Pod → its ReplicaSet, a ReplicaSet → its Deployment, …). */
function ownerRefs(item: Rec): ResourceRelationship[] {
  const namespace = ns(item);
  return arr(meta(item).ownerReferences).flatMap((o) => rel('member_of', ref(s((o as Rec).kind) ?? '', namespace, s((o as Rec).name))));
}
/** Ready-condition health for objects that expose `status.conditions[type=Ready]`. */
function readyHealth(item: Rec): ResourceHealth {
  const cond = arr(pget(statusOf(item), 'conditions')).find((c) => s((c as Rec).type) === 'Ready');
  if (!cond) return 'unknown';
  return s((cond as Rec).status) === 'True' ? 'healthy' : 'degraded';
}

/* ── the collectors ──────────────────────────────────────────────────────────── */

const IDENTITY: K8sCollectorSpec[] = [
  {
    id: 'k8s_service_accounts', domain: 'identity', label: 'Service Accounts', resourceType: 'service_account', kind: 'ServiceAccount', path: '/api/v1/serviceaccounts',
    map: (sa) => ({ nativeId: ref('ServiceAccount', ns(sa), nm(sa)) ?? '', name: nm(sa) || 'serviceaccount', tags: labelsOf(sa), attributes: { namespace: ns(sa) }, relationships: inNamespace(sa) }),
  },
  {
    id: 'k8s_roles', domain: 'identity', label: 'Roles', resourceType: 'role', kind: 'Role', path: '/apis/rbac.authorization.k8s.io/v1/roles',
    map: (r) => ({ nativeId: ref('Role', ns(r), nm(r)) ?? '', name: nm(r) || 'role', tags: labelsOf(r), attributes: { namespace: ns(r), rules: arr(r.rules).length }, relationships: inNamespace(r) }),
  },
  {
    id: 'k8s_role_bindings', domain: 'identity', label: 'Role Bindings', resourceType: 'role_binding', kind: 'RoleBinding', path: '/apis/rbac.authorization.k8s.io/v1/rolebindings',
    map: (rb) => {
      const roleRef = pget(rb, 'roleRef') as Rec | undefined;
      const roleKind = s(roleRef?.kind) === 'ClusterRole' ? 'ClusterRole' : 'Role';
      const roleTarget = roleKind === 'ClusterRole' ? ref('ClusterRole', null, s(roleRef?.name)) : ref('Role', ns(rb), s(roleRef?.name));
      return {
        nativeId: ref('RoleBinding', ns(rb), nm(rb)) ?? '', name: nm(rb) || 'rolebinding', tags: labelsOf(rb), attributes: { namespace: ns(rb), role: s(roleRef?.name) },
        relationships: [
          ...inNamespace(rb),
          ...rel('uses', roleTarget),
          ...arr(rb.subjects).flatMap((sub) => (s((sub as Rec).kind) === 'ServiceAccount' ? rel('uses', ref('ServiceAccount', s((sub as Rec).namespace) ?? ns(rb), s((sub as Rec).name))) : [])),
        ],
      };
    },
  },
  {
    id: 'k8s_cluster_roles', domain: 'identity', label: 'Cluster Roles', resourceType: 'cluster_role', kind: 'ClusterRole', path: '/apis/rbac.authorization.k8s.io/v1/clusterroles',
    map: (r) => ({ nativeId: ref('ClusterRole', null, nm(r)) ?? '', name: nm(r) || 'clusterrole', tags: labelsOf(r), attributes: { rules: arr(r.rules).length } }),
  },
  {
    id: 'k8s_cluster_role_bindings', domain: 'identity', label: 'Cluster Role Bindings', resourceType: 'cluster_role_binding', kind: 'ClusterRoleBinding', path: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
    map: (rb) => ({
      nativeId: ref('ClusterRoleBinding', null, nm(rb)) ?? '', name: nm(rb) || 'clusterrolebinding', tags: labelsOf(rb), attributes: { role: s(pget(rb, 'roleRef.name')) },
      relationships: [
        ...rel('uses', ref('ClusterRole', null, s(pget(rb, 'roleRef.name')))),
        ...arr(rb.subjects).flatMap((sub) => (s((sub as Rec).kind) === 'ServiceAccount' ? rel('uses', ref('ServiceAccount', s((sub as Rec).namespace), s((sub as Rec).name))) : [])),
      ],
    }),
  },
];

const COMPUTE: K8sCollectorSpec[] = [
  {
    id: 'k8s_namespaces', domain: 'compute', label: 'Namespaces', resourceType: 'namespace', kind: 'Namespace', path: '/api/v1/namespaces',
    map: (n) => ({ nativeId: ref('Namespace', null, nm(n)) ?? '', name: nm(n) || 'namespace', status: s(pget(statusOf(n), 'phase')), health: s(pget(statusOf(n), 'phase')) === 'Active' ? 'healthy' : s(pget(statusOf(n), 'phase')) === 'Terminating' ? 'degraded' : 'unknown', tags: labelsOf(n) }),
  },
  {
    id: 'k8s_nodes', domain: 'compute', label: 'Nodes', resourceType: 'node', kind: 'Node', path: '/api/v1/nodes',
    map: (node) => ({
      nativeId: ref('Node', null, nm(node)) ?? '', name: nm(node) || 'node', status: spec(node).unschedulable === true ? 'unschedulable' : 'ready', health: readyHealth(node), tags: labelsOf(node),
      attributes: { kubeletVersion: s(pget(statusOf(node), 'nodeInfo.kubeletVersion')), os: s(pget(statusOf(node), 'nodeInfo.operatingSystem')), unschedulable: spec(node).unschedulable === true },
    }),
  },
  {
    id: 'k8s_pods', domain: 'compute', label: 'Pods', resourceType: 'pod', kind: 'Pod', path: '/api/v1/pods',
    map: (pod) => {
      const namespace = ns(pod);
      const phase = s(pget(statusOf(pod), 'phase'));
      const volRefs = arr(pget(spec(pod), 'volumes')).flatMap((v) => {
        const vol = v as Rec;
        return [
          ...rel('uses', s(pget(vol, 'secret.secretName')) ? ref('Secret', namespace, s(pget(vol, 'secret.secretName'))) : null),
          ...rel('uses', s(pget(vol, 'configMap.name')) ? ref('ConfigMap', namespace, s(pget(vol, 'configMap.name'))) : null),
          ...rel('uses', s(pget(vol, 'persistentVolumeClaim.claimName')) ? ref('PersistentVolumeClaim', namespace, s(pget(vol, 'persistentVolumeClaim.claimName'))) : null),
        ];
      });
      return {
        nativeId: ref('Pod', namespace, nm(pod)) ?? '', name: nm(pod) || 'pod', status: phase,
        health: phase === 'Running' || phase === 'Succeeded' ? 'healthy' : phase === 'Failed' ? 'critical' : phase === 'Pending' ? 'degraded' : 'unknown',
        tags: labelsOf(pod), attributes: { namespace, node: s(pget(spec(pod), 'nodeName')), phase },
        relationships: [
          ...rel('runs_on', s(pget(spec(pod), 'nodeName')) ? ref('Node', null, s(pget(spec(pod), 'nodeName'))) : null),
          ...inNamespace(pod),
          ...ownerRefs(pod),
          ...rel('uses', s(pget(spec(pod), 'serviceAccountName')) ? ref('ServiceAccount', namespace, s(pget(spec(pod), 'serviceAccountName'))) : null),
          ...volRefs,
        ],
      };
    },
  },
];

const CONTAINERS: K8sCollectorSpec[] = [
  {
    id: 'k8s_deployments', domain: 'containers', label: 'Deployments', resourceType: 'deployment', kind: 'Deployment', path: '/apis/apps/v1/deployments',
    map: (d) => {
      const desired = Number(s(pget(spec(d), 'replicas')) ?? 0);
      const available = Number(s(pget(statusOf(d), 'availableReplicas')) ?? 0);
      return { nativeId: ref('Deployment', ns(d), nm(d)) ?? '', name: nm(d) || 'deployment', status: `${available}/${desired}`, health: desired === 0 ? 'unknown' : available >= desired ? 'healthy' : available > 0 ? 'degraded' : 'critical', tags: labelsOf(d), attributes: { namespace: ns(d), replicas: desired, available }, relationships: [...inNamespace(d), ...ownerRefs(d)] };
    },
  },
  {
    id: 'k8s_replicasets', domain: 'containers', label: 'ReplicaSets', resourceType: 'replicaset', kind: 'ReplicaSet', path: '/apis/apps/v1/replicasets',
    map: (rs) => ({ nativeId: ref('ReplicaSet', ns(rs), nm(rs)) ?? '', name: nm(rs) || 'replicaset', status: `${Number(s(pget(statusOf(rs), 'readyReplicas')) ?? 0)}/${Number(s(pget(spec(rs), 'replicas')) ?? 0)}`, tags: labelsOf(rs), attributes: { namespace: ns(rs), replicas: Number(s(pget(spec(rs), 'replicas')) ?? 0) }, relationships: [...inNamespace(rs), ...ownerRefs(rs)] }),
  },
  {
    id: 'k8s_statefulsets', domain: 'containers', label: 'StatefulSets', resourceType: 'statefulset', kind: 'StatefulSet', path: '/apis/apps/v1/statefulsets',
    map: (ss) => {
      const desired = Number(s(pget(spec(ss), 'replicas')) ?? 0);
      const ready = Number(s(pget(statusOf(ss), 'readyReplicas')) ?? 0);
      return { nativeId: ref('StatefulSet', ns(ss), nm(ss)) ?? '', name: nm(ss) || 'statefulset', status: `${ready}/${desired}`, health: desired === 0 ? 'unknown' : ready >= desired ? 'healthy' : ready > 0 ? 'degraded' : 'critical', tags: labelsOf(ss), attributes: { namespace: ns(ss), replicas: desired, ready }, relationships: [...inNamespace(ss), ...ownerRefs(ss)] };
    },
  },
  {
    id: 'k8s_daemonsets', domain: 'containers', label: 'DaemonSets', resourceType: 'daemonset', kind: 'DaemonSet', path: '/apis/apps/v1/daemonsets',
    map: (ds) => {
      const desired = Number(s(pget(statusOf(ds), 'desiredNumberScheduled')) ?? 0);
      const ready = Number(s(pget(statusOf(ds), 'numberReady')) ?? 0);
      return { nativeId: ref('DaemonSet', ns(ds), nm(ds)) ?? '', name: nm(ds) || 'daemonset', status: `${ready}/${desired}`, health: desired === 0 ? 'unknown' : ready >= desired ? 'healthy' : ready > 0 ? 'degraded' : 'critical', tags: labelsOf(ds), attributes: { namespace: ns(ds), desired, ready }, relationships: [...inNamespace(ds), ...ownerRefs(ds)] };
    },
  },
  {
    id: 'k8s_jobs', domain: 'containers', label: 'Jobs', resourceType: 'job', kind: 'Job', path: '/apis/batch/v1/jobs',
    map: (j) => ({ nativeId: ref('Job', ns(j), nm(j)) ?? '', name: nm(j) || 'job', status: Number(s(pget(statusOf(j), 'succeeded')) ?? 0) > 0 ? 'succeeded' : Number(s(pget(statusOf(j), 'failed')) ?? 0) > 0 ? 'failed' : 'active', health: Number(s(pget(statusOf(j), 'failed')) ?? 0) > 0 ? 'critical' : Number(s(pget(statusOf(j), 'succeeded')) ?? 0) > 0 ? 'healthy' : 'unknown', tags: labelsOf(j), attributes: { namespace: ns(j) }, relationships: [...inNamespace(j), ...ownerRefs(j)] }),
  },
  {
    id: 'k8s_cronjobs', domain: 'containers', label: 'CronJobs', resourceType: 'cronjob', kind: 'CronJob', path: '/apis/batch/v1/cronjobs',
    map: (cj) => ({ nativeId: ref('CronJob', ns(cj), nm(cj)) ?? '', name: nm(cj) || 'cronjob', status: spec(cj).suspend === true ? 'suspended' : 'active', health: spec(cj).suspend === true ? 'degraded' : 'healthy', tags: labelsOf(cj), attributes: { namespace: ns(cj), schedule: s(pget(spec(cj), 'schedule')) }, relationships: inNamespace(cj) }),
  },
];

const NETWORKING: K8sCollectorSpec[] = [
  {
    id: 'k8s_services', domain: 'networking', label: 'Services', resourceType: 'service', kind: 'Service', path: '/api/v1/services',
    map: (svc) => ({ nativeId: ref('Service', ns(svc), nm(svc)) ?? '', name: nm(svc) || 'service', status: s(pget(spec(svc), 'type')) ?? 'ClusterIP', health: 'healthy', tags: labelsOf(svc), attributes: { namespace: ns(svc), type: s(pget(spec(svc), 'type')), clusterIP: s(pget(spec(svc), 'clusterIP')) }, relationships: inNamespace(svc) }),
  },
  {
    id: 'k8s_ingresses', domain: 'networking', label: 'Ingresses', resourceType: 'ingress', kind: 'Ingress', path: '/apis/networking.k8s.io/v1/ingresses',
    map: (ing) => {
      const namespace = ns(ing);
      const backends = arr(pget(spec(ing), 'rules')).flatMap((r) => arr(pget(r as Rec, 'http.paths')).flatMap((p) => rel('uses', s(pget(p as Rec, 'backend.service.name')) ? ref('Service', namespace, s(pget(p as Rec, 'backend.service.name'))) : null)));
      return { nativeId: ref('Ingress', namespace, nm(ing)) ?? '', name: nm(ing) || 'ingress', tags: labelsOf(ing), attributes: { namespace, class: s(pget(spec(ing), 'ingressClassName')) }, relationships: [...inNamespace(ing), ...backends] };
    },
  },
  {
    id: 'k8s_network_policies', domain: 'networking', label: 'Network Policies', resourceType: 'network_policy', kind: 'NetworkPolicy', path: '/apis/networking.k8s.io/v1/networkpolicies',
    map: (np) => ({ nativeId: ref('NetworkPolicy', ns(np), nm(np)) ?? '', name: nm(np) || 'networkpolicy', tags: labelsOf(np), attributes: { namespace: ns(np), policyTypes: arr(pget(spec(np), 'policyTypes')).join(',') }, relationships: inNamespace(np) }),
  },
];

const STORAGE: K8sCollectorSpec[] = [
  {
    id: 'k8s_persistent_volumes', domain: 'storage', label: 'Persistent Volumes', resourceType: 'persistent_volume', kind: 'PersistentVolume', path: '/api/v1/persistentvolumes',
    map: (pv) => ({ nativeId: ref('PersistentVolume', null, nm(pv)) ?? '', name: nm(pv) || 'pv', status: s(pget(statusOf(pv), 'phase')), health: s(pget(statusOf(pv), 'phase')) === 'Bound' || s(pget(statusOf(pv), 'phase')) === 'Available' ? 'healthy' : s(pget(statusOf(pv), 'phase')) === 'Failed' ? 'critical' : 'unknown', tags: labelsOf(pv), attributes: { capacity: s(pget(spec(pv), 'capacity.storage')), reclaimPolicy: s(pget(spec(pv), 'persistentVolumeReclaimPolicy')) }, relationships: rel('uses', s(pget(spec(pv), 'storageClassName')) ? ref('StorageClass', null, s(pget(spec(pv), 'storageClassName'))) : null) }),
  },
  {
    id: 'k8s_persistent_volume_claims', domain: 'storage', label: 'Persistent Volume Claims', resourceType: 'persistent_volume_claim', kind: 'PersistentVolumeClaim', path: '/api/v1/persistentvolumeclaims',
    map: (pvc) => ({
      nativeId: ref('PersistentVolumeClaim', ns(pvc), nm(pvc)) ?? '', name: nm(pvc) || 'pvc', status: s(pget(statusOf(pvc), 'phase')), health: s(pget(statusOf(pvc), 'phase')) === 'Bound' ? 'healthy' : s(pget(statusOf(pvc), 'phase')) === 'Lost' ? 'critical' : 'degraded', tags: labelsOf(pvc), attributes: { namespace: ns(pvc), capacity: s(pget(statusOf(pvc), 'capacity.storage')) },
      relationships: [
        ...inNamespace(pvc),
        ...rel('uses', s(pget(spec(pvc), 'volumeName')) ? ref('PersistentVolume', null, s(pget(spec(pvc), 'volumeName'))) : null),
        ...rel('uses', s(pget(spec(pvc), 'storageClassName')) ? ref('StorageClass', null, s(pget(spec(pvc), 'storageClassName'))) : null),
      ],
    }),
  },
  {
    id: 'k8s_storage_classes', domain: 'storage', label: 'Storage Classes', resourceType: 'storage_class', kind: 'StorageClass', path: '/apis/storage.k8s.io/v1/storageclasses',
    map: (sc) => ({ nativeId: ref('StorageClass', null, nm(sc)) ?? '', name: nm(sc) || 'storageclass', tags: labelsOf(sc), attributes: { provisioner: s(sc.provisioner), reclaimPolicy: s(sc.reclaimPolicy) } }),
  },
  {
    id: 'k8s_config_maps', domain: 'storage', label: 'ConfigMaps', resourceType: 'config_map', kind: 'ConfigMap', path: '/api/v1/configmaps',
    map: (cm) => ({ nativeId: ref('ConfigMap', ns(cm), nm(cm)) ?? '', name: nm(cm) || 'configmap', tags: labelsOf(cm), attributes: { namespace: ns(cm), keys: Object.keys((cm.data as Rec) ?? {}).length }, relationships: inNamespace(cm) }),
  },
];

const SECRETS: K8sCollectorSpec[] = [
  {
    // NEVER emit secret `data` — only the name, type, and key count (metadata) are surfaced.
    id: 'k8s_secrets', domain: 'secrets', label: 'Secrets', resourceType: 'secret', kind: 'Secret', path: '/api/v1/secrets',
    map: (sec) => ({ nativeId: ref('Secret', ns(sec), nm(sec)) ?? '', name: nm(sec) || 'secret', tags: labelsOf(sec), attributes: { namespace: ns(sec), type: s(sec.type), keys: Object.keys((sec.data as Rec) ?? {}).length }, relationships: inNamespace(sec) }),
  },
];

/** Every Kubernetes collector, across the infrastructure domains. */
export const KUBERNETES_COLLECTORS: DomainCollector[] = [
  ...IDENTITY,
  ...COMPUTE,
  ...CONTAINERS,
  ...NETWORKING,
  ...STORAGE,
  ...SECRETS,
].map(makeKubernetesCollector);
