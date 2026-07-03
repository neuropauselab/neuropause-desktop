/**
 * The NeuroPause Connector Framework (NCF) — shared SDK types.
 *
 * These are the typed contracts every connector is defined by and every layer
 * (main-process runtime, IPC, renderer) agrees on. The file is types-only so it
 * can be shared without pulling in environment-specific code.
 *
 * Security note: nothing in here ever carries a token, secret, or credential.
 * Access/refresh tokens live only in the main-process encrypted vault and never
 * cross into any DTO that reaches the renderer.
 */

/** A connector's stable identifier (e.g. `github`, `notion`, `google-drive`). */
export type ConnectorId = string;

/** Coarse grouping used for browsing and filtering the connector catalog. */
export type ConnectorCategory =
  | 'ai_assistant'
  | 'developer'
  | 'productivity'
  | 'design'
  | 'communication'
  | 'storage'
  | 'calendar'
  | 'automation'
  | 'project_management';

/**
 * How a connector authenticates:
 *   - `oauth2_pkce`        — public client, Authorization Code + PKCE, no secret.
 *   - `oauth2_confidential`— Authorization Code with a client secret at the token
 *                            endpoint (the secret stays in the main process).
 *   - `api_key`            — a user-supplied API token (no browser flow).
 */
export type ConnectorAuthType = 'oauth2_pkce' | 'oauth2_confidential' | 'api_key';

/**
 * The unified data domains a connector can surface. These are the seams the
 * Unified Intelligence Layer (Stage 2) reads through, so a connector declares
 * here what it is *capable* of providing.
 */
export type ConnectorCapability =
  | 'projects'
  | 'tasks'
  | 'files'
  | 'documents'
  | 'conversations'
  | 'messages'
  | 'notifications'
  | 'events'
  | 'activities'
  | 'calendar'
  | 'repositories'
  | 'issues';

/** A human-readable permission/scope the connector requests at consent time. */
export interface ConnectorScope {
  /** The provider's scope string (what is actually requested). */
  id: string;
  /** Short label for the consent UI. */
  label: string;
  /** What granting this scope allows NeuroPause to read. */
  description: string;
}

/** How the token endpoint expects the client to authenticate. */
export type TokenAuthStyle = 'body' | 'basic';

/**
 * Provider OAuth endpoint metadata. Endpoint URLs are public; the client id and
 * (for confidential clients) secret are supplied at runtime from configuration,
 * never stored here.
 */
export interface OAuthEndpointConfig {
  authorizeUrl: string;
  tokenUrl: string;
  /** Optional endpoint to revoke a token on disconnect (best-effort). */
  revokeUrl: string | null;
  /** The scope strings requested from the provider. */
  scopes: string[];
  /** Separator the provider expects between scopes (' ' or ','). */
  scopeSeparator: string;
  /** Whether PKCE (S256) is used. PKCE-capable providers need no secret. */
  usePkce: boolean;
  /** Whether the token endpoint takes client creds in the body or Basic header. */
  tokenAuthStyle: TokenAuthStyle;
  /** Extra params appended to the authorize URL (e.g. access_type=offline). */
  extraAuthParams: Record<string, string>;
  /** Extra params appended to the token request body (e.g. audience). */
  extraTokenParams: Record<string, string>;
  /**
   * Fixed callback path (e.g. '/callback') for providers that exact-match the
   * registered redirect URI path. Unset ⇒ an unguessable random path (preferred
   * where policy allows, e.g. Google native apps). The port stays random either
   * way; state + PKCE protections are unchanged.
   */
  callbackPath?: string;
  /** The config key (env var) that supplies the client id. */
  clientIdEnv: string;
  /** The config key (env var) that supplies the client secret, if confidential. */
  clientSecretEnv: string | null;
  /**
   * Fixed loopback port for the OAuth redirect. Most providers honor RFC 8252's
   * "any port" loopback rule, so this is omitted and an ephemeral port is used.
   * Providers that require an exact registered callback port (e.g. GitHub OAuth
   * Apps) pin a port here so the callback URL is deterministic.
   */
  loopbackPort?: number;
}

/** The static definition of a connector. */
export interface ConnectorManifest {
  id: ConnectorId;
  name: string;
  /** The provider/company behind the service (e.g. "OpenAI", "Atlassian"). */
  provider: string;
  description: string;
  category: ConnectorCategory;
  website: string;
  docsUrl: string;
  /** Brand accent colour (hex) for the UI. */
  brandColor: string;
  /** Connector/manifest semantic version. */
  version: string;
  authType: ConnectorAuthType;
  capabilities: ConnectorCapability[];
  scopes: ConnectorScope[];
  /** OAuth endpoint metadata; null for `api_key` connectors. */
  oauth: OAuthEndpointConfig | null;
  /** Whether multiple accounts can be connected simultaneously. */
  multiAccount: boolean;
}

