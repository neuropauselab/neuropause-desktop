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
  registerAdapter(entraAdapter);
}
