/**
 * The HS256 signing secret for API access tokens (P3.0, Increment 3).
 *
 * Generated once (48 random bytes) and persisted under Electron's userData with 0600
 * perms — never hardcoded, never shipped. Loaded at ecosystem boot so the gateway's
 * synchronous request path can read it. Electron-only; tests use the pure jwt/token
 * modules with an injected secret instead.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import { createLogger } from '../../logger';

const log = createLogger('api-signing-secret');
let cached: string | null = null;

function secretPath(): string {
  return join(app.getPath('userData'), 'api-signing-secret');
}

/** Get-or-create the persisted signing secret. Idempotent; cached after first call. */
export async function loadSigningSecret(): Promise<string> {
  if (cached) return cached;
  const path = secretPath();
  try {
    const existing = (await fs.readFile(path, 'utf8')).trim();
    if (existing.length >= 32) {
      cached = existing;
      return existing;
    }
  } catch {
    // first run — create it below
  }
  const secret = randomBytes(48).toString('base64url');
  try {
    await fs.writeFile(path, secret, { mode: 0o600 });
  } catch (err) {
    log.error('Failed to persist API signing secret', { error: String(err) });
  }
  cached = secret;
  return secret;
}

/** Synchronous accessor — valid only after {@link loadSigningSecret} has run at boot. */
export function signingSecret(): string {
  if (!cached) throw new Error('API signing secret not loaded');
  return cached;
}
