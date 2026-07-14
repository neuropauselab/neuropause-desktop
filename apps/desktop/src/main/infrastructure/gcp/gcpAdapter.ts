/**
 * The Google Cloud adapter + credential resolution + registration (P6.3).
 *
 * GCP appears as ONE `CloudPlatformAdapter` (platform id `gcp`) with one credential profile (a service account)
 * and many domain collectors — never dozens of connectors. This module assembles the collectors into the
 * adapter, resolves a service-account profile (env now, with the vault seam documented for production), mints an
 * app-only access token via the OAuth2 JWT-BEARER grant (an RS256 JWT signed from scratch over node:crypto — the
 * same "hand-rolled crypto, no SDK" approach as AWS SigV4), and registers the adapter into the P6.0 platform
 * registry. It reuses the shared rate-gate and the connector error taxonomy — no new OAuth engine, no new vault,
 * no new runtime. There is NO reusable app-only Google token in the repo (the existing Google auth is
 * user-delegated PKCE), so this credential provider is the minimal app-only path — a provider, not a runtime.
 */
import { createPrivateKey, createSign } from 'node:crypto';
import { AuthError, type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { GcpClient, cachedGcpToken, type GcpTokenProvider } from './gcpClient';
import { GCP_COLLECTORS } from './gcpCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The GCP platform — one adapter, one credential profile, all domain collectors. */
export const gcpAdapter: CloudPlatformAdapter = {
  platformId: 'gcp',
  provider: 'gcp',
  baseHeaders: { Accept: 'application/json' },
  collectors: GCP_COLLECTORS,
};

/** A GCP service-account profile (the fields needed to mint a JWT-bearer token). */
export interface GcpCredentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

/**
 * Resolve the operator's service account from env (the vault-backed profile wiring is documented). Accepts
 * either a full service-account JSON blob (`NEUROPAUSE_GCP_SERVICE_ACCOUNT_JSON`) or discrete
 * `NEUROPAUSE_GCP_CLIENT_EMAIL` + `NEUROPAUSE_GCP_PRIVATE_KEY`. A single service account with the Viewer role
 * across the org's projects is the standard discovery profile; a full deployment resolves the key per-project
 * from the vault (the `connectorVault` seam is reused, documented).
 */
export function resolveGcpBaseCredentials(): GcpCredentials | null {
  const json = (process.env.NEUROPAUSE_GCP_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (json) {
    try {
      const sa = JSON.parse(json) as { client_email?: string; private_key?: string; token_uri?: string };
      if (sa.client_email && sa.private_key) return { clientEmail: sa.client_email, privateKey: sa.private_key, tokenUri: sa.token_uri ?? 'https://oauth2.googleapis.com/token' };
    } catch {
      // fall through to discrete vars
    }
  }
  const clientEmail = (process.env.NEUROPAUSE_GCP_CLIENT_EMAIL ?? '').trim();
  // An env-stored PEM carries literal `\n` sequences — restore real newlines before parsing (the raw-env path;
  // a key from the vault / JSON already has real newlines). Mirrors the backend Apple-provider one-liner.
  const privateKey = (process.env.NEUROPAUSE_GCP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey, tokenUri: 'https://oauth2.googleapis.com/token' };
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

/**
 * Sign an RS256 service-account JWT assertion for a scope (from scratch, node:crypto). This is the trust anchor
 * for the whole GCP platform — every discovery + automation token is minted from it — so it is unit-tested by
 * verifying the signature with the matching public key.
 */
export function signServiceAccountJwt(creds: GcpCredentials, scope: string, nowSec: number): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), 'utf8'));
  const claims = b64url(Buffer.from(JSON.stringify({ iss: creds.clientEmail, scope, aud: creds.tokenUri, iat: nowSec, exp: nowSec + 3600 }), 'utf8'));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(createPrivateKey(creds.privateKey));
  return `${signingInput}.${b64url(signature)}`;
}

/** Exchange the signed JWT assertion for an access token via the OAuth2 `jwt-bearer` grant. */
export async function fetchGcpToken(creds: GcpCredentials, scope: string, nowSec: () => number = () => Math.floor(Date.now() / 1000)): Promise<{ token: string; expiresInSec: number }> {
  const assertion = signServiceAccountJwt(creds, scope, nowSec());
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
  const resp = await fetch(creds.tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const text = await resp.text();
  if (!resp.ok) {
    // The token endpoint returns 400/401 with { error, error_description } — never echo the description.
    throw new AuthError(`GCP token request failed (${resp.status})`, resp.status === 403 ? 403 : 401);
  }
  const jsonResp = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!jsonResp.access_token) throw new AuthError('GCP token response missing access_token', 401);
  return { token: jsonResp.access_token, expiresInSec: jsonResp.expires_in ?? 3600 };
}

/** Build a cached token provider from a service-account profile (mirrors the Azure cached token provider). */
export function gcpTokenProvider(creds: GcpCredentials): GcpTokenProvider {
  return cachedGcpToken((scope) => fetchGcpToken(creds, scope));
}

/** Build the bearer `DiscoveryHttp` for a GCP project, or null when unconfigured. The project (`accountId`) is
 *  not needed to build the transport — the token is service-account-scoped and the project travels in the URL. */
export function makeGcpHttp(gate: RateGate, _accountId: string): GcpClient | null {
  const creds = resolveGcpBaseCredentials();
  if (!creds) return null;
  return new GcpClient(gcpTokenProvider(creds), gate);
}

/** Register the GCP adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerGcpPlatform(): void {
  registerPlatform(gcpAdapter);
}

/** A default rate limiter for GCP discovery (per-host min spacing; 429 cooldown handled by the client). */
export function gcpRateLimiter(): RateGate {
  return new RateLimiter(100);
}
