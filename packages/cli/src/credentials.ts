/**
 * CLI credential storage. `login` persists a bearer credential (an API key or an
 * OAuth client-credentials access token) so later invocations authenticate without
 * environment variables. The real store writes `~/.neuropause/credentials.json`
 * with owner-only permissions; the decode/summary helpers are pure so `whoami`
 * (and its tests) never touch the filesystem or the clock.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AccessTokenClaims } from '@neuropause/shared';

export type StoredCredentialKind = 'api_key' | 'access_token';

export interface StoredCredentials {
  kind: StoredCredentialKind;
  /** The bearer value handed to the client as `apiKey` (key secret or access token). */
  token: string;
  /** Gateway base URL captured at login, if the user overrode the default. */
  baseUrl?: string;
  /** Granted scopes (space-delimited) for an access token. */
  scope?: string;
  /** Epoch ms when an access token expires. */
  expiresAt?: number;
  savedAt: string;
}

export interface CredentialStore {
  /** Absolute path of the credential file (shown by `logout`/`whoami`). */
  readonly location: string;
  load(): Promise<StoredCredentials | null>;
  save(creds: StoredCredentials): Promise<void>;
  /** Remove the stored credential; resolves false when there was nothing to remove. */
  clear(): Promise<boolean>;
}

/** The real, filesystem-backed store — owner-only dir (0700) + file (0600). */
export function createFileCredentialStore(baseDir: string = join(homedir(), '.neuropause')): CredentialStore {
  const location = join(baseDir, 'credentials.json');
  return {
    location,
    async load(): Promise<StoredCredentials | null> {
      try {
        return JSON.parse(await fs.readFile(location, 'utf8')) as StoredCredentials;
      } catch {
        return null;
      }
    },
    async save(creds: StoredCredentials): Promise<void> {
      await fs.mkdir(baseDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(location, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
      await fs.chmod(location, 0o600).catch(() => undefined);
    },
    async clear(): Promise<boolean> {
      try {
        await fs.unlink(location);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Decode a JWT payload for display only — never trusted for authorization. */
export function decodeTokenClaims(token: string): Partial<AccessTokenClaims> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json) as Partial<AccessTokenClaims>;
  } catch {
    return null;
  }
}

/** Mask a secret for terminal output, keeping only enough to recognise it. */
export function maskSecret(secret: string): string {
  return secret.length <= 8 ? '****' : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** A safe, human-facing description of the stored credential (no secret leaked). */
export function describeCredentials(creds: StoredCredentials, nowMs: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: creds.kind,
    token: maskSecret(creds.token),
    baseUrl: creds.baseUrl ?? '(default)',
    savedAt: creds.savedAt,
  };
  if (creds.kind === 'access_token') {
    const claims = decodeTokenClaims(creds.token);
    if (claims) {
      if (claims.sub) out.developerId = claims.sub;
      if (claims.org) out.tenant = claims.org;
      if (claims.scopes) out.scopes = claims.scopes;
      if (typeof claims.exp === 'number') {
        out.expiresAt = new Date(claims.exp * 1000).toISOString();
        out.expired = claims.exp * 1000 <= nowMs;
      }
    }
  }
  return out;
}
