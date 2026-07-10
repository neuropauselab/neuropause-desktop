/**
 * Enterprise Integration — Credential lifecycle (Phase P2.1 foundation, Part 2).
 *
 * The secrets themselves are already stored, encrypted at rest, by NCF's `connectorVault` (Electron
 * safeStorage, per connector/account, never plaintext) — this module does NOT re-implement storage. It
 * models the credential METADATA (kind, expiry, scopes, rotation) and the pure lifecycle LOGIC the vault
 * lacks: expiry tracking, rotation scheduling, validation, auth-state classification, and safe redaction.
 * It never holds a secret value; `credentialsFromTokens` projects metadata out of the vault's `AccountTokens`
 * shape without copying the token strings. Pure + deterministic (clock injected).
 */
import type { IntegrationAuthKind } from './integrationSdk';

/** The kinds of credential the manager tracks. */
export type IntegrationCredentialKind =
  | 'oauth_access'
  | 'oauth_refresh'
  | 'api_key'
  | 'client_secret'
  | 'certificate';

/** Metadata about a stored credential. NEVER contains the secret value. */
export interface IntegrationCredentialMeta {
  kind: IntegrationCredentialKind;
  connectorId: string;
  accountId: string;
  /** Epoch ms the credential expires, or null if it does not expire (e.g. an API key). */
  expiresAt: number | null;
  /** Epoch ms the credential was issued, or null if unknown. */
  issuedAt: number | null;
  scopes: string[];
  /** How often the credential should be rotated, or null if no rotation policy. */
  rotationIntervalMs: number | null;
  /** Epoch ms of the last rotation, or null. */
  lastRotatedAt: number | null;
  /** A non-reversible id for the credential (never the secret). Optional. */
  fingerprint: string | null;
}

export type IntegrationAuthState = 'authorized' | 'expiring' | 'reauth_required' | 'unknown';

/** Default skew: treat a credential expiring within 60s as needing refresh (matches NCF REFRESH_SKEW_MS). */
export const DEFAULT_CREDENTIAL_SKEW_MS = 60_000;

/** Whether the credential is expired as of `nowMs`. Non-expiring credentials are never expired. */
export function isCredentialExpired(meta: IntegrationCredentialMeta, nowMs: number): boolean {
  return meta.expiresAt !== null && meta.expiresAt <= nowMs;
}

/** Milliseconds until expiry (negative if already expired), or null for non-expiring credentials. */
export function credentialExpiresInMs(
  meta: IntegrationCredentialMeta,
  nowMs: number,
): number | null {
  return meta.expiresAt === null ? null : meta.expiresAt - nowMs;
}

/** Whether the credential is due for rotation as of `nowMs`. */
export function credentialNeedsRotation(
  meta: IntegrationCredentialMeta,
  nowMs: number,
): boolean {
  if (meta.rotationIntervalMs === null || meta.rotationIntervalMs <= 0) return false;
  const since = meta.lastRotatedAt ?? meta.issuedAt;
  if (since === null) return true; // never rotated and a policy exists → due
  return nowMs - since >= meta.rotationIntervalMs;
}

/** Classify the auth state from expiry + skew. Deterministic. */
export function credentialAuthState(
  meta: IntegrationCredentialMeta,
  nowMs: number,
  skewMs: number = DEFAULT_CREDENTIAL_SKEW_MS,
): IntegrationAuthState {
  if (meta.expiresAt === null) return 'authorized'; // non-expiring (api key / certificate w/o expiry)
  const remaining = meta.expiresAt - nowMs;
  if (remaining <= 0) return 'reauth_required';
  if (remaining <= skewMs) return 'expiring';
  return 'authorized';
}

export interface CredentialValidation {
  ok: boolean;
  errors: string[];
}

/** Deterministically validate credential metadata. Pure. */
export function validateCredentialMeta(meta: IntegrationCredentialMeta): CredentialValidation {
  const errors: string[] = [];
  if (!meta.connectorId || !meta.connectorId.trim()) errors.push('connectorId is required');
  if (!meta.accountId || !meta.accountId.trim()) errors.push('accountId is required');
  if (meta.expiresAt !== null && !Number.isFinite(meta.expiresAt)) errors.push('expiresAt must be a number or null');
  if (meta.rotationIntervalMs !== null && meta.rotationIntervalMs <= 0) {
    errors.push('rotationIntervalMs must be > 0 or null');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Mask a secret for display/logging. NEVER returns the plaintext. Keeps at most the last 4 characters of a
 * sufficiently long value; short values are fully masked. Deterministic.
 */
export function redactSecret(value: string | null | undefined): string {
  if (!value) return '••••';
  if (value.length <= 8) return '••••';
  return `••••${value.slice(-4)}`;
}

/** The vault's stored-token shape (structurally mirrors NCF `AccountTokens`; not imported to keep shared pure). */
export interface VaultAccountTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  tokenType: string;
}

/**
 * Project credential METADATA out of a vault token record without copying any secret value. Returns one
 * meta per present credential (access + optional refresh). Reuses the existing NCF token model.
 */
export function credentialsFromTokens(
  connectorId: string,
  accountId: string,
  tokens: VaultAccountTokens,
  opts: { issuedAt?: number | null; rotationIntervalMs?: number | null } = {},
): IntegrationCredentialMeta[] {
  const issuedAt = opts.issuedAt ?? null;
  const rotationIntervalMs = opts.rotationIntervalMs ?? null;
  const out: IntegrationCredentialMeta[] = [
    {
      kind: 'oauth_access',
      connectorId,
      accountId,
      expiresAt: tokens.expiresAt,
      issuedAt,
      scopes: tokens.scopes.slice(),
      rotationIntervalMs,
      lastRotatedAt: null,
      fingerprint: null,
    },
  ];
  if (tokens.refreshToken) {
    out.push({
      kind: 'oauth_refresh',
      connectorId,
      accountId,
      expiresAt: null, // refresh tokens typically don't carry an expiry in the token response
      issuedAt,
      scopes: tokens.scopes.slice(),
      rotationIntervalMs,
      lastRotatedAt: null,
      fingerprint: null,
    });
  }
  return out;
}

/** Map a credential kind to the auth kind it belongs to, for display grouping. */
export function credentialAuthKind(kind: IntegrationCredentialKind): IntegrationAuthKind {
  switch (kind) {
    case 'api_key':
      return 'api_key';
    case 'client_secret':
      return 'client_secret';
    case 'certificate':
      return 'certificate';
    case 'oauth_access':
    case 'oauth_refresh':
    default:
      return 'oauth2_pkce';
  }
}
