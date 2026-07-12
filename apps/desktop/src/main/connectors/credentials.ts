/**
 * Connector credential resolution.
 *
 * OAuth client ids (and, for confidential clients, secrets) are operator-supplied
 * via environment variables — never committed and never sent to the renderer.
 * Each connector manifest names the env vars it needs; this module reads them.
 *
 * This is the deliberate seam in the framework: every connector's flow is fully
 * implemented and will run the moment its credentials are present. Until then
 * the connector reports `unavailable` with a hint naming the variable to set.
 */
import type { ConnectorManifest, OAuthEndpointConfig } from '@neuropause/shared';
import { getBakedClientId } from '../buildInfo';

export interface ResolvedCredentials {
  clientId: string;
  /** Present only for confidential clients. */
  clientSecret: string | null;
}

function readEnv(name: string): string | null {
  const raw = process.env[name];
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/** Returns the client credentials for a connector, or null if not configured. */
export function resolveCredentials(manifest: ConnectorManifest): ResolvedCredentials | null {
  const oauth = manifest.oauth;
  if (!oauth) return null;
  // Runtime env wins; packaged builds fall back to the id baked at package
  // time. Secrets have no baked fallback by design.
  const clientId = readEnv(oauth.clientIdEnv) ?? getBakedClientId(oauth.clientIdEnv);
  if (!clientId) return null;
  if (oauth.clientSecretEnv) {
    const clientSecret = readEnv(oauth.clientSecretEnv);
    // A confidential client without its secret cannot complete the token exchange.
    if (!clientSecret) return null;
    return { clientId, clientSecret };
  }
  return { clientId, clientSecret: null };
}

/**
 * P5 — the inbound webhook secret for a connector (HMAC signing secret or Microsoft `clientState`),
 * read from the env var named by the manifest. Null when the connector declares no `webhookSecretEnv`
 * or the variable is unset — in which case inbound deliveries cannot be verified and are rejected.
 */
export function resolveWebhookSecret(manifest: ConnectorManifest): string | null {
  const name = manifest.oauth?.webhookSecretEnv;
  return name ? readEnv(name) : null;
}

/** Whether a connector has everything it needs to start an auth flow. */
export function isConfigured(manifest: ConnectorManifest): boolean {
  if (manifest.authType === 'api_key') {
    // API-key connectors are "configured" once a key is supplied at connect time;
    // we treat the manifest itself as ready (the key is entered in the flow).
    return true;
  }
  return resolveCredentials(manifest) !== null;
}

/** A human hint naming the env var(s) an unconfigured connector still needs. */
export function setupHintFor(manifest: ConnectorManifest): string | null {
  const oauth: OAuthEndpointConfig | null = manifest.oauth;
  if (!oauth) return null;
  if (isConfigured(manifest)) return null;
  const vars = [oauth.clientIdEnv, ...(oauth.clientSecretEnv ? [oauth.clientSecretEnv] : [])];
  return `Set ${vars.join(' and ')} to enable ${manifest.name}.`;
}