/** Lifecycle state of a connector account. */
export type ConnectorStatus =
  'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'error' | 'unavailable';

/** Operational health of a connected account. */
export type ConnectorHealth = 'healthy' | 'degraded' | 'down' | 'unknown';

/** State of the most recent (or in-flight) synchronization. */
export type SyncState = 'idle' | 'syncing' | 'success' | 'error' | 'never';

/** The phases an account moves through; also used to tag logs and events. */
export type ConnectorLifecyclePhase =
  | 'connect'
  | 'authenticate'
  | 'refresh'
  | 'reconnect'
  | 'sync'
  | 'disconnect'
  | 'health_check'
  | 'error_recovery';

/**
 * A single authenticated identity for a connector. Carries everything the UI
 * needs to render an account — but never any token material.
 */
export interface ConnectedAccount {
  id: string;
  connectorId: ConnectorId;
  /** Display name or email for the connected identity. */
  label: string;
  /** The provider's stable user/account id, if known. */
  externalId: string | null;
  avatarUrl: string | null;
  status: ConnectorStatus;
  health: ConnectorHealth;
  /** Scopes actually granted by the provider. */
  grantedScopes: string[];
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncState: SyncState;
  /** Access-token expiry (ISO), for display only — not the token itself. */
  accessTokenExpiresAt: string | null;
  /** Last error message for this account, if any. */
  error: string | null;
}

/**
 * The renderer-facing view of a connector: its public manifest fields plus live
 * runtime state. No endpoint secrets, no tokens.
 */
export interface ConnectorDto {
  id: ConnectorId;
  name: string;
  provider: string;
  description: string;
  category: ConnectorCategory;
  website: string;
  docsUrl: string;
  brandColor: string;
  version: string;
  authType: ConnectorAuthType;
  capabilities: ConnectorCapability[];
  scopes: ConnectorScope[];
  multiAccount: boolean;
  /** Whether the required client credentials are present in configuration. */
  configured: boolean;
  /** Aggregate status across accounts (or `unavailable` when unconfigured). */
  status: ConnectorStatus;
  /** Aggregate health across accounts. */
  health: ConnectorHealth;
  accounts: ConnectedAccount[];
  /** Most recent successful sync across accounts. */
  lastSyncAt: string | null;
  /** When unconfigured, a hint telling the operator which credential to set. */
  setupHint: string | null;
}

/** A connector log line, surfaced in the Connectors UI. */
export interface ConnectorLogEntry {
  id: string;
  connectorId: ConnectorId;
  accountId: string | null;
  level: 'info' | 'warn' | 'error';
  phase: ConnectorLifecyclePhase;
  message: string;
  at: string;
}

/** A live connector event, broadcast to the renderer. */
export interface ConnectorEvent {
  connectorId: ConnectorId;
  accountId: string | null;
  type: 'status' | 'health' | 'sync' | 'log' | 'account_added' | 'account_removed';
  status: ConnectorStatus | null;
  health: ConnectorHealth | null;
  syncState: SyncState | null;
  message: string | null;
  at: string;
}

/** Result of a connect/reconnect attempt. */
export interface ConnectorConnectResult {
  ok: boolean;
  connectorId: ConnectorId;
  account: ConnectedAccount | null;
  message: string | null;
}

/** Result of a simple connector action (disconnect, refresh, sync, …). */
export interface ConnectorActionResult {
  ok: boolean;
  message: string | null;
}

/** Aggregate counts for the connector dashboard. */
export interface ConnectorStats {
  /** Total connectors in the registry. */
  total: number;
  /** Connectors with client credentials configured. */
  configured: number;
  /** Connectors with at least one connected account. */
  connected: number;
  /** Total connected accounts across all connectors. */
  accounts: number;
  healthy: number;
  degraded: number;
  down: number;
  byCategory: Record<string, number>;
}

/**
 * A point-in-time view of one account's sync health, surfaced to the Connector
 * Health Dashboard. Produced by the sync engine; safe to expose over IPC.
 */
export interface ConnectorSyncSnapshot {
  connectorId: ConnectorId;
  accountId: string;
  status: 'idle' | 'syncing' | 'success' | 'error' | 'rate_limited' | 'offline';
  lastSyncAt: string | null;
  lastDurationMs: number | null;
  nextSyncAt: string | null;
  entityCount: number;
  lastError: string | null;
  consecutiveFailures: number;
  rateLimitedUntil: string | null;
  queueSize: number;
}
