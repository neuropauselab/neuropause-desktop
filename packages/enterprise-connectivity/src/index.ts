/**
 * @neuropause/enterprise-connectivity — NeuroPause Enterprise Management System, Launch Workstream 3:
 * Enterprise Integrations & AI Connectivity.
 *
 * An additive package that composes Waves 1-14, Sprints 1-6, and Launch Workstreams 1-2, unchanged,
 * into a governed enterprise-connectivity control plane: an enterprise connector runtime, identity
 * federation, connector catalogs (productivity/ERP/CRM/storage/communication), an AI provider platform,
 * a synchronization engine, data mapping, AI workspace context, enterprise search, monitoring, and
 * governance. The connector runtime/registry, identity federation, data mapping, sync engine, AI
 * routing, AI provider registry, workspace context, search engine, monitoring, and governance are LIVE-
 * VERIFIED in-process; Microsoft 365/Google Workspace/Slack/Teams/Salesforce/SAP/OpenAI/Anthropic/
 * Gemini/Azure OpenAI/Google Drive/OneDrive (and more) are ADAPTER-VERIFIED; customer records/ERP/CRM/
 * email/calendar data, file metadata, and AI usage are BUSINESS-DATA-PENDING; and enterprise OAuth
 * credentials, customer APIs, production webhooks, and enterprise tenant connections are INFRASTRUCTURE-
 * PENDING. No successful customer sync, live OAuth, production API traffic, customer data, or external
 * AI usage is ever claimed. Every operation is audited on the one chain with a replay id.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './connectorRuntime';
export * from './identityFederation';
export * from './connectorCatalog';
export * from './aiProviders';
export * from './synchronization';
export * from './dataMapping';
export * from './workspaceContext';
export * from './search';
export * from './monitoring';
export * from './sdk';
export * from './evidence';
export * from './platform';
