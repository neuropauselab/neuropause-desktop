/**
 * @neuropause/connectivity — Wave 2 constants. Isolated module (no imports) so the
 * version const never creates an index↔platform cycle.
 */
export const CONNECTIVITY_VERSION = '0.0.0-preview.1';

/** The seven provider connectors Wave 2 ships (Modules 4–10). */
export const CONNECTOR_IDS = ['github', 'gmail', 'google-calendar', 'slack', 'jira', 'notion', 'postgresql'] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

/** Module 1 — the connector lifecycle states. */
export const LIFECYCLE_STATES = ['installed', 'connected', 'disconnected', 'expired', 'disabled', 'error', 'healthy'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Module 2 — credential kinds stored (encrypted) in the vault. */
export const CREDENTIAL_KINDS = ['oauth', 'refresh', 'pat', 'api_key', 'secret'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** Module 3 — synchronization triggers/modes. */
export const SYNC_MODES = ['full', 'incremental', 'webhook', 'scheduled', 'manual'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];
