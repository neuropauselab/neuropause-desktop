/**
 * The VMware adapter + vCenter-profile resolution + registration (P6.6).
 *
 * VMware appears as ONE `CloudPlatformAdapter` (platform id `vmware`) with one vCenter profile and many domain
 * collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves a
 * vCenter profile (a base URL + username + password, env now with the vault seam documented for production),
 * builds the server-pinned session `VmwareClient` the Discovery Engine + executor inject, and registers the
 * adapter into the P6.0 platform registry. It reuses the shared rate-gate and the connector error taxonomy — no
 * new vault, no new runtime, no new dependency.
 *
 * The vCenter is the account: `accountId` selects WHICH vCenter's base URL + credentials to bind the transport
 * to. A single-vCenter deployment uses `NEUROPAUSE_VMWARE_HOST` + `_USERNAME` + `_PASSWORD`; a multi-vCenter
 * deployment resolves the profile per-vCenter from the vault (the `connectorVault` seam is reused, documented).
 *
 * TLS: the client verifies vCenter against the process trust store. A private vCenter CA (very common — vCenter
 * ships a self-signed CA) is trusted via the standard `NODE_EXTRA_CA_CERTS` mechanism (write the vCenter CA PEM
 * to a file and point the env var at it before launch). Per-request CA injection via an undici dispatcher is a
 * documented enhancement (it would add the `undici` dependency); see the Security Review.
 */
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { VmwareClient } from './vmwareClient';
import { VMWARE_COLLECTORS } from './vmwareCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The VMware platform — one adapter, one vCenter profile, all domain collectors. */
export const vmwareAdapter: CloudPlatformAdapter = {
  platformId: 'vmware',
  provider: 'vmware',
  baseHeaders: { Accept: 'application/json' },
  collectors: VMWARE_COLLECTORS,
};

/** A resolved vCenter profile: the base URL + the discovery credentials. */
export interface VmwareConfig {
  server: string;
  username: string;
  password: string;
}

/**
 * Resolve the operator's vCenter profile from env (the vault-backed per-vCenter wiring is documented). A
 * read-only role (the built-in `Read-only` vSphere role, or a custom role with `System.Read`) is the standard
 * discovery profile; a full deployment resolves the base URL + credentials per-vCenter from the vault.
 */
export function resolveVmwareBaseConfig(): VmwareConfig | null {
  const server = (process.env.NEUROPAUSE_VMWARE_HOST ?? '').trim();
  const username = (process.env.NEUROPAUSE_VMWARE_USERNAME ?? '').trim();
  const password = process.env.NEUROPAUSE_VMWARE_PASSWORD ?? '';
  if (!server || !username || !password) return null;
  return { server, username, password };
}

/**
 * Build the server-pinned session `DiscoveryHttp` for a vCenter, or null when unconfigured / malformed. The
 * `accountId` (= vCenter) selects the profile; a single-vCenter env profile ignores it, a vault-backed
 * deployment resolves the profile per `accountId`.
 */
export function makeVmwareHttp(gate: RateGate, _accountId: string): VmwareClient | null {
  const cfg = resolveVmwareBaseConfig();
  if (!cfg) return null;
  try {
    return new VmwareClient(cfg.server, cfg.username, cfg.password, gate);
  } catch {
    // A malformed vCenter URL degrades the platform unconfigured rather than crashing the runtime.
    return null;
  }
}

/** Register the VMware adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerVmwarePlatform(): void {
  registerPlatform(vmwareAdapter);
}

/** A default rate limiter for VMware discovery (vCenter is sensitive to request storms; space them a little). */
export function vmwareRateLimiter(): RateGate {
  return new RateLimiter(50);
}
