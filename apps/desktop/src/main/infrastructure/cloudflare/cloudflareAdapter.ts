/**
 * The Cloudflare adapter + account-profile resolution + registration (P6.7).
 *
 * Cloudflare appears as ONE `CloudPlatformAdapter` (platform id `cloudflare`) with one account profile and many
 * domain collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves
 * an account profile (a scoped API token, env now with the vault seam documented for production), builds the
 * fixed-host bearer `CloudflareClient` the Discovery Engine + executor inject, and registers the adapter into the
 * P6.0 platform registry. It reuses the shared rate-gate and the connector error taxonomy — no new vault, no new
 * runtime, no new dependency.
 *
 * The account is the scope: a single scoped API token can reach one (or more) Cloudflare accounts and their zones;
 * the collectors resolve the accessible account(s) and zone(s) at runtime (`/accounts`, `/zones`). A single-account
 * deployment uses `NEUROPAUSE_CLOUDFLARE_API_TOKEN`; a multi-account deployment resolves the token per-account from
 * the vault (the `connectorVault` seam is reused, documented). Least-privilege: a token scoped to only some
 * products simply degrades the other domains `unauthorized` at discovery time — never a hard failure.
 */
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { CloudflareClient } from './cloudflareClient';
import { CLOUDFLARE_COLLECTORS } from './cloudflareCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The Cloudflare platform — one adapter, one API-token profile, all domain collectors. */
export const cloudflareAdapter: CloudPlatformAdapter = {
  platformId: 'cloudflare',
  provider: 'cloudflare',
  baseHeaders: { Accept: 'application/json' },
  collectors: CLOUDFLARE_COLLECTORS,
};

/** A resolved account profile: the scoped API token. */
export interface CloudflareConfig {
  token: string;
}

/**
 * Resolve the operator's Cloudflare profile from env (the vault-backed per-account wiring is documented). A
 * read-scoped API token (Zone:Read, DNS:Read, Account:Read, plus the product read scopes) is the standard
 * discovery profile; a full deployment resolves the token per-account from the vault.
 */
export function resolveCloudflareBaseConfig(): CloudflareConfig | null {
  const token = (process.env.NEUROPAUSE_CLOUDFLARE_API_TOKEN ?? '').trim();
  if (!token) return null;
  return { token };
}

/**
 * Build the fixed-host bearer `DiscoveryHttp` for Cloudflare, or null when unconfigured. The `accountId` (= the
 * Cloudflare account, or `default`) is used by the collectors to scope zones/accounts; the token itself is the
 * single credential.
 */
export function makeCloudflareHttp(gate: RateGate, _accountId: string): CloudflareClient | null {
  const cfg = resolveCloudflareBaseConfig();
  if (!cfg) return null;
  try {
    return new CloudflareClient(cfg.token, gate);
  } catch {
    return null;
  }
}

/** Register the Cloudflare adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerCloudflarePlatform(): void {
  registerPlatform(cloudflareAdapter);
}

/** A default rate limiter for Cloudflare discovery (the API caps at 1200 req / 5 min per user; space requests). */
export function cloudflareRateLimiter(): RateGate {
  return new RateLimiter(50);
}
