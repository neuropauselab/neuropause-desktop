/**
 * The Azure Cloud Platform adapter + credential resolution + registration (P6.2).
 *
 * Azure appears as ONE `CloudPlatformAdapter` (platform id `azure`) with one credential profile and many domain
 * collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves a
 * credential profile (an Entra service principal via env, with the vault seam documented for production), builds
 * the bearer `AzureClient` the Discovery Engine + executor inject, and registers the adapter into the P6.0
 * platform registry. It reuses the shared rate-gate and the connector error taxonomy — no new OAuth engine, no
 * new vault, no new runtime.
 *
 * There is deliberately NO new OAuth service here: the repo's existing Microsoft OAuth is user-delegated (PKCE),
 * whereas infrastructure discovery needs an app-only (client-credentials) token for a service principal. That is
 * a credential PROVIDER (structurally identical to AWS's cached STS AssumeRole provider), not a parallel auth
 * runtime — it mints a short-lived token per audience and caches it, reusing `fetch` + the rate-gate + the vault.
 */
import { AuthError, type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { AzureClient, cachedTokenProvider, type AzureTokenProvider } from './azureClient';
import { AZURE_COLLECTORS } from './azureCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The Azure platform — one adapter, one credential profile, all domain collectors. */
export const azureAdapter: CloudPlatformAdapter = {
  platformId: 'azure',
  provider: 'azure',
  baseHeaders: { Accept: 'application/json' },
  collectors: AZURE_COLLECTORS,
};

/** An Entra service-principal (client-credentials) profile. */
export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Resolve the operator's Azure service-principal from env (the vault-backed profile wiring is documented). A
 *  single app registration with Reader across the tenant's subscriptions is the standard discovery profile. */
export function resolveAzureBaseCredentials(): AzureCredentials | null {
  const tenantId = (process.env.NEUROPAUSE_AZURE_TENANT_ID ?? '').trim();
  const clientId = (process.env.NEUROPAUSE_AZURE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.NEUROPAUSE_AZURE_CLIENT_SECRET ?? '').trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** Fetch an app-only token for one audience via the Entra `client_credentials` grant (per-audience `.default`). */
export async function fetchClientCredentialsToken(creds: AzureCredentials, audience: string): Promise<{ token: string; expiresInSec: number }> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: `${audience}/.default`,
  }).toString();
  const resp = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const text = await resp.text();
  if (!resp.ok) {
    // Entra returns 400/401 with { error, error_description } — never echo the description (may carry hints).
    throw new AuthError(`Azure token request failed (${resp.status})`, resp.status === 403 ? 403 : 401);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new AuthError('Azure token response missing access_token', 401);
  return { token: json.access_token, expiresInSec: json.expires_in ?? 3600 };
}

/** Build a cached, per-audience token provider from a credential profile (mirrors AWS's cached role provider). */
export function azureTokenProvider(creds: AzureCredentials): AzureTokenProvider {
  return cachedTokenProvider((audience) => fetchClientCredentialsToken(creds, audience));
}

/**
 * Build the bearer `DiscoveryHttp` for an Azure subscription, or null when unconfigured. The subscription id
 * (`accountId`) is not needed to build the transport — the token is tenant-scoped and the subscription travels in
 * the request path — but the parameter is kept to mirror `makeAwsHttp` and the `makeHttp` port signature.
 */
export function makeAzureHttp(gate: RateGate, _accountId: string): AzureClient | null {
  const creds = resolveAzureBaseCredentials();
  if (!creds) return null;
  return new AzureClient(azureTokenProvider(creds), gate);
}

/** Register the Azure adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerAzurePlatform(): void {
  registerPlatform(azureAdapter);
}

/** A default rate limiter for Azure discovery (ARM/Graph throttle per-host; 429 cooldown handled by the client). */
export function azureRateLimiter(): RateGate {
  return new RateLimiter(100);
}
