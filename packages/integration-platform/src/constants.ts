/**
 * Sprint 3 constants. Isolated module (no imports). Includes the full adapter catalog: every
 * external system is REPRESENTED here and stays adapter-verified until configured and verified.
 */
export const INTEGRATION_VERSION = '0.0.0-preview.1';

/** The one honest answer integration analytics gives when no real data exists. */
export const NO_INTEGRATION_DATA = 'No integration data available';

/** EPIC 1 — integration lifecycle. 'active' requires configuration AND verification, never claimed. */
export const INTEGRATION_STATUS = ['registered', 'configured', 'verified', 'active', 'failed', 'disabled'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUS)[number];

/** EPIC 2 — API gateway protocols. */
export const API_PROTOCOLS = ['rest', 'graphql', 'grpc', 'soap', 'websocket', 'webhook', 'event-stream'] as const;
export type ApiProtocol = (typeof API_PROTOCOLS)[number];

/** EPIC 16 — transformation formats. */
export const TRANSFORM_FORMATS = ['json', 'xml', 'csv', 'yaml', 'parquet'] as const;
export type TransformFormat = (typeof TRANSFORM_FORMATS)[number];

/** EPIC 15 — synchronization modes. */
export const SYNC_MODES = ['incremental', 'full'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

/** EPIC 9 — message broker kinds. */
export const BROKER_KINDS = ['kafka', 'rabbitmq', 'nats', 'mqtt', 'redis-streams'] as const;
export type BrokerKind = (typeof BROKER_KINDS)[number];

/** EPIC 3 — enterprise identity providers (reused from Sprint 2). */
export const IDENTITY_SYSTEMS = ['Microsoft Entra ID', 'Google Workspace', 'Okta', 'Active Directory', 'LDAP', 'SCIM'] as const;

/** Adapter framework category. */
export type FrameworkCategory = 'erp' | 'crm' | 'collaboration' | 'storage' | 'database' | 'hr' | 'finance' | 'manufacturing' | 'healthcare' | 'ai';

export interface FrameworkConfig {
  category: FrameworkCategory;
  epic: string;
  systems: string[];
  entities: string[];
  guard?: string;
}

/** EPICs 4–14 — the reusable adapter frameworks. Every system is represented, never contacted. */
export const FRAMEWORKS: FrameworkConfig[] = [
  { category: 'erp', epic: 'E4', systems: ['SAP S/4HANA', 'Oracle ERP Cloud', 'Microsoft Dynamics 365', 'Oracle NetSuite', 'Odoo', 'ERPNext'], entities: ['customers', 'vendors', 'inventory', 'purchase-orders', 'sales-orders', 'finance', 'manufacturing'] },
  { category: 'crm', epic: 'E5', systems: ['Salesforce', 'HubSpot', 'Zoho CRM', 'Microsoft Dynamics CRM'], entities: ['leads', 'accounts', 'contacts', 'opportunities', 'cases', 'activities'] },
  { category: 'collaboration', epic: 'E6', systems: ['Microsoft 365', 'Google Workspace', 'Slack', 'Microsoft Teams', 'Zoom', 'Google Meet'], entities: ['calendar', 'mail', 'contacts', 'meetings', 'chat', 'presence'] },
  { category: 'storage', epic: 'E7', systems: ['SharePoint', 'OneDrive', 'Google Drive', 'Dropbox', 'Box', 'Amazon S3', 'Azure Blob', 'MinIO'], entities: ['files', 'folders', 'shares'] },
  { category: 'database', epic: 'E8', systems: ['PostgreSQL', 'MySQL', 'MariaDB', 'SQL Server', 'Oracle Database', 'MongoDB', 'Elasticsearch'], entities: ['tables', 'documents', 'indices'] },
  { category: 'hr', epic: 'E10', systems: ['Workday', 'BambooHR', 'SAP SuccessFactors', 'ADP'], entities: ['employees', 'departments', 'payroll-references', 'organization-structure'] },
  { category: 'finance', epic: 'E11', systems: ['Stripe', 'Razorpay', 'QuickBooks', 'Xero'], entities: ['invoices', 'payment-references', 'ledger-references'], guard: 'adapters only — NEVER processes a real payment' },
  { category: 'manufacturing', epic: 'E12', systems: ['MES', 'SCADA', 'PLC Gateway', 'OPC-UA'], entities: ['work-orders', 'machines', 'telemetry-tags'], guard: 'represented only — NEVER operates industrial equipment' },
  { category: 'healthcare', epic: 'E13', systems: ['HL7', 'FHIR', 'DICOM', 'Epic', 'Oracle Health'], entities: ['patients', 'encounters', 'observations', 'imaging-studies'], guard: 'represented only — NEVER fabricates patient records or accesses live medical records' },
  { category: 'ai', epic: 'E14', systems: ['OpenAI', 'Anthropic', 'Google Gemini', 'Azure OpenAI', 'Ollama', 'vLLM', 'Hugging Face'], entities: ['models', 'completions', 'embeddings'], guard: 'reuses the existing AI runtime; providers represented until configured' },
];

/** EPIC 22 — the named adapters tracked in the evidence matrix (a representative subset). */
export const MATRIX_ADAPTERS = ['SAP', 'Oracle', 'Dynamics', 'NetSuite', 'Salesforce', 'HubSpot', 'Microsoft 365', 'Google Workspace', 'Slack', 'Teams', 'Stripe', 'Epic', 'Oracle Health', 'Kafka', 'RabbitMQ', 'OpenAI', 'Anthropic', 'Gemini'] as const;

/** Capabilities that require the customer's own infrastructure — represented until provided. */
export const INFRASTRUCTURE_PENDING_CAPS = ['customer-apis', 'customer-credentials', 'vpn-private-network', 'customer-message-brokers', 'customer-databases'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
