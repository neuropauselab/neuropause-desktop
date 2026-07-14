/**
 * The IaC adapter + source resolution + registration (P6.10). Terraform, OpenTofu, and Pulumi appear as ONE
 * `CloudPlatformAdapter` (platform id `iac`) whose ACCOUNTS are the configured backends (flavor `terraform` /
 * `opentofu` / `pulumi`) — never three platforms, never three connectors. This module resolves each backend
 * profile (host + API token + organization), builds the flavor-aware host-pinned `IacClient` the Discovery Engine
 * + executor inject, and registers the one adapter into the P6.0 platform registry. It reuses the shared rate-gate
 * and the connector error taxonomy — no new vault, no new runtime.
 *
 * The `accountId` selects the backend: a single-backend deployment uses that flavor's env profile (and answers to
 * `default`), a multi-backend deployment configures several flavors independently. A per-organization vault-backed
 * profile is the documented production wiring; env is the operator default.
 */
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { IacClient, type IacClientConfig } from './iacClient';
import { IAC_COLLECTORS } from './iacCollectors';
import type { IacFlavor } from './iacState';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The IaC platform — one adapter, one registry, all provisioning-domain collectors, three backend flavors. */
export const iacAdapter: CloudPlatformAdapter = {
  platformId: 'iac',
  provider: 'iac',
  baseHeaders: {},
  collectors: IAC_COLLECTORS,
};

/** A resolved backend profile. */
export type IacSource = IacClientConfig;

/** The default backend host per flavor (OpenTofu runs against a TFC-compatible backend). */
const DEFAULT_HOST: Record<IacFlavor, string> = {
  terraform: 'https://app.terraform.io',
  opentofu: 'https://app.terraform.io',
  pulumi: 'https://api.pulumi.com',
};

/** Normalize a backend host to an https URL, stripping trailing slashes. */
export function normalizeHost(raw: string): string {
  const h = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
}

const ENV_PREFIX: Record<IacFlavor, string> = {
  terraform: 'NEUROPAUSE_IAC_TERRAFORM',
  opentofu: 'NEUROPAUSE_IAC_OPENTOFU',
  pulumi: 'NEUROPAUSE_IAC_PULUMI',
};

function resolveOne(flavor: IacFlavor): IacSource | null {
  const prefix = ENV_PREFIX[flavor];
  const token = (process.env[`${prefix}_TOKEN`] ?? '').trim();
  const organization = (process.env[`${prefix}_ORG`] ?? '').trim();
  if (!token || !organization) return null;
  const host = (process.env[`${prefix}_HOST`] ?? '').trim();
  return { flavor, token, organization, host: host ? normalizeHost(host) : DEFAULT_HOST[flavor] };
}

/** Resolve every configured backend profile, keyed by `accountId` (= the flavor). */
export function resolveIacSources(): Map<string, IacSource> {
  const out = new Map<string, IacSource>();
  for (const flavor of ['terraform', 'opentofu', 'pulumi'] as const) {
    const src = resolveOne(flavor);
    if (src) out.set(flavor, src);
  }
  return out;
}

/** Resolve the backend profile for an `accountId` (a flavor, or `default` → the sole configured backend). */
export function resolveIacSource(accountId: string): IacSource | null {
  const sources = resolveIacSources();
  if (sources.has(accountId)) return sources.get(accountId)!;
  if (accountId === 'default' && sources.size === 1) return [...sources.values()][0];
  return null;
}

/**
 * Build the flavor-aware host-pinned `IacTransport` for a backend account, or null when unconfigured / malformed.
 * The `accountId` selects the backend; a malformed host degrades the platform unconfigured rather than crashing.
 */
export function makeIacHttp(gate: RateGate, accountId: string): IacClient | null {
  const src = resolveIacSource(accountId);
  if (!src) return null;
  try {
    return new IacClient(src, gate);
  } catch {
    return null;
  }
}

/** Register the IaC adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerIacPlatform(): void {
  registerPlatform(iacAdapter);
}

/** A default rate limiter for IaC discovery (TFC ~30 req/s, Pulumi per-org limits — space it). */
export function iacRateLimiter(): RateGate {
  return new RateLimiter(50);
}
