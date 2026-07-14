/**
 * The Databricks adapter + workspace-profile resolution + registration (P6.9).
 *
 * Databricks appears as ONE `CloudPlatformAdapter` (platform id `databricks`) with one workspace profile and many
 * domain collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves
 * a workspace profile (a workspace host + a Personal Access Token, env now with the vault seam documented for
 * production), builds the host-pinned `DatabricksClient` the Discovery Engine + executor inject, and registers the
 * adapter into the P6.0 platform registry. It reuses the shared rate-gate and the connector error taxonomy — no
 * new vault, no new runtime, no new dependency.
 *
 * The workspace is the account: `accountId` selects WHICH workspace's host + token to bind the transport to. A
 * single-workspace deployment uses `NEUROPAUSE_DATABRICKS_HOST` + `NEUROPAUSE_DATABRICKS_TOKEN`; a multi-workspace
 * deployment resolves the profile per-workspace from the vault (the `connectorVault` seam is reused, documented).
 * Least-privilege: a scoped PAT that lacks a product's grant simply degrades those domains `unauthorized` at
 * discovery time — never a hard failure.
 */
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { DatabricksClient } from './databricksClient';
import { DATABRICKS_COLLECTORS } from './databricksCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The Databricks platform — one adapter, one workspace profile, all domain collectors. */
export const databricksAdapter: CloudPlatformAdapter = {
  platformId: 'databricks',
  provider: 'databricks',
  baseHeaders: { Accept: 'application/json' },
  collectors: DATABRICKS_COLLECTORS,
};

/** A resolved workspace profile: the workspace base URL + the Personal Access Token. */
export interface DatabricksConfig {
  host: string;
  token: string;
}

/** Normalize a workspace host to an https URL (`dbc-xxx.cloud.databricks.com` → `https://dbc-xxx.cloud.databricks.com`). */
export function normalizeHost(raw: string): string {
  const h = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
}

/**
 * Resolve the operator's workspace profile from env (the vault-backed per-workspace wiring is documented). A PAT
 * for a user/service principal with read/monitor grants is the standard discovery profile; a full deployment
 * resolves the host + token per-workspace from the vault.
 */
export function resolveDatabricksBaseConfig(): DatabricksConfig | null {
  const host = (process.env.NEUROPAUSE_DATABRICKS_HOST ?? '').trim();
  const token = (process.env.NEUROPAUSE_DATABRICKS_TOKEN ?? '').trim();
  if (!host || !token) return null;
  return { host: normalizeHost(host), token };
}

/**
 * Build the host-pinned PAT-bearer `DiscoveryHttp` for a Databricks workspace, or null when unconfigured /
 * malformed. The `accountId` (= workspace) selects the profile; a single-workspace env profile ignores it, a
 * vault-backed deployment resolves the host + token per `accountId`.
 */
export function makeDatabricksHttp(gate: RateGate, _accountId: string): DatabricksClient | null {
  const cfg = resolveDatabricksBaseConfig();
  if (!cfg) return null;
  try {
    return new DatabricksClient(cfg.host, cfg.token, gate);
  } catch {
    // A malformed workspace URL degrades the platform unconfigured rather than crashing the runtime.
    return null;
  }
}

/** Register the Databricks adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerDatabricksPlatform(): void {
  registerPlatform(databricksAdapter);
}

/** A default rate limiter for Databricks discovery (the REST API has per-endpoint per-workspace limits; space it). */
export function databricksRateLimiter(): RateGate {
  return new RateLimiter(50);
}
