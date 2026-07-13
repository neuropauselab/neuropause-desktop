/**
 * Registers the built-in adapters. Called once at sync-engine init. Adding a new
 * provider is a single line here plus its mapping module.
 */
import { registerAdapter } from '../registry';
import { githubAdapter } from './github';
import { notionAdapter } from './notion';
import { googleWorkspaceAdapter } from './googleWorkspace';
import { slackAdapter } from './slack';
import { atlassianAdapter } from './atlassian';
import { salesforceAdapter } from './salesforce';
import { hubspotAdapter } from './hubspot';
import { entraAdapter } from './entra';

export function registerBuiltinAdapters(): void {
  registerAdapter(githubAdapter);
  registerAdapter(notionAdapter);
  // Google Workspace is one connector family (Gmail/Calendar/Drive/People/Tasks as service resources on
  // one token), mirroring how microsoft-entra hosts the M365 services.
  registerAdapter(googleWorkspaceAdapter);
  registerAdapter(slackAdapter);
  // Atlassian is one connector family (Jira + Confluence service resources on one OAuth 3LO token).
  registerAdapter(atlassianAdapter);
  // Salesforce is one connector family (every CRM object as a graceful service resource on one OAuth
  // token); the org's instance_url + queryable objects are resolved at runtime, not hardcoded.
  registerAdapter(salesforceAdapter);
  // HubSpot is one connector family (every CRM object as a graceful, Search-API-incremental service
  // resource on one OAuth token); per-object scopes drive runtime capability discovery.
  registerAdapter(hubspotAdapter);
  registerAdapter(entraAdapter);
}
