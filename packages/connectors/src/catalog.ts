/**
 * Connector catalog (NCEA 10.4, Phase 4). Production-ready adapter DESCRIPTORS
 * for 42 enterprise connectors + a deterministic MOCK factory that satisfies the
 * SDK for testing. NO live integrations: a real adapter implements the same
 * `ConnectorDefinition` with actual API calls and requires credentials + network.
 */
import { z } from 'zod';
import { defineConnector, type ConnectorDefinition } from './sdk';
import type { AuthType } from './auth';

export interface ConnectorDescriptor {
  id: string;
  name: string;
  category: string;
  auth: AuthType;
  capabilities: string[];
}

export const CONNECTOR_CATALOG: ConnectorDescriptor[] = [
  // AI providers
  { id: 'openai', name: 'OpenAI', category: 'ai', auth: 'api_key', capabilities: ['chat', 'embeddings'] },
  { id: 'anthropic', name: 'Anthropic', category: 'ai', auth: 'api_key', capabilities: ['chat'] },
  { id: 'google-gemini', name: 'Google Gemini', category: 'ai', auth: 'api_key', capabilities: ['chat'] },
  { id: 'azure-openai', name: 'Azure OpenAI', category: 'ai', auth: 'api_key', capabilities: ['chat', 'embeddings'] },
  { id: 'ollama', name: 'Ollama', category: 'ai', auth: 'none', capabilities: ['chat'] },
  { id: 'openrouter', name: 'OpenRouter', category: 'ai', auth: 'api_key', capabilities: ['chat'] },
  // Dev / SCM
  { id: 'github', name: 'GitHub', category: 'scm', auth: 'oauth2', capabilities: ['repos', 'issues', 'actions'] },
  { id: 'gitlab', name: 'GitLab', category: 'scm', auth: 'oauth2', capabilities: ['repos', 'issues'] },
  { id: 'bitbucket', name: 'Bitbucket', category: 'scm', auth: 'oauth2', capabilities: ['repos'] },
  // Chat
  { id: 'slack', name: 'Slack', category: 'chat', auth: 'oauth2', capabilities: ['messages', 'channels'] },
  { id: 'ms-teams', name: 'Microsoft Teams', category: 'chat', auth: 'oauth2', capabilities: ['messages'] },
  { id: 'discord', name: 'Discord', category: 'chat', auth: 'bearer', capabilities: ['messages'] },
  // Productivity / workspace
  { id: 'google-workspace', name: 'Google Workspace', category: 'productivity', auth: 'oauth2', capabilities: ['docs', 'drive'] },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'productivity', auth: 'oauth2', capabilities: ['docs', 'drive'] },
  { id: 'gmail', name: 'Gmail', category: 'email', auth: 'oauth2', capabilities: ['email'] },
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', auth: 'oauth2', capabilities: ['events'] },
  { id: 'outlook', name: 'Outlook', category: 'email', auth: 'oauth2', capabilities: ['email', 'events'] },
  { id: 'notion', name: 'Notion', category: 'productivity', auth: 'oauth2', capabilities: ['pages', 'databases'] },
  { id: 'linear', name: 'Linear', category: 'pm', auth: 'oauth2', capabilities: ['issues'] },
  { id: 'jira', name: 'Jira', category: 'pm', auth: 'oauth2', capabilities: ['issues'] },
  { id: 'confluence', name: 'Confluence', category: 'productivity', auth: 'oauth2', capabilities: ['pages'] },
  { id: 'clickup', name: 'ClickUp', category: 'pm', auth: 'api_key', capabilities: ['tasks'] },
  { id: 'asana', name: 'Asana', category: 'pm', auth: 'pat', capabilities: ['tasks'] },
  { id: 'trello', name: 'Trello', category: 'pm', auth: 'api_key', capabilities: ['cards'] },
  // CRM / support / commerce
  { id: 'salesforce', name: 'Salesforce', category: 'crm', auth: 'oauth2', capabilities: ['records'] },
  { id: 'hubspot', name: 'HubSpot', category: 'crm', auth: 'oauth2', capabilities: ['records'] },
  { id: 'zendesk', name: 'Zendesk', category: 'support', auth: 'oauth2', capabilities: ['tickets'] },
  { id: 'stripe', name: 'Stripe', category: 'payments', auth: 'api_key', capabilities: ['charges', 'webhooks'] },
  { id: 'shopify', name: 'Shopify', category: 'commerce', auth: 'oauth2', capabilities: ['orders', 'products'] },
  // Data
  { id: 'postgresql', name: 'PostgreSQL', category: 'database', auth: 'basic', capabilities: ['query'] },
  { id: 'mysql', name: 'MySQL', category: 'database', auth: 'basic', capabilities: ['query'] },
  { id: 'mongodb', name: 'MongoDB', category: 'database', auth: 'basic', capabilities: ['query'] },
  { id: 'redis', name: 'Redis', category: 'database', auth: 'basic', capabilities: ['kv'] },
  { id: 'snowflake', name: 'Snowflake', category: 'warehouse', auth: 'basic', capabilities: ['query'] },
  { id: 'bigquery', name: 'BigQuery', category: 'warehouse', auth: 'service_account', capabilities: ['query'] },
  // Storage
  { id: 's3', name: 'Amazon S3', category: 'storage', auth: 'service_account', capabilities: ['objects'] },
  { id: 'azure-blob', name: 'Azure Blob', category: 'storage', auth: 'service_account', capabilities: ['objects'] },
  { id: 'gcs', name: 'Google Cloud Storage', category: 'storage', auth: 'service_account', capabilities: ['objects'] },
  // Protocol
  { id: 'webhook', name: 'Webhook', category: 'protocol', auth: 'none', capabilities: ['emit'] },
  { id: 'rest', name: 'REST', category: 'protocol', auth: 'bearer', capabilities: ['request'] },
  { id: 'graphql', name: 'GraphQL', category: 'protocol', auth: 'bearer', capabilities: ['query'] },
  { id: 'grpc', name: 'gRPC', category: 'protocol', auth: 'bearer', capabilities: ['call'] },
];

/** Deterministic mock connector satisfying the SDK — no network. */
export function mockConnector(descriptor: ConnectorDescriptor, version = '1.0.0'): ConnectorDefinition {
  return defineConnector({
    id: descriptor.id,
    name: descriptor.name,
    version,
    category: descriptor.category,
    auth: { type: descriptor.auth },
    capabilities: descriptor.capabilities,
    permissions: [`${descriptor.id}:use`],
    actions: [
      { name: 'ping', permissions: [], schema: z.object({}), execute: async () => ({ connector: descriptor.id, ok: true }) },
      {
        name: 'invoke',
        permissions: [`${descriptor.id}:invoke`],
        schema: z.object({ op: z.string(), params: z.record(z.unknown()).optional() }),
        execute: async (input: { op: string }) => ({ connector: descriptor.id, op: input.op, mocked: true }),
      },
    ],
    health: () => ({ status: 'ok' }),
  });
}

export function catalogDescriptor(id: string): ConnectorDescriptor | undefined {
  return CONNECTOR_CATALOG.find((c) => c.id === id);
}
