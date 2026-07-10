/**
 * Enterprise Integration — Developer SDK (Phase P2.1 foundation).
 *
 * This is the reusable, strongly-typed CONTRACT layer every future enterprise connector plugs into. It does
 * NOT replace the existing NeuroPause Connector Framework (NCF: `connectors/*`, `unified/sync/*`) — it
 * FORMALIZES and EXTENDS it. The concrete sync surface (`ConnectorAdapter`/`AdapterResource`) and the
 * canonical record shape (`UnifiedEntity`) already exist and are reused verbatim; this module adds the
 * provider-interface vocabulary the foundation standardizes on (authenticator, sync, webhook, health,
 * capability, event) plus the shared sync-mode / auth-kind / object vocabulary the manifest + runtime + UI
 * agree on. Everything here is types + tiny pure guards — no I/O, no connector-specific code.
 */
import type { UnifiedEntityKind } from './unified';

/* ── shared vocabulary ─────────────────────────────────────────────────────────────── */

/** The sync strategies the universal pipeline understands. */
export type IntegrationSyncMode =
  | 'full'
  | 'incremental'
  | 'delta'
  | 'webhook'
  | 'manual'
  | 'scheduled';

export const INTEGRATION_SYNC_MODES: readonly IntegrationSyncMode[] = [
  'full',
  'incremental',
  'delta',
  'webhook',
  'manual',
  'scheduled',
];

/**
 * Authentication kinds the foundation supports. A superset of NCF's `ConnectorAuthType`
 * ('oauth2_pkce' | 'oauth2_confidential' | 'api_key') that additionally names the enterprise credential
 * kinds (client secret, certificate) the Credential Manager tracks.
 */
export type IntegrationAuthKind =
  | 'oauth2_pkce'
  | 'oauth2_confidential'
  | 'api_key'
  | 'client_secret'
  | 'certificate';

export const INTEGRATION_AUTH_KINDS: readonly IntegrationAuthKind[] = [
  'oauth2_pkce',
  'oauth2_confidential',
  'api_key',
  'client_secret',
  'certificate',
];

/** A capability a connector advertises (coarse-grained feature surface). */
export type IntegrationCapabilityKind =
  | 'directory'
  | 'identity'
  | 'files'
  | 'messaging'
  | 'calendar'
  | 'tickets'
  | 'projects'
  | 'crm'
  | 'finance'
  | 'devops'
  | 'webhooks'
  | 'audit';

/** A provider object the connector can sync, mapped into the Unified Data Model. */
export interface IntegrationObjectDescriptor {
  /** Provider object id, e.g. 'user', 'group', 'file'. Stable + unique within a connector. */
  id: string;
  label: string;
  /** Which UDM kind this object materializes as. */
  kind: UnifiedEntityKind;
  /** The sync modes valid for this object. */
  syncModes: IntegrationSyncMode[];
}

/** A cooperative cancellation signal handed to long-running provider work (impl uses AbortController). */
export interface IntegrationCancellationSignal {
  readonly cancelled: boolean;
  /** Throw a cancellation error if already cancelled; a no-op otherwise. */
  throwIfCancelled(): void;
}

/* ── provider interfaces (the Developer SDK) ───────────────────────────────────────── */

/** Ambient context passed to provider calls. `now` is injected (never a clock read) for determinism. */
export interface IntegrationContext {
  connectorId: string;
  accountId: string;
  /** ISO timestamp injected by the runtime. */
  now: string;
  signal?: IntegrationCancellationSignal;
}

/** Reference to a stored credential — NEVER the secret value itself (secrets live only in the vault). */
export interface IntegrationCredentialRef {
  connectorId: string;
  accountId: string;
  kind: IntegrationAuthKind;
  expiresAt: number | null;
  scopes: string[];
}

/** Handles the authentication lifecycle. Concrete impls reuse NCF's oauthEngine + connectorVault. */
export interface IntegrationAuthenticator {
  authKind: IntegrationAuthKind;
  /** Begin/complete authentication, returning a credential reference (not the secret). */
  authenticate(ctx: IntegrationContext): Promise<IntegrationCredentialRef>;
  /** Refresh an access credential if the auth kind supports it. */
  refresh?(ctx: IntegrationContext): Promise<IntegrationCredentialRef>;
  /** Revoke/disconnect. Must never throw on a best-effort revoke. */
  revoke?(ctx: IntegrationContext): Promise<void>;
}

/** One syncable resource; formalizes NCF's `AdapterResource`. */
export interface IntegrationSyncResource {
  id: string;
  label: string;
  kind: UnifiedEntityKind;
  modes: IntegrationSyncMode[];
}

/** The sync surface. In NCF this is realized by a `ConnectorAdapter`; the foundation names the contract. */
export interface IntegrationSyncProvider {
  connectorId: string;
  resources: IntegrationSyncResource[];
}

/** Inbound webhook handling. There is no local receiver in NCF today — this is the contract for when one lands. */
export interface IntegrationWebhookProvider {
  events: string[];
  /** Verify a delivery's signature/authenticity. Pure over (payload, headers, secretRef). */
  verify(payload: string, headers: Record<string, string>): boolean;
  /** Parse a verified delivery into normalized integration events. */
  parse(payload: string): IntegrationEvent[];
}

/** A normalized event surfaced by a connector (webhook, poll delta, or lifecycle). */
export interface IntegrationEvent {
  connectorId: string;
  accountId: string;
  type: string;
  objectId: string | null;
  at: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/** Live-health probe surface for a connector. */
export interface IntegrationHealthProvider {
  check(ctx: IntegrationContext): Promise<{ ok: boolean; latencyMs: number | null; detail?: string }>;
}

/** Declares what a connector can do + which objects it exposes. */
export interface IntegrationCapabilityProvider {
  capabilities(): IntegrationCapabilityKind[];
  supportedObjects(): IntegrationObjectDescriptor[];
}

/** Event subscription surface (deltas / change streams). */
export interface IntegrationEventProvider {
  subscribe(handler: (event: IntegrationEvent) => void): () => void;
}

/** The full connector contract: an enterprise connector composes these providers. Plugin-ready. */
export interface IntegrationConnector {
  manifestId: string;
  authenticator: IntegrationAuthenticator;
  capabilities: IntegrationCapabilityProvider;
  sync?: IntegrationSyncProvider;
  webhook?: IntegrationWebhookProvider;
  health?: IntegrationHealthProvider;
  events?: IntegrationEventProvider;
}

/* ── tiny pure guards/helpers ──────────────────────────────────────────────────────── */

export function isIntegrationSyncMode(value: string): value is IntegrationSyncMode {
  return (INTEGRATION_SYNC_MODES as readonly string[]).includes(value);
}

export function isIntegrationAuthKind(value: string): value is IntegrationAuthKind {
  return (INTEGRATION_AUTH_KINDS as readonly string[]).includes(value);
}

/** Whether an auth kind is an OAuth flow (vs. api key / client secret / certificate). */
export function isOAuthKind(kind: IntegrationAuthKind): boolean {
  return kind === 'oauth2_pkce' || kind === 'oauth2_confidential';
}
