/**
 * Launch Workstream 3 constants. Isolated module (no imports). Enumerates connector categories +
 * systems, connector lifecycle, identity providers + SSO protocols, AI providers, sync modes, workspace
 * context sources, and search scopes — plus the catalog of EXTERNAL systems that stay adapter-verified
 * until configured, and the customer infrastructure that stays infrastructure-pending until it exists.
 *
 * HONESTY: this package is the connectivity CONTROL PLANE (software). It NEVER claims a successful
 * synchronization with a customer system, live OAuth authorization, production API traffic, customer
 * enterprise data, or external AI usage — those are represented until real credentials + connections
 * are configured and verified.
 */
export const EC_VERSION = '1.0.0-rc.1';

/** The one honest answer connectivity analytics gives when no real enterprise data exists. */
export const NO_ENTERPRISE_DATA = 'No enterprise data available';

/** EPIC 1 — connector categories. */
export const CONNECTOR_CATEGORIES = ['productivity', 'erp', 'crm', 'storage', 'communication'] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

/** EPIC 1 — connector lifecycle. 'active' requires configuration AND verification — never assumed. */
export const CONNECTOR_STATUS = ['registered', 'configured', 'verified', 'active', 'failed', 'disabled'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUS)[number];

/** EPIC 2 — identity providers (represented until configured). */
export const IDP_PROVIDERS = ['Microsoft Entra ID', 'Google Workspace', 'Okta', 'Auth0'] as const;
export type IdpProvider = (typeof IDP_PROVIDERS)[number];

/** EPIC 2 — federation protocols. */
export const SSO_PROTOCOLS = ['sso', 'oauth2', 'oidc', 'scim'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

/** EPICs 3-7 — the systems + entities each connector category represents. */
export interface CategorySpec {
  systems: string[];
  entities: string[];
  guard?: string;
}
export const CONNECTOR_SYSTEMS: Record<ConnectorCategory, CategorySpec> = {
  productivity: { systems: ['Microsoft 365', 'Google Workspace', 'Slack', 'Microsoft Teams', 'Zoom', 'Notion'], entities: ['calendar', 'email', 'file-metadata', 'team-directory', 'presence'] },
  erp: { systems: ['SAP', 'Oracle ERP', 'Microsoft Dynamics 365', 'Odoo'], entities: ['customers', 'orders', 'inventory-metadata', 'finance-metadata', 'procurement-metadata'] },
  crm: { systems: ['Salesforce', 'HubSpot', 'Zoho CRM', 'Microsoft Dynamics CRM'], entities: ['accounts', 'contacts', 'opportunities', 'activities', 'sales-pipeline'] },
  storage: { systems: ['Google Drive', 'OneDrive', 'SharePoint', 'Dropbox', 'Box', 'Amazon S3'], entities: ['file-registry', 'metadata', 'permissions', 'versions'] },
  communication: { systems: ['Gmail', 'Outlook', 'Exchange', 'Twilio'], entities: ['messages', 'notifications', 'email-metadata', 'sms-metadata'], guard: 'metadata only — no message body is read or fabricated' },
};

/** EPIC 8 — AI providers. */
export const AI_PROVIDERS = ['OpenAI', 'Anthropic', 'Google Gemini', 'Azure OpenAI', 'Ollama', 'Mistral'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** EPIC 9 — synchronization modes. */
export const SYNC_MODES = ['incremental', 'full'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

/** EPIC 11 — workspace context sources. Context is assembled ONLY from configured connectors. */
export const CONTEXT_SOURCES = ['crm', 'erp', 'calendar', 'email', 'files', 'tasks'] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

/** EPIC 12 — enterprise search scopes. */
export const SEARCH_SCOPES = ['unified', 'cross-system', 'metadata', 'connector'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** The named external systems tracked as rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['Microsoft 365', 'Google Workspace', 'Slack', 'Teams', 'Salesforce', 'SAP', 'OpenAI', 'Anthropic', 'Gemini', 'Azure OpenAI', 'Google Drive', 'OneDrive'] as const;

/** Capabilities that require real enterprise credentials/infrastructure — represented until they exist. */
export const INFRASTRUCTURE_PENDING_CAPS = ['enterprise-oauth-credentials', 'customer-apis', 'production-webhooks', 'enterprise-tenant-connections'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
