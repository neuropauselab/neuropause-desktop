/**
 * The AWS Cloud Platform adapter + credential resolution + registration (P6.1).
 *
 * AWS appears as ONE `CloudPlatformAdapter` (platform id `aws`) with one credential profile and many domain
 * collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves a
 * credential profile (static env keys, with optional STS AssumeRole for cross-account temporary credentials),
 * builds the signed `AwsClient` the Discovery Engine injects, and registers the adapter into the P6.0 platform
 * registry. It reuses the shared rate-gate and the vault-backed credential model — no new auth, no new runtime.
 */
import { AuthError, type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { AwsClient, awsQuery, asArray, xmlGet, type AwsCredentials, type CredentialSource } from './awsClient';
import { AWS_COLLECTORS } from './awsCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The AWS platform — one adapter, one credential profile, all domain collectors. */
export const awsAdapter: CloudPlatformAdapter = {
  platformId: 'aws',
  provider: 'aws',
  baseHeaders: { Accept: 'application/json' },
  collectors: AWS_COLLECTORS,
};

/** Resolve the operator's BASE AWS credentials from env (the vault-backed profile wiring is documented). */
export function resolveAwsBaseCredentials(): AwsCredentials | null {
  const accessKeyId = (process.env.NEUROPAUSE_AWS_ACCESS_KEY_ID ?? '').trim();
  const secretAccessKey = (process.env.NEUROPAUSE_AWS_SECRET_ACCESS_KEY ?? '').trim();
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = (process.env.NEUROPAUSE_AWS_SESSION_TOKEN ?? '').trim() || null;
  return { accessKeyId, secretAccessKey, sessionToken };
}

/**
 * An STS AssumeRole credential provider (cross-account discovery). Uses the base credentials to assume
 * `roleArn`, caches the temporary credentials until shortly before expiry, and re-assumes when they lapse.
 * The provider is async + cached so the synchronous `makeHttp` port stays sync.
 */
export function assumeRoleProvider(base: AwsCredentials, roleArn: string, gate: RateGate, region = 'us-east-1'): () => Promise<AwsCredentials> {
  let cached: { creds: AwsCredentials; expiresAtMs: number } | null = null;
  const baseClient = new AwsClient(base, gate);
  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAtMs - 60_000 > now) return cached.creds;
    const host = `sts.${region}.amazonaws.com`;
    const root = await awsQuery(baseClient, host, 'AssumeRole', '2011-06-15', {
      RoleArn: roleArn,
      RoleSessionName: 'neuropause-infra-discovery',
      DurationSeconds: '3600',
    });
    const c = xmlGet(root, 'AssumeRoleResponse.AssumeRoleResult.Credentials') as Record<string, unknown> | null;
    const accessKeyId = c && String(c.AccessKeyId ?? '');
    const secretAccessKey = c && String(c.SecretAccessKey ?? '');
    if (!accessKeyId || !secretAccessKey) throw new AuthError('STS AssumeRole returned no credentials', 403);
    const creds: AwsCredentials = { accessKeyId, secretAccessKey, sessionToken: c ? String(c.SessionToken ?? '') : null };
    const expIso = c ? String(c.Expiration ?? '') : '';
    cached = { creds, expiresAtMs: expIso ? Date.parse(expIso) : now + 3_600_000 };
    // asArray import kept for symmetry with the collectors; STS returns a single Credentials element.
    void asArray;
    return creds;
  };
}

/**
 * Build the signed `DiscoveryHttp` for an AWS account, or null when unconfigured. If a role ARN is set
 * (globally via env, or — in a full deployment — per account from the vault), discovery runs under an
 * assumed cross-account role; otherwise it uses the base profile directly.
 */
export function makeAwsHttp(gate: RateGate, accountId: string): AwsClient | null {
  const base = resolveAwsBaseCredentials();
  if (!base) return null;
  // Per-account role ARN: a `NEUROPAUSE_AWS_ROLE_ARN_{accountId}` override, then the global fallback — a full
  // deployment resolves this from the vault per accountId (the vault seam is reused, documented).
  const roleArn = (process.env[`NEUROPAUSE_AWS_ROLE_ARN_${accountId}`] ?? process.env.NEUROPAUSE_AWS_ROLE_ARN ?? '').trim();
  const source: CredentialSource = roleArn ? assumeRoleProvider(base, roleArn, gate) : base;
  return new AwsClient(source, gate);
}

/** Register the AWS adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerAwsPlatform(): void {
  registerPlatform(awsAdapter);
}

/** A default rate limiter for AWS discovery (per-service min spacing; 429 cooldown handled by the client). */
export function awsRateLimiter(): RateGate {
  return new RateLimiter(120);
}
