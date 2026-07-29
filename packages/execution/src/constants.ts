/**
 * Wave 5 constants. Isolated module (no imports).
 */
export const EXECUTION_VERSION = '0.0.0-preview.1';

/** The 22 universal connectors Wave 5 registers. */
export const CONNECTOR_IDS = [
  'github', 'gitlab', 'bitbucket', 'slack', 'microsoft-teams', 'discord', 'jira', 'linear', 'notion',
  'google-workspace', 'microsoft-365', 'gmail', 'outlook', 'google-drive', 'onedrive', 'dropbox',
  'salesforce', 'hubspot', 'zendesk', 'rest', 'graphql', 'webhooks',
] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export const AUTH_KINDS = ['oauth2', 'pat', 'api_key', 'basic', 'bearer', 'signature', 'none'] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

export const RISK_TIERS = ['low', 'medium', 'high', 'restricted'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** Execution outcomes — every one is governed and traceable. */
export const EXECUTION_OUTCOMES = ['success', 'failed', 'denied', 'rate-limited', 'circuit-open', 'awaiting-approval', 'dead-lettered'] as const;
export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];

export type PolicyEffect = 'allow' | 'deny' | 'require-approval';

/** Generic connectors that CAN be executed live against any URL (incl. a local server). */
export const GENERIC_CONNECTORS = ['rest', 'graphql', 'webhooks'] as const;
