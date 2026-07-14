/**
 * The Snowflake adapter + account-profile resolution + key-pair JWT signing + registration (P6.8).
 *
 * Snowflake appears as ONE `CloudPlatformAdapter` (platform id `snowflake`) with one account profile and many
 * domain collectors — never dozens of connectors. This module assembles the collectors into the adapter, resolves
 * an account profile (account identifier + user + RSA private key, env now with the vault seam documented for
 * production), signs the key-pair JWT the SQL API authenticates with, builds the host-pinned `SnowflakeClient` the
 * Discovery Engine + executor inject, and registers the adapter into the P6.0 platform registry. It reuses the
 * shared rate-gate and the connector error taxonomy — no new vault, no new runtime, no new dependency
 * (`node:crypto` is a builtin, already used across the desktop main process).
 *
 * KEY-PAIR JWT — the same RS256 signing GCP uses for its service account, with Snowflake's claims: `iss` =
 * `<ACCOUNT>.<USER>.SHA256:<public-key-fingerprint>`, `sub` = `<ACCOUNT>.<USER>`, `iat`/`exp` (< 1-hour cap). The
 * account identifier and user are UPPER-cased and any periods in the account become hyphens (Snowflake's rule);
 * the fingerprint is `SHA256:` + base64(SHA-256(DER SPKI public key)) derived from the private key. The signed JWT
 * is self-contained (no token-exchange), cached, and re-signed ~1 minute before it expires.
 *
 * The account is the scope: `accountId` selects WHICH account's host + credentials to bind the transport to. A
 * single-account deployment uses `NEUROPAUSE_SNOWFLAKE_ACCOUNT` + `_USER` + `_PRIVATE_KEY`; a multi-account
 * deployment resolves the profile per-account from the vault (the `connectorVault` seam is reused, documented).
 */
import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto';
import { type RateGate } from '../../unified/sync/http';
import { RateLimiter } from '../../unified/sync/rateLimiter';
import { registerPlatform } from '../platformRegistry';
import { SnowflakeClient, type SnowflakeTokenProvider } from './snowflakeClient';
import { SNOWFLAKE_COLLECTORS } from './snowflakeCollectors';
import type { CloudPlatformAdapter } from '@neuropause/shared';

/** The Snowflake platform — one adapter, one account profile, all domain collectors. */
export const snowflakeAdapter: CloudPlatformAdapter = {
  platformId: 'snowflake',
  provider: 'snowflake',
  baseHeaders: { Accept: 'application/json' },
  collectors: SNOWFLAKE_COLLECTORS,
};

/** A resolved account profile: the account identifier + user + RSA private key (PEM). */
export interface SnowflakeConfig {
  account: string;
  user: string;
  privateKey: string;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

/** The `SHA256:`-prefixed base64 fingerprint of the DER-encoded (SPKI) public key derived from the private key. */
export function publicKeyFingerprint(privateKeyPem: string): string {
  const der = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(der).digest('base64')}`;
}

/** Sign a Snowflake key-pair JWT (RS256). Returns the compact JWT and its expiry (epoch seconds). */
export function signSnowflakeJwt(cfg: SnowflakeConfig, nowSec: number): { jwt: string; expSec: number } {
  // Snowflake's JWT account identifier: upper-cased, with any region/segment AFTER the first period stripped
  // (matching Snowflake's own `sql-api-generate-jwt` — a legacy locator `xy12345.us-east-1` → `XY12345`). The
  // recommended modern org-account form (`orgname-accountname`, no period) is untouched. See Known Limitations.
  const account = cfg.account.toUpperCase().replace(/\..*$/, '');
  const user = cfg.user.toUpperCase();
  const fingerprint = publicKeyFingerprint(cfg.privateKey);
  const expSec = nowSec + 3540; // ~59 minutes, under Snowflake's hard 1-hour JWT cap
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), 'utf8'));
  const claims = b64url(Buffer.from(JSON.stringify({ iss: `${account}.${user}.${fingerprint}`, sub: `${account}.${user}`, iat: nowSec, exp: expSec }), 'utf8'));
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(createPrivateKey(cfg.privateKey));
  return { jwt: `${signingInput}.${b64url(signature)}`, expSec };
}

/** A JWT provider that signs once and re-signs ~1 minute before expiry (mirrors the GCP cached-token pattern). */
export function snowflakeJwtProvider(cfg: SnowflakeConfig): SnowflakeTokenProvider {
  let cached: { jwt: string; expSec: number } | null = null;
  return async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (cached && cached.expSec - 60 > nowSec) return cached.jwt;
    cached = signSnowflakeJwt(cfg, nowSec);
    return cached.jwt;
  };
}

/** The SQL API host for an account identifier (`<account>.snowflakecomputing.com`). */
export function accountUrl(account: string): string {
  return `https://${account}.snowflakecomputing.com`;
}

/**
 * Resolve the operator's account profile from env (the vault-backed per-account wiring is documented). A user
 * whose default role has read/monitor grants (e.g. a dedicated monitoring role) is the standard discovery profile;
 * a full deployment resolves the account + user + key per-account from the vault.
 */
export function resolveSnowflakeBaseConfig(): SnowflakeConfig | null {
  const account = (process.env.NEUROPAUSE_SNOWFLAKE_ACCOUNT ?? '').trim();
  const user = (process.env.NEUROPAUSE_SNOWFLAKE_USER ?? '').trim();
  const privateKey = (process.env.NEUROPAUSE_SNOWFLAKE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();
  if (!account || !user || !privateKey) return null;
  return { account, user, privateKey };
}

/**
 * Build the host-pinned key-pair-JWT `DiscoveryHttp` for a Snowflake account, or null when unconfigured / malformed.
 * The private key is validated by signing a probe JWT once (a bad key degrades the platform unconfigured rather
 * than crashing discovery on every statement).
 */
export function makeSnowflakeHttp(gate: RateGate, _accountId: string): SnowflakeClient | null {
  const cfg = resolveSnowflakeBaseConfig();
  if (!cfg) return null;
  try {
    signSnowflakeJwt(cfg, Math.floor(Date.now() / 1000)); // fail fast on a malformed key
    return new SnowflakeClient(accountUrl(cfg.account), snowflakeJwtProvider(cfg), gate);
  } catch {
    return null;
  }
}

/** Register the Snowflake adapter into the platform registry (called once at Infrastructure Runtime init). */
export function registerSnowflakePlatform(): void {
  registerPlatform(snowflakeAdapter);
}

/** A default rate limiter for Snowflake discovery (the SQL API is metadata-light; a small spacing is plenty). */
export function snowflakeRateLimiter(): RateGate {
  return new RateLimiter(60);
}
