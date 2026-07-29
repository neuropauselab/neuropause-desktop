/**
 * Module 1 (part) — the 22 universal connector descriptors. Real base URLs, real auth
 * kinds, and real operation request specs. SaaS connectors are ADAPTER-VERIFIED — their
 * request construction and response mapping are exercised against simulated responses
 * through the transport seam; live execution needs operator OAuth + network (infra-pending).
 * The generic `rest` / `graphql` / `webhooks` connectors are LIVE-VERIFIED — they execute
 * against any URL, including the local server the validation suite spins up.
 */
import type { ConnectorDescriptor, OperationSpec } from './types';

const op = (name: string, method: string, path: string, mutating = false, riskTier?: OperationSpec['riskTier']): OperationSpec => ({ name, method, path, mutating, ...(riskTier ? { riskTier } : {}) });

export const UNIVERSAL_CONNECTORS: ConnectorDescriptor[] = [
  { id: 'github', name: 'GitHub', category: 'vcs', auth: 'oauth2', baseUrl: 'https://api.github.com', evidence: 'adapter-verified', operations: [op('list-repos', 'GET', '/user/repos'), op('get-repo', 'GET', '/repos/{owner}/{repo}'), op('create-issue', 'POST', '/repos/{owner}/{repo}/issues', true, 'medium')] },
  { id: 'gitlab', name: 'GitLab', category: 'vcs', auth: 'oauth2', baseUrl: 'https://gitlab.com/api/v4', evidence: 'adapter-verified', operations: [op('list-projects', 'GET', '/projects'), op('create-issue', 'POST', '/projects/{id}/issues', true, 'medium')] },
  { id: 'bitbucket', name: 'Bitbucket', category: 'vcs', auth: 'oauth2', baseUrl: 'https://api.bitbucket.org/2.0', evidence: 'adapter-verified', operations: [op('list-repos', 'GET', '/repositories/{workspace}')] },
  { id: 'slack', name: 'Slack', category: 'chat', auth: 'oauth2', baseUrl: 'https://slack.com/api', evidence: 'adapter-verified', operations: [op('list-channels', 'GET', '/conversations.list'), op('post-message', 'POST', '/chat.postMessage', true, 'medium')] },
  { id: 'microsoft-teams', name: 'Microsoft Teams', category: 'chat', auth: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', evidence: 'adapter-verified', operations: [op('list-teams', 'GET', '/me/joinedTeams'), op('send-message', 'POST', '/teams/{team}/channels/{channel}/messages', true, 'medium')] },
  { id: 'discord', name: 'Discord', category: 'chat', auth: 'bearer', baseUrl: 'https://discord.com/api/v10', evidence: 'adapter-verified', operations: [op('list-guilds', 'GET', '/users/@me/guilds'), op('create-message', 'POST', '/channels/{channel}/messages', true, 'medium')] },
  { id: 'jira', name: 'Jira', category: 'project', auth: 'oauth2', baseUrl: 'https://api.atlassian.com', evidence: 'adapter-verified', operations: [op('search', 'GET', '/rest/api/3/search'), op('create-issue', 'POST', '/rest/api/3/issue', true, 'medium')] },
  { id: 'linear', name: 'Linear', category: 'project', auth: 'api_key', baseUrl: 'https://api.linear.app', evidence: 'adapter-verified', operations: [op('graphql', 'POST', '/graphql', true)] },
  { id: 'notion', name: 'Notion', category: 'docs', auth: 'oauth2', baseUrl: 'https://api.notion.com/v1', evidence: 'adapter-verified', operations: [op('search', 'POST', '/search'), op('create-page', 'POST', '/pages', true, 'medium')] },
  { id: 'google-workspace', name: 'Google Workspace', category: 'suite', auth: 'oauth2', baseUrl: 'https://www.googleapis.com', evidence: 'adapter-verified', operations: [op('list-users', 'GET', '/admin/directory/v1/users')] },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'suite', auth: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', evidence: 'adapter-verified', operations: [op('me', 'GET', '/me')] },
  { id: 'gmail', name: 'Gmail', category: 'email', auth: 'oauth2', baseUrl: 'https://gmail.googleapis.com/gmail/v1', evidence: 'adapter-verified', operations: [op('list-messages', 'GET', '/users/me/messages'), op('send', 'POST', '/users/me/messages/send', true, 'high')] },
  { id: 'outlook', name: 'Outlook', category: 'email', auth: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', evidence: 'adapter-verified', operations: [op('list-messages', 'GET', '/me/messages'), op('send', 'POST', '/me/sendMail', true, 'high')] },
  { id: 'google-drive', name: 'Google Drive', category: 'storage', auth: 'oauth2', baseUrl: 'https://www.googleapis.com/drive/v3', evidence: 'adapter-verified', operations: [op('list-files', 'GET', '/files'), op('delete-file', 'DELETE', '/files/{id}', true, 'high')] },
  { id: 'onedrive', name: 'OneDrive', category: 'storage', auth: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', evidence: 'adapter-verified', operations: [op('list', 'GET', '/me/drive/root/children')] },
  { id: 'dropbox', name: 'Dropbox', category: 'storage', auth: 'oauth2', baseUrl: 'https://api.dropboxapi.com/2', evidence: 'adapter-verified', operations: [op('list-folder', 'POST', '/files/list_folder', true)] },
  { id: 'salesforce', name: 'Salesforce', category: 'crm', auth: 'oauth2', baseUrl: 'https://login.salesforce.com', evidence: 'adapter-verified', operations: [op('query', 'GET', '/services/data/v59.0/query'), op('create-record', 'POST', '/services/data/v59.0/sobjects/{sobject}', true, 'medium')] },
  { id: 'hubspot', name: 'HubSpot', category: 'crm', auth: 'oauth2', baseUrl: 'https://api.hubapi.com', evidence: 'adapter-verified', operations: [op('list-contacts', 'GET', '/crm/v3/objects/contacts'), op('create-contact', 'POST', '/crm/v3/objects/contacts', true, 'medium')] },
  { id: 'zendesk', name: 'Zendesk', category: 'support', auth: 'oauth2', baseUrl: 'https://your-subdomain.zendesk.com/api/v2', evidence: 'adapter-verified', operations: [op('list-tickets', 'GET', '/tickets.json'), op('create-ticket', 'POST', '/tickets.json', true, 'medium')] },
  { id: 'rest', name: 'REST API', category: 'generic', auth: 'bearer', baseUrl: '', evidence: 'live-verified', operations: [op('request', 'GET', '{path}')] },
  { id: 'graphql', name: 'GraphQL', category: 'generic', auth: 'bearer', baseUrl: '', evidence: 'live-verified', operations: [op('query', 'POST', '{path}', true)] },
  { id: 'webhooks', name: 'Webhooks', category: 'generic', auth: 'signature', baseUrl: '', evidence: 'live-verified', operations: [op('receive', 'POST', '/inbound')] },
];

const BY_ID = new Map(UNIVERSAL_CONNECTORS.map((c) => [c.id, c]));

export function getConnector(id: string): ConnectorDescriptor | undefined {
  return BY_ID.get(id);
}
export function getOperation(connector: ConnectorDescriptor, name: string): OperationSpec | undefined {
  return connector.operations.find((o) => o.name === name);
}
