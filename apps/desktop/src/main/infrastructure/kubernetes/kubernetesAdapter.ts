/**
 * The Kubernetes adapter + credential resolution + registration (P6.4).
 *
 * Kubernetes appears as ONE `CloudPlatformAdapter` (platform id `kubernetes`) with one kubeconfig profile and
 * many domain collectors — never dozens of connectors. This module assembles the collectors into the adapter,
 * resolves a cluster profile (an API-server URL + a service-account bearer token, env now with the vault seam
 * documented for production), builds the server-pinned `KubernetesClient` the Discovery Engine + executor inject,
 * and registers the adapter into the P6.0 platform registry. It reuses the shared rate-gate and the connector
 * error taxonomy — no new vault, no new runtime.
 *
 * The cluster is the account: `accountId` selects WHICH cluster's server + token to bind the transport to. A
 * single-cluster deployment uses `NEUROPAUSE_K8S_API_SERVER` + `NEUROPAUSE_K8S_TOKEN`; a multi-cluster deployment
 * resolves the profile per-cluster from the vault (the `connectorVault` seam is reused, documented).
 *
 * TLS: the client verifies the API server against the process trust store. A private cluster CA is trusted via
 * the standard `NODE_EXTRA_CA_CERTS` mechanism (write the cluster CA PEM to a file and point the env var at it
 * before launch). Per-request CA injection via an undici dispatcher is a documented enhancement (it would add
 * the `undici` dependency); see the Security Review.
 */
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { KubernetesClient } from './kubernetesClient';
import { KUBERNETES_COLLECTORS } from './kubernetesCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The Kubernetes platform — one adapter, one kubeconfig profile, all domain collectors. */
export const kubernetesAdapter: CloudPlatformAdapter = {
  platformId: 'kubernetes',
  provider: 'kubernetes',
  baseHeaders: { Accept: 'application/json' },
  collectors: KUBERNETES_COLLECTORS,
};

/** A resolved cluster profile: the API-server base URL + a service-account bearer token. */
export interface KubernetesConfig {
  server: string;
  token: string;
}

/**
 * Resolve the operator's cluster profile from env (the vault-backed per-cluster wiring is documented). A
 * service account with cluster-wide read (the built-in `view` ClusterRole) is the standard discovery profile; a
 * full deployment resolves the server + token per-cluster from the vault (the `connectorVault` seam is reused).
 */
export function resolveKubernetesBaseConfig(): KubernetesConfig | null {
  const server = (process.env.NEUROPAUSE_K8S_API_SERVER ?? '').trim();
  const token = (process.env.NEUROPAUSE_K8S_TOKEN ?? '').trim();
  if (!server || !token) return null;
  return { server, token };
}

/**
 * Build the server-pinned bearer `DiscoveryHttp` for a cluster, or null when unconfigured / malformed. The
 * `accountId` (= cluster) selects the profile; a single-cluster env profile ignores it, a vault-backed
 * deployment resolves the server + token per `accountId`.
 */
export function makeKubernetesHttp(gate: RateGate, _accountId: string): KubernetesClient | null {
  const cfg = resolveKubernetesBaseConfig();
  if (!cfg) return null;
  try {
    return new KubernetesClient(cfg.server, cfg.token, gate);
  } catch {
    // A malformed API-server URL degrades the platform unconfigured rather than crashing the runtime.
    return null;
  }
}

/** Register the Kubernetes adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerKubernetesPlatform(): void {
  registerPlatform(kubernetesAdapter);
}

/** A default rate limiter for Kubernetes discovery (the API server throttles; 429 cooldown handled by client). */
export function kubernetesRateLimiter(): RateGate {
  return new RateLimiter(50);
}
