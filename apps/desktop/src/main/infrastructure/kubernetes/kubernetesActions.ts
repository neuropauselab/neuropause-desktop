/**
 * P6.4 — Kubernetes automation actions (HIGH PRIVILEGE).
 *
 * Confirmation-gated mutations against the Kubernetes API server over the SAME transport discovery uses: restart
 * a Deployment / StatefulSet (the `kubectl rollout restart` annotation patch), scale a Deployment, cordon a Node,
 * drain a Node (cordon + evict its pods via the Eviction API), delete a Pod, and delete a Secret (Kubernetes has
 * no atomic secret "rotate"; deleting the superseded Secret so a controller/operator recreates it is the
 * rotation-completion step). Every one is `mutates: true` + `risk: 'high'`, so the shared `InfraActionExecutor`
 * refuses it without an explicit human confirmation and AI can never reach it. Discovery runs read-only; these
 * actions are the only writes, and Kubernetes RBAC enforces whether the service account may run them.
 *
 * The cluster IS the account: the transport (`ctx.http`) is already pinned to the account's API server, so an
 * action only builds RELATIVE paths — the cluster is never interpolated. Every path segment (namespace / name /
 * node) is validated against the Kubernetes name charset before use (defense-in-depth with the server pin).
 */
import { k8sDelete, k8sListAll, k8sPatch, k8sPost } from './kubernetesClient';
import { reqStr, InfraActionInputError, type InfraAction } from '../actionSdk';

type Rec = Record<string, unknown>;
const STRATEGIC = 'application/strategic-merge-patch+json';

/* ── strict path-segment validators (RFC 1123 — no `/`, `.` at edges, `..`, `@`, `:` → nothing escapes the path) ── */
const DNS_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const isDnsName = (v: string): boolean => DNS_RE.test(v);
function dnsName(v: string, what: string): string {
  if (!isDnsName(v)) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return v;
}
const namespace = (v: string): string => dnsName(v, 'namespace');
const name = (v: string): string => dnsName(v, 'name');
const nodeName = (v: string): string => dnsName(v, 'node name');
function replicas(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new InfraActionInputError(`Invalid replica count "${v}"`);
  return n;
}
const asArr = <T = Rec>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

