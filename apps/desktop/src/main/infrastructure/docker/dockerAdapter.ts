/**
 * The Docker adapter + engine-profile resolution + registration (P6.5).
 *
 * Docker appears as ONE `CloudPlatformAdapter` (platform id `docker`) with one Engine profile and many domain
 * collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves an
 * engine profile (a socket / TCP / mTLS target, env now with the vault seam documented for production), builds
 * the engine-pinned `DockerClient` the Discovery Engine + executor inject, and registers the adapter into the
 * P6.0 platform registry. It reuses the shared rate-gate and the connector error taxonomy — no new vault, no
 * new runtime, no new dependency (the transport is the `node:http` / `node:https` builtins).
 *
 * The engine is the account: `accountId` selects WHICH engine's target to bind the transport to. A single-engine
 * deployment uses `NEUROPAUSE_DOCKER_HOST` (+ TLS PEM env for a remote `tcp://…:2376`); a multi-engine deployment
 * resolves the target per-engine from the vault (the `connectorVault` seam is reused, documented).
 *
 * TLS: a remote engine over `tcp://…:2376` is mutually authenticated — the client cert/key and the engine CA are
 * supplied as PEM (`NEUROPAUSE_DOCKER_TLS_CERT` / `_KEY` / `_CA`, `\n`-escaped like the GCP private key) and
 * verified natively by node:https; no `undici` dependency, no process-wide trust-store mutation. A local Unix
 * socket (`unix:///var/run/docker.sock`) needs no TLS.
 */
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { DockerClient, type DockerTarget } from './dockerClient';
import { DOCKER_COLLECTORS } from './dockerCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The Docker platform — one adapter, one Engine profile, all domain collectors. */
export const dockerAdapter: CloudPlatformAdapter = {
  platformId: 'docker',
  provider: 'docker',
  baseHeaders: { Accept: 'application/json' },
  collectors: DOCKER_COLLECTORS,
};

/** A resolved engine profile: the connection target (socket / TCP / mTLS). */
export interface DockerConfig {
  target: DockerTarget;
}

/** Restore the newlines a PEM loses when carried through a single-line env var (mirrors the GCP private key). */
function pem(v: string | undefined): string | undefined {
  const out = (v ?? '').replace(/\\n/g, '\n').trim();
  return out ? out : undefined;
}

/**
 * Resolve the operator's engine profile from env (the vault-backed per-engine wiring is documented). Supports a
 * local socket (`unix:///var/run/docker.sock`) or a TCP engine (`tcp://host:2375`, or `tcp://host:2376` with
 * client TLS). Returns null when unconfigured or when the host scheme is unsupported.
 */
export function resolveDockerBaseConfig(): DockerConfig | null {
  const host = (process.env.NEUROPAUSE_DOCKER_HOST ?? '').trim();
  if (!host) return null;
  const ca = pem(process.env.NEUROPAUSE_DOCKER_TLS_CA);
  const cert = pem(process.env.NEUROPAUSE_DOCKER_TLS_CERT);
  const key = pem(process.env.NEUROPAUSE_DOCKER_TLS_KEY);

  if (host.startsWith('unix://')) {
    const socketPath = host.slice('unix://'.length);
    if (!socketPath) return null;
    return { target: { socketPath } };
  }
  if (host.startsWith('tcp://') || host.startsWith('http://') || host.startsWith('https://')) {
    let url: URL;
    try {
      url = new URL(host.replace(/^tcp:\/\//, cert || key || ca ? 'https://' : 'http://'));
    } catch {
      return null;
    }
    if (!url.hostname) return null;
    const useTls = url.protocol === 'https:' || !!(cert || key || ca);
    const target: DockerTarget = {
      host: url.hostname,
      port: url.port ? Number(url.port) : useTls ? 2376 : 2375,
      tls: useTls, // thread the intent through: an `https://` engine with no custom cert must still use TLS.
    };
    if (ca) target.ca = ca;
    if (cert) target.cert = cert;
    if (key) target.key = key;
    return { target };
  }
  return null; // an unsupported scheme (e.g. ssh://) degrades unconfigured rather than mis-binding.
}

/**
 * Build the engine-pinned `DiscoveryHttp` for a Docker engine, or null when unconfigured / malformed. The
 * `accountId` (= engine) selects the profile; a single-engine env profile ignores it, a vault-backed deployment
 * resolves the target per `accountId`.
 */
export function makeDockerHttp(gate: RateGate, accountId: string): DockerClient | null {
  const cfg = resolveDockerBaseConfig();
  if (!cfg) return null;
  try {
    return new DockerClient(cfg.target, gate, accountId || 'docker');
  } catch {
    // A malformed engine target degrades the platform unconfigured rather than crashing the runtime.
    return null;
  }
}

/** Register the Docker adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerDockerPlatform(): void {
  registerPlatform(dockerAdapter);
}

/** A default rate limiter for Docker discovery (a local socket is fast; a small spacing avoids hammering it). */
export function dockerRateLimiter(): RateGate {
  return new RateLimiter(25);
}