export const KUBERNETES_ACTIONS: InfraAction[] = [
  {
    id: 'k8s_deployment_restart', label: 'Restart Deployment', platformId: 'kubernetes', domain: 'containers',
    description: 'Triggers a rolling restart of a Deployment (the kubectl rollout restart annotation).', mutates: true, risk: 'high', targetResourceType: 'deployment',
    params: [
      { key: 'namespace', label: 'Namespace', required: true, hint: 'default' },
      { key: 'name', label: 'Deployment Name', required: true, hint: 'web' },
    ],
    run: async (ctx, p) => {
      const nsp = namespace(reqStr(p, 'namespace'));
      const dep = name(reqStr(p, 'name'));
      await k8sPatch(ctx.http, `/apis/apps/v1/namespaces/${nsp}/deployments/${dep}`, restartPatch(ctx.now), STRATEGIC);
      return { ok: true, summary: `Rolling restart triggered for deployment ${nsp}/${dep}`, data: { namespace: nsp, name: dep } };
    },
  },
  {
    id: 'k8s_statefulset_restart', label: 'Restart StatefulSet', platformId: 'kubernetes', domain: 'containers',
    description: 'Triggers a rolling restart of a StatefulSet.', mutates: true, risk: 'high', targetResourceType: 'statefulset',
    params: [
      { key: 'namespace', label: 'Namespace', required: true, hint: 'default' },
      { key: 'name', label: 'StatefulSet Name', required: true, hint: 'db' },
    ],
    run: async (ctx, p) => {
      const nsp = namespace(reqStr(p, 'namespace'));
      const sts = name(reqStr(p, 'name'));
      await k8sPatch(ctx.http, `/apis/apps/v1/namespaces/${nsp}/statefulsets/${sts}`, restartPatch(ctx.now), STRATEGIC);
      return { ok: true, summary: `Rolling restart triggered for statefulset ${nsp}/${sts}`, data: { namespace: nsp, name: sts } };
    },
  },
  {
    id: 'k8s_deployment_scale', label: 'Scale Deployment', platformId: 'kubernetes', domain: 'containers',
    description: 'Sets the replica count of a Deployment.', mutates: true, risk: 'high', targetResourceType: 'deployment',
    params: [
      { key: 'namespace', label: 'Namespace', required: true, hint: 'default' },
      { key: 'name', label: 'Deployment Name', required: true, hint: 'web' },
      { key: 'replicas', label: 'Replicas', required: true, hint: '3' },
    ],
    run: async (ctx, p) => {
      const nsp = namespace(reqStr(p, 'namespace'));
      const dep = name(reqStr(p, 'name'));
      const count = replicas(reqStr(p, 'replicas'));
      await k8sPatch(ctx.http, `/apis/apps/v1/namespaces/${nsp}/deployments/${dep}/scale`, { spec: { replicas: count } });
      return { ok: true, summary: `Scaled deployment ${nsp}/${dep} to ${count} replica(s)`, data: { namespace: nsp, name: dep, replicas: count } };
    },
  },
  {
    id: 'k8s_node_cordon', label: 'Cordon Node', platformId: 'kubernetes', domain: 'compute',
    description: 'Marks a Node unschedulable so no new pods land on it.', mutates: true, risk: 'high', targetResourceType: 'node',
    params: [{ key: 'nodeName', label: 'Node Name', required: true, hint: 'node-1' }],
    run: async (ctx, p) => {
      const node = nodeName(reqStr(p, 'nodeName'));
      await k8sPatch(ctx.http, `/api/v1/nodes/${node}`, { spec: { unschedulable: true } });
      return { ok: true, summary: `Cordoned node ${node} (unschedulable)`, data: { node } };
    },
  },
  {
    id: 'k8s_node_drain', label: 'Drain Node', platformId: 'kubernetes', domain: 'compute',
    description: 'Cordons a Node and evicts its pods (skipping DaemonSet-managed and static/mirror pods).', mutates: true, risk: 'high', targetResourceType: 'node',
    params: [{ key: 'nodeName', label: 'Node Name', required: true, hint: 'node-1' }],
    run: async (ctx, p) => {
      const node = nodeName(reqStr(p, 'nodeName'));
      // 1. Cordon.
      await k8sPatch(ctx.http, `/api/v1/nodes/${node}`, { spec: { unschedulable: true } });
      // 2. List ALL the node's pods — follow the `continue` token to exhaustion, since a large node's pod set
      //    exceeds one page (a single-page list would silently under-drain yet report success).
      const pods = await k8sListAll(ctx.http, `/api/v1/pods?limit=500&fieldSelector=${encodeURIComponent(`spec.nodeName=${node}`)}`);
      // 3. Evict the eligible ones. DaemonSet-owned + static/mirror pods are skipped; the API-derived pod
      //    namespace/name are held to the SAME strict RFC-1123 charset as user input; a per-pod eviction
      //    failure (e.g. a PodDisruptionBudget block) is tallied and does NOT abort the rest of the drain.
      let evicted = 0;
      let skipped = 0;
      let failed = 0;
      for (const pod of pods) {
        const m = (pod.metadata && typeof pod.metadata === 'object' ? (pod.metadata as Rec) : {}) as Rec;
        const owners = asArr(m.ownerReferences);
        const isDaemonSet = owners.some((o) => String((o as Rec).kind) === 'DaemonSet');
        const isMirror = !!(m.annotations && typeof m.annotations === 'object' && (m.annotations as Rec)['kubernetes.io/config.mirror'] !== undefined);
        const pns = typeof m.namespace === 'string' ? m.namespace : '';
        const pname = typeof m.name === 'string' ? m.name : '';
        if (isDaemonSet || isMirror || !isDnsName(pns) || !isDnsName(pname)) {
          skipped += 1;
          continue;
        }
        try {
          await k8sPost(ctx.http, `/api/v1/namespaces/${pns}/pods/${pname}/eviction`, { apiVersion: 'policy/v1', kind: 'Eviction', metadata: { name: pname, namespace: pns } });
          evicted += 1;
        } catch {
          failed += 1; // e.g. a PodDisruptionBudget block — record it and keep draining the rest
        }
      }
      return { ok: failed === 0, summary: `Drain of node ${node}: cordoned, evicted ${evicted}, skipped ${skipped}${failed ? `, ${failed} blocked` : ''}`, data: { node, evicted, skipped, failed } };
    },
  },
  {
    id: 'k8s_pod_delete', label: 'Delete Pod', platformId: 'kubernetes', domain: 'compute',
    description: 'Deletes a Pod (its controller reschedules a replacement).', mutates: true, risk: 'high', targetResourceType: 'pod',
    params: [
      { key: 'namespace', label: 'Namespace', required: true, hint: 'default' },
      { key: 'name', label: 'Pod Name', required: true, hint: 'web-abc123' },
    ],
    run: async (ctx, p) => {
      const nsp = namespace(reqStr(p, 'namespace'));
      const pod = name(reqStr(p, 'name'));
      await k8sDelete(ctx.http, `/api/v1/namespaces/${nsp}/pods/${pod}`);
      return { ok: true, summary: `Deleted pod ${nsp}/${pod}`, data: { namespace: nsp, name: pod } };
    },
  },
  {
    id: 'k8s_secret_delete', label: 'Delete Secret (Rotate)', platformId: 'kubernetes', domain: 'secrets',
    description: 'Deletes a Secret — the rotation-completion step (Kubernetes has no atomic rotate); a controller or operator recreates it.', mutates: true, risk: 'high', targetResourceType: 'secret',
    params: [
      { key: 'namespace', label: 'Namespace', required: true, hint: 'default' },
      { key: 'name', label: 'Secret Name', required: true, hint: 'db-password' },
    ],
    run: async (ctx, p) => {
      const nsp = namespace(reqStr(p, 'namespace'));
      const sec = name(reqStr(p, 'name'));
      await k8sDelete(ctx.http, `/api/v1/namespaces/${nsp}/secrets/${sec}`);
      return { ok: true, summary: `Deleted secret ${nsp}/${sec}`, data: { namespace: nsp, name: sec } };
    },
  },
];

/** The `kubectl rollout restart` strategic-merge patch: stamp a restart annotation on the pod template. */
function restartPatch(now: string): Rec {
  return { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': now } } } } };
}

/** Bind the Kubernetes actions (used by the executor registration in the runtime composition root). */
export function kubernetesActions(): InfraAction[] {
  return KUBERNETES_ACTIONS;
}
