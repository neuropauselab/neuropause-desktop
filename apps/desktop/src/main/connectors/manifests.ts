/**
 * The connector registry: static manifests for every supported provider.
 *
 * Endpoint URLs and scopes are real and current to the best of our knowledge;
 * client credentials are supplied at runtime via environment variables (see
 * `credentials.ts`). Scopes are deliberately read-only / least-privilege — NCF
 * reads to build memory and timelines, it does not mutate provider data.
 *
 * Providers without a public user-data OAuth API (the AI assistants) are modelled
 * as `api_key` connectors so the framework still represents them as first-class,
 * with the key entered at connect time rather than a browser flow.
 */
import type { ConnectorManifest } from '@neuropause/shared';

/** Google's shared OAuth endpoints (Drive and Calendar use one OAuth app). */
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

/**
 * Microsoft Entra ID authority. A single-tenant app registration must target its tenant id — `common`
 * (the multi-tenant authority) is rejected by single-tenant apps (AADSTS50194). Set
 * NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID to that GUID; it defaults to `common`. Read at runtime, exactly
 * like the client credentials in credentials.ts.
 */
const ENTRA_TENANT_ENV = 'NEUROPAUSE_MICROSOFT_ENTRA_TENANT_ID';
const ENTRA_TENANT = (process.env[ENTRA_TENANT_ENV] ?? '').trim() || 'common';
const ENTRA_AUTHORITY = `https://login.microsoftonline.com/${ENTRA_TENANT}/oauth2/v2.0`;

/**
 * ServiceNow instance base. Unlike every other provider, ServiceNow's OAuth endpoints AND its REST API all
 * live on the CUSTOMER'S OWN instance host, so the instance subdomain must be known before OAuth. Set
 * NEUROPAUSE_SERVICENOW_INSTANCE to it (e.g. `dev12345` or `acme`); read at runtime exactly like the Entra
 * tenant above and the client credentials in credentials.ts. Unset ⇒ an obviously-invalid placeholder host
 * so a misconfiguration fails loudly at connect (the connector is also `unavailable` until the client
 * credentials are set). The adapter (servicenow.ts) reads the SAME env var for its data calls, so the auth
 * host and the data host can never diverge.
 */
const SERVICENOW_INSTANCE_ENV = 'NEUROPAUSE_SERVICENOW_INSTANCE';
const SERVICENOW_BASE = `https://${(process.env[SERVICENOW_INSTANCE_ENV] ?? '').trim() || 'INSTANCE'}.service-now.com`;

/**
 * SAP S/4HANA tenant host. Like ServiceNow, every SAP OAuth AND OData endpoint lives on the customer's own
 * tenant host, so it must be known before OAuth. Set NEUROPAUSE_SAP_HOST to the API host (e.g.
 * `mytenant-api.s4hana.cloud.sap`); NEUROPAUSE_SAP_CLIENT to the mandant/client (e.g. `100`, default `100`).
 * Read at runtime, exactly like the Entra tenant + the client credentials in credentials.ts. The adapter
 * (sap.ts) reads NEUROPAUSE_SAP_HOST for its data calls, so the auth host and data host never diverge.
 */
const SAP_HOST_ENV = 'NEUROPAUSE_SAP_HOST';
const SAP_BASE = `https://${(process.env[SAP_HOST_ENV] ?? '').trim() || 'HOST'}`;
const SAP_CLIENT = (process.env['NEUROPAUSE_SAP_CLIENT'] ?? '').trim() || '100';

/**
 * Oracle Fusion Cloud ERP has TWO hosts: OAuth runs on the Oracle Identity Cloud Service (IDCS/IAM) host,
 * the data API on the Fusion applications pod. Set NEUROPAUSE_ORACLE_IDCS_HOST to the IDCS host (e.g.
 * `idcs-abc123.identity.oraclecloud.com`) for the authorize/token URLs, and NEUROPAUSE_ORACLE_FUSION_HOST
 * to the pod host (e.g. `mytenant.fa.us2.oraclecloud.com`) — the adapter (oracle.ts) reads the latter for
 * its data calls, so the auth host and data host stay independent, as the platform requires. The granted
 * OAuth scope is the coarse, deployment-specific Fusion resource scope in NEUROPAUSE_ORACLE_SCOPE (access
 * is then governed by the integration user's roles, not the scope). Read at manifest load, like the SAP
 * tenant + the Entra tenant.
 */
const ORACLE_IDCS_HOST_ENV = 'NEUROPAUSE_ORACLE_IDCS_HOST';
const ORACLE_IDCS_BASE = `https://${(process.env[ORACLE_IDCS_HOST_ENV] ?? '').trim() || 'IDCS_HOST'}`;
const ORACLE_SCOPE = (process.env['NEUROPAUSE_ORACLE_SCOPE'] ?? '').trim();
/** Authorize/token scopes: the deployment resource scope (when configured) + `offline_access` for a refresh token. */
const ORACLE_OAUTH_SCOPES = [ORACLE_SCOPE, 'offline_access'].filter(Boolean);

/**
 * Microsoft Dynamics 365 authenticates through Microsoft Entra ID — the SAME identity platform v2.0
 * endpoints as the microsoft-entra connector — so the authority is built exactly like ENTRA_AUTHORITY (its
 * own tenant env, defaulting to `common`). The ONLY Dynamics-specific piece is the per-org Dataverse URL in
 * NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL (e.g. `https://myorg.crm.dynamics.com`), which forms BOTH the OAuth
 * resource scope (`{orgUrl}/user_impersonation`) here AND the Web API data host in dynamics.ts — read at
 * manifest load, like the SAP/Oracle hosts, so auth and data never diverge.
 */
const DYNAMICS_ORG_URL_ENV = 'NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL';
const DYNAMICS_ORG_URL = (process.env[DYNAMICS_ORG_URL_ENV] ?? '').trim().replace(/\/+$/, '') || 'https://ORG.crm.dynamics.com';
const DYNAMICS_TENANT_ENV = 'NEUROPAUSE_MICROSOFT_DYNAMICS_TENANT_ID';
const DYNAMICS_TENANT = (process.env[DYNAMICS_TENANT_ENV] ?? '').trim() || 'common';
const DYNAMICS_AUTHORITY = `https://login.microsoftonline.com/${DYNAMICS_TENANT}/oauth2/v2.0`;
/** Delegated read scope: the per-org Dataverse resource scope + the OpenID scopes + `offline_access` (refresh). */
const DYNAMICS_OAUTH_SCOPES = ['openid', 'profile', 'email', 'offline_access', `${DYNAMICS_ORG_URL}/user_impersonation`];

/**
 * Workday embeds BOTH a per-customer host AND a tenant short-name in every OAuth and REST URL
 * (`https://{host}/ccx/oauth2/{tenant}/token`, `https://{host}/ccx/api/{service}/{version}/{tenant}/…`), so
 * both must be known before OAuth. Set NEUROPAUSE_WORKDAY_HOST to the host (e.g. `wd2-impl-services1.workday.com`)
 * and NEUROPAUSE_WORKDAY_TENANT to the tenant (e.g. `acme`). Read at manifest load, like the SAP host + client;
 * the adapter (workday.ts) reads the SAME two env vars for its data calls so auth and data never diverge.
 */
const WORKDAY_HOST_ENV = 'NEUROPAUSE_WORKDAY_HOST';
const WORKDAY_BASE = `https://${(process.env[WORKDAY_HOST_ENV] ?? '').trim() || 'HOST.workday.com'}`;
const WORKDAY_TENANT = (process.env['NEUROPAUSE_WORKDAY_TENANT'] ?? '').trim() || 'TENANT';

export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  /* ─────────────── AI assistants (API key) ─────────────── */
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    provider: 'OpenAI',
    description: 'Bring your ChatGPT conversations and threads into your AI memory timeline.',
    category: 'ai_assistant',
    website: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs',
    brandColor: '#10A37F',
    version: '1.0.0',
    authType: 'api_key',
    capabilities: ['conversations', 'activities'],
    scopes: [
      { id: 'api', label: 'API access', description: 'Read access via your OpenAI API key.' },
    ],
    oauth: null,
    multiAccount: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    provider: 'Anthropic',
    description: 'Index your Claude conversations alongside the rest of your AI work.',
    category: 'ai_assistant',
    website: 'https://claude.ai',
    docsUrl: 'https://docs.anthropic.com',
    brandColor: '#D97757',
    version: '1.0.0',
    authType: 'api_key',
    capabilities: ['conversations', 'activities'],
    scopes: [
      { id: 'api', label: 'API access', description: 'Read access via your Anthropic API key.' },
    ],
    oauth: null,
    multiAccount: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    provider: 'Google',
    description: 'Connect Google Gemini to capture prompts and responses in your timeline.',
    category: 'ai_assistant',
    website: 'https://gemini.google.com',
    docsUrl: 'https://ai.google.dev',
    brandColor: '#1A73E8',
    version: '1.0.0',
    authType: 'api_key',
    capabilities: ['conversations', 'activities'],
    scopes: [
      { id: 'api', label: 'API access', description: 'Read access via your Google AI Studio key.' },
    ],
    oauth: null,
    multiAccount: true,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    provider: 'Perplexity AI',
    description: 'Keep your Perplexity research threads searchable in AI memory.',
    category: 'ai_assistant',
    website: 'https://perplexity.ai',
    docsUrl: 'https://docs.perplexity.ai',
    brandColor: '#20808D',
    version: '1.0.0',
    authType: 'api_key',
    capabilities: ['conversations', 'activities'],
    scopes: [
      { id: 'api', label: 'API access', description: 'Read access via your Perplexity API key.' },
    ],
    oauth: null,
    multiAccount: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    provider: 'Anysphere',
    description: 'Track your Cursor coding sessions and AI edits as activity.',
    category: 'developer',
    website: 'https://cursor.com',
    docsUrl: 'https://docs.cursor.com',
    brandColor: '#000000',
    version: '1.0.0',
    authType: 'api_key',
    capabilities: ['activities'],
    scopes: [
      { id: 'api', label: 'API access', description: 'Read access via your Cursor API key.' },
    ],
    oauth: null,
    multiAccount: false,
  },

  /* ─────────────── Developer ─────────────── */
  {
    id: 'github',
    name: 'GitHub',
    provider: 'GitHub',
    description: 'One GitHub connector family: repositories, issues, pull requests, Actions, releases, organizations, teams, and notifications.',
    category: 'developer',
    website: 'https://github.com',
    docsUrl: 'https://docs.github.com/apps/oauth-apps',
    brandColor: '#24292F',
    version: '2.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['repositories', 'issues', 'projects', 'activities', 'notifications'],
    // One consent for the whole family; GitHub returns the granted subset → runtime capability discovery
    // (githubServiceAvailability). Least-privilege, read-only: no write/workflow-management scopes.
    scopes: [
      { id: 'read:user', label: 'Profile', description: 'Read your GitHub profile.' },
      { id: 'repo', label: 'Repositories', description: 'Read repositories, issues, pull requests, Actions, and releases.' },
      { id: 'read:org', label: 'Organizations & Teams', description: 'Read the organizations and teams you belong to.' },
      { id: 'notifications', label: 'Notifications', description: 'Read your notifications.' },
    ],
    oauth: {
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      revokeUrl: null,
      scopes: ['read:user', 'repo', 'read:org', 'notifications'],
      scopeSeparator: ' ',
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_GITHUB_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_GITHUB_CLIENT_SECRET',
      // Optional: set this to verify inbound GitHub webhooks (X-Hub-Signature-256, HMAC-SHA256 over the
      // raw body). Present-but-unset simply leaves live webhook delivery off; scheduled sync is unaffected.
      webhookSecretEnv: 'NEUROPAUSE_GITHUB_WEBHOOK_SECRET',
      // GitHub OAuth Apps require an exact registered callback port, so pin one.
      // Register http://127.0.0.1:42813/callback as the Authorization callback URL.
      loopbackPort: 42813,
    },
    multiAccount: true,
  },

  /* ─────────────── Productivity ─────────────── */
  {
    id: 'notion',
    name: 'Notion',
    provider: 'Notion Labs',
    description: 'Index pages, databases, and tasks from your Notion workspace.',
    category: 'productivity',
    website: 'https://notion.so',
    docsUrl: 'https://developers.notion.com/docs/authorization',
    brandColor: '#000000',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['documents', 'projects', 'tasks'],
    scopes: [
      { id: 'workspace', label: 'Workspace', description: 'Read pages and databases you share.' },
    ],
    oauth: {
      authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      revokeUrl: null,
      scopes: [],
      scopeSeparator: ' ',
      usePkce: false,
      tokenAuthStyle: 'basic',
      extraAuthParams: { owner: 'user' },
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_NOTION_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_NOTION_CLIENT_SECRET',
    },
    multiAccount: true,
  },

  /* ─────────────── Communication ─────────────── */
  {
    id: 'slack',
    name: 'Slack',
    provider: 'Slack',
    description: 'One Slack connector family: channels, messages, users, and files — with realtime Socket Mode sync.',
    category: 'communication',
    website: 'https://slack.com',
    docsUrl: 'https://api.slack.com/authentication/oauth-v2',
    brandColor: '#4A154B',
    version: '2.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['conversations', 'messages', 'contacts', 'files'],
    // One consent for the family; Slack returns the granted bot scopes → runtime capability discovery
    // (slackServiceAvailability). Least-privilege, read-only. Private channels (groups:read/history) and
    // search (a user token) are documented follow-ons.
    scopes: [
      { id: 'channels:read', label: 'Channels', description: 'Read public channel metadata.' },
      { id: 'channels:history', label: 'Messages', description: 'Read messages in public channels the app is in.' },
      { id: 'users:read', label: 'Users', description: 'Read the workspace user directory.' },
      { id: 'files:read', label: 'Files', description: 'Read files shared in the workspace.' },
    ],
    oauth: {
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      revokeUrl: 'https://slack.com/api/auth.revoke',
      scopes: ['channels:read', 'channels:history', 'users:read', 'files:read'],
      scopeSeparator: ',',
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_SLACK_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_SLACK_CLIENT_SECRET',
      // Optional: set to verify the signed HTTP Events inbound path (v0 HMAC over `v0:timestamp:body`).
      // Socket Mode (NEUROPAUSE_SLACK_APP_TOKEN) works without it; present-but-unset leaves the signed
      // relay path fail-closed while scheduled + Socket Mode sync are unaffected.
      webhookSecretEnv: 'NEUROPAUSE_SLACK_SIGNING_SECRET',
    },
    multiAccount: true,
  },

  /* ─────────────── Design ─────────────── */
  {
    id: 'canva',
    name: 'Canva',
    provider: 'Canva',
    description: 'Track designs and assets from your Canva account.',
    category: 'design',
    website: 'https://canva.com',
    docsUrl: 'https://www.canva.dev/docs/connect/',
    brandColor: '#00C4CC',
    version: '1.0.0',
    authType: 'oauth2_pkce',
    capabilities: ['documents', 'files'],
    scopes: [
      { id: 'design:meta:read', label: 'Designs', description: 'Read design metadata.' },
      { id: 'asset:read', label: 'Assets', description: 'Read your uploaded assets.' },
    ],
    oauth: {
      authorizeUrl: 'https://www.canva.com/api/oauth/authorize',
      tokenUrl: 'https://api.canva.com/rest/v1/oauth/token',
      revokeUrl: 'https://api.canva.com/rest/v1/oauth/revoke',
      scopes: ['design:meta:read', 'asset:read'],
      scopeSeparator: ' ',
      usePkce: true,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      clientIdEnv: 'NEUROPAUSE_CANVA_CLIENT_ID',
      clientSecretEnv: null,
    },
    multiAccount: false,
  },
  {
    id: 'figma',
    name: 'Figma',
    provider: 'Figma',
    description: 'Index files and projects from your Figma teams.',
    category: 'design',
    website: 'https://figma.com',
    docsUrl: 'https://www.figma.com/developers/api#oauth2',
    brandColor: '#F24E1E',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['files', 'projects'],
    scopes: [
      { id: 'files:read', label: 'Files', description: 'Read your Figma files and projects.' },
    ],
    oauth: {
      authorizeUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      revokeUrl: null,
      scopes: ['files:read'],
      scopeSeparator: ' ',
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      clientIdEnv: 'NEUROPAUSE_FIGMA_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_FIGMA_CLIENT_SECRET',
    },
    multiAccount: false,
  },

  /* ─────────────── Project management ─────────────── */
  {
    // ONE Atlassian family (Jira Cloud + Confluence Cloud). Replaces the former standalone `jira` stub —
    // one card, one OAuth 3LO consent, one vault record — with Jira + Confluence service adapters beneath.
    id: 'atlassian',
    name: 'Atlassian',
    provider: 'Atlassian',
    description: 'One Atlassian connector family: Jira projects, issues, and boards, plus Confluence spaces and pages.',
    category: 'project_management',
    website: 'https://atlassian.com',
    docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
    brandColor: '#0052CC',
    version: '2.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['projects', 'tasks', 'issues', 'documents', 'activities'],
    // One consent for the family; Atlassian returns the granted scopes → runtime capability discovery
    // (atlassianServiceAvailability). Least-privilege, read-only.
    scopes: [
      { id: 'read:jira-work', label: 'Jira', description: 'Read Jira projects, issues, and boards.' },
      { id: 'read:jira-user', label: 'Jira Users', description: 'Read the Jira user directory for names.' },
      { id: 'read:confluence-space.summary', label: 'Confluence Spaces', description: 'Read Confluence space metadata.' },
      { id: 'read:confluence-content.all', label: 'Confluence Pages', description: 'Read Confluence pages and content.' },
      { id: 'offline_access', label: 'Offline', description: 'Keep the connection alive in the background.' },
    ],
    oauth: {
      authorizeUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      revokeUrl: null,
      scopes: ['read:jira-work', 'read:jira-user', 'read:confluence-space.summary', 'read:confluence-content.all', 'offline_access'],
      scopeSeparator: ' ',
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: { audience: 'api.atlassian.com', prompt: 'consent' },
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_ATLASSIAN_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_ATLASSIAN_CLIENT_SECRET',
      // Atlassian 3LO requires an exact registered redirect URI, so pin a loopback port.
      // Register http://127.0.0.1:42815/callback as the OAuth callback URL.
      loopbackPort: 42815,
    },
    multiAccount: true,
  },
  {
    id: 'linear',
    name: 'Linear',
    provider: 'Linear',
    description: 'Index issues, projects, and cycles from Linear.',
    category: 'project_management',
    website: 'https://linear.app',
    docsUrl: 'https://developers.linear.app/docs/oauth/authentication',
    brandColor: '#5E6AD2',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['projects', 'tasks', 'issues'],
    scopes: [{ id: 'read', label: 'Read', description: 'Read issues, projects, and teams.' }],
    oauth: {
      authorizeUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      revokeUrl: 'https://api.linear.app/oauth/revoke',
      scopes: ['read'],
      scopeSeparator: ',',
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      clientIdEnv: 'NEUROPAUSE_LINEAR_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_LINEAR_CLIENT_SECRET',
    },
    multiAccount: true,
  },

  /* ─────────────── Automation ─────────────── */
  {
    id: 'zapier',
    name: 'Zapier',
    provider: 'Zapier',
    description: 'Surface your Zap runs and automation activity.',
    category: 'automation',
    website: 'https://zapier.com',
    docsUrl: 'https://docs.zapier.com',
    brandColor: '#FF4F00',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['activities'],
    scopes: [{ id: 'zap', label: 'Zaps', description: 'Read your Zaps and their run history.' }],
    oauth: {
      authorizeUrl: 'https://zapier.com/oauth/authorize/',
      tokenUrl: 'https://zapier.com/oauth/token/',
      revokeUrl: null,
      scopes: ['zap'],
      scopeSeparator: ' ',
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      clientIdEnv: 'NEUROPAUSE_ZAPIER_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_ZAPIER_CLIENT_SECRET',
    },
    multiAccount: false,
  },

  /* ─────────────── Google Workspace (connector family — one OAuth, many service adapters) ─────────────── */
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    provider: 'Google',
    description:
      'Connect Google Workspace once — Gmail, Calendar, Drive (incl. Docs, Sheets & Slides), Contacts, and Tasks — through a single authenticated connection.',
    category: 'productivity',
    website: 'https://workspace.google.com',
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2/native-app',
    brandColor: '#4285F4',
    version: '1.0.0',
    authType: 'oauth2_pkce',
    capabilities: ['messages', 'conversations', 'calendar', 'events', 'files', 'documents', 'contacts', 'tasks', 'projects'],
    scopes: [
      { id: 'gmail.readonly', label: 'Gmail', description: 'Read your email messages and threads.' },
      { id: 'calendar.readonly', label: 'Calendar', description: 'Read your events and calendars.' },
      { id: 'drive.readonly', label: 'Drive, Docs, Sheets & Slides', description: 'Read your files and documents.' },
      { id: 'contacts.readonly', label: 'Contacts', description: 'Read your contacts.' },
      { id: 'tasks.readonly', label: 'Tasks', description: 'Read your task lists and tasks.' },
    ],
    oauth: {
      authorizeUrl: GOOGLE_AUTHORIZE,
      tokenUrl: GOOGLE_TOKEN,
      revokeUrl: GOOGLE_REVOKE,
      // One consent for the whole family; Google returns the granted subset → runtime capability discovery.
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/contacts.readonly',
        'https://www.googleapis.com/auth/tasks.readonly',
      ],
      scopeSeparator: ' ',
      usePkce: true,
      tokenAuthStyle: 'body',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      extraTokenParams: {},
      clientIdEnv: 'NEUROPAUSE_GOOGLE_CLIENT_ID',
      clientSecretEnv: null,
    },
    multiAccount: true,
  },
  /* ─────────────── Identity / Directory ─────────────── */
  /*
   * NOTE: Microsoft 365 (Outlook Mail, Calendar, OneDrive, Contacts, Teams) is NOT a standalone
   * connector. It rides the `microsoft-entra` connector below as additional Graph resources on the
   * same authenticated token (see unified/sync/adapters/m365.ts), so there is deliberately no separate
   * 'microsoft-365' manifest — that stub only confused users into a second, dead OAuth setup.
   */
  {
    id: 'microsoft-entra',
    name: 'Microsoft Entra ID',
    provider: 'Microsoft',
    description:
      'Sync your Microsoft Entra ID (Azure AD) directory plus Microsoft 365 — users, groups, mail, calendar, OneDrive, contacts, and Teams — via Microsoft Graph.',
    category: 'developer',
    website: 'https://www.microsoft.com/security/business/identity-access/microsoft-entra-id',
    docsUrl: 'https://learn.microsoft.com/graph/api/overview',
    brandColor: '#0067B8',
    version: '1.0.0',
    authType: 'oauth2_pkce',
    capabilities: ['activities', 'messages', 'calendar', 'events', 'files'],
    scopes: [
      { id: 'User.Read.All', label: 'Users', description: "Read your organization's user directory." },
      { id: 'Group.Read.All', label: 'Groups', description: "Read your organization's groups." },
      {
        id: 'Directory.Read.All',
        label: 'Directory',
        description: 'Read directory data (organization and memberships).',
      },
      { id: 'Mail.Read', label: 'Outlook Mail', description: 'Read your inbox mail (headers and preview).' },
      { id: 'Calendars.Read', label: 'Calendar', description: 'Read your calendar events.' },
      { id: 'Files.Read', label: 'OneDrive', description: 'Read your OneDrive files and folders.' },
      { id: 'Contacts.Read', label: 'Contacts', description: 'Read your personal contacts.' },
      { id: 'Team.ReadBasic.All', label: 'Teams', description: 'Read the Teams you belong to.' },
      {
        id: 'offline_access',
        label: 'Offline',
        description: 'Keep the connection alive in the background.',
      },
    ],
    oauth: {
      authorizeUrl: `${ENTRA_AUTHORITY}/authorize`,
      tokenUrl: `${ENTRA_AUTHORITY}/token`,
      revokeUrl: null,
      scopes: [
        'openid',
        'profile',
        'email',
        'offline_access',
        'User.Read',
        'User.Read.All',
        'Group.Read.All',
        'Directory.Read.All',
        'Mail.Read',
        'Calendars.Read',
        'Files.Read',
        'Contacts.Read',
        'Team.ReadBasic.All',
        // P2.4 — Microsoft 365 write scopes (audited, confirmation-gated). All delegated; the Teams
        // channel scopes (ChannelMessage.Send / Channel.Create / ChannelMember.Read.All) need admin consent.
        'Mail.ReadWrite',
        'Mail.Send',
        'Calendars.ReadWrite',
        'Files.ReadWrite.All',
        'Contacts.ReadWrite',
        'Chat.ReadWrite',
        'ChannelMessage.Send',
        'Channel.Create',
        'ChannelMember.Read.All',
      ],
      scopeSeparator: ' ',
      usePkce: true,
      tokenAuthStyle: 'body',
      extraAuthParams: { prompt: 'select_account' },
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_MICROSOFT_ENTRA_CLIENT_ID',
      // Public client (desktop loopback + PKCE): no secret is sent. The Entra app is registered under the
      // "Mobile and desktop applications" platform, which makes it a public client — sending a client
      // secret would fail with AADSTS700025. PKCE (usePkce) secures the code exchange instead.
      clientSecretEnv: null,
      // The loopback redirect must be registered exactly. Register http://127.0.0.1:42817/callback under
      // the app's "Mobile and desktop applications" platform (Web platform rejects http + 127.0.0.1).
      loopbackPort: 42817,
    },
    multiAccount: true,
  },

  /* ─────────────── CRM (connector family — one OAuth, many sObject service adapters) ─────────────── */
  {
    // ONE Salesforce family (Sales Cloud + Service Cloud). One card, one OAuth token, one vault record —
    // with each CRM object (Accounts, Contacts, Leads, Opportunities, Cases, Campaigns, Products, Users,
    // Tasks, Events) mounted as a graceful service resource on the same authenticated session, exactly as
    // microsoft-entra hosts M365 and atlassian hosts Jira + Confluence. There is no fixed API host: the
    // adapter resolves the org's `instance_url` at sync time (OIDC userinfo) and which objects the org
    // actually exposes via describeGlobal (runtime Sales/Service Cloud detection) — nothing hardcoded.
    id: 'salesforce',
    name: 'Salesforce',
    provider: 'Salesforce',
    description:
      'One Salesforce connector family: accounts, contacts, leads, opportunities, cases, campaigns, products, users, tasks, and events — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://salesforce.com',
    docsUrl: 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/',
    brandColor: '#00A1E0',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['contacts', 'tasks', 'activities', 'events', 'calendar', 'documents', 'projects'],
    // Salesforce OAuth scopes are coarse: `api` is the one scope that unlocks the data API for EVERY
    // object (there is no per-object or read-only scope), `openid` lets us resolve the instance via the
    // OIDC userinfo endpoint, and `refresh_token` keeps the connection alive. Per-object availability is
    // therefore NOT a scope question — it is discovered at runtime (describeGlobal + per-module status).
    // NeuroPause only ever issues read-only SOQL GETs against these objects.
    scopes: [
      { id: 'api', label: 'CRM Data', description: 'Read your Salesforce records (accounts, contacts, leads, opportunities, cases, and more).' },
      { id: 'refresh_token', label: 'Offline', description: 'Keep the connection alive in the background.' },
      { id: 'openid', label: 'Identity', description: 'Read your Salesforce identity to locate your org instance.' },
    ],
    oauth: {
      authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      revokeUrl: 'https://login.salesforce.com/services/oauth2/revoke',
      scopes: ['api', 'refresh_token', 'openid'],
      scopeSeparator: ' ',
      usePkce: true,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_SALESFORCE_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_SALESFORCE_CLIENT_SECRET',
      // Salesforce connected apps exact-match the callback URL, so pin a loopback port.
      // Register http://127.0.0.1:42819/callback as the connected app's callback URL.
      loopbackPort: 42819,
      // Salesforce's token endpoint issues short-lived access tokens (the org session length, default 2h,
      // often shortened) WITH a durable refresh token, but returns NO `expires_in`. Without a synthesized
      // expiry the proactive-refresh path never fires and the account stalls the moment the session lapses.
      // 600s (< the 15-min scheduler interval) makes `getValidAccessToken` mint a fresh token from the
      // refresh token at the start of essentially every sync, so the token in use is never the stale one —
      // safe for any org session length. The refresh token is long-lived, so this is cheap.
      accessTokenTtlSeconds: 600,
    },
    multiAccount: true,
  },

  {
    // ONE HubSpot family (Sales / Service / Commerce hubs). One card, one OAuth token, one vault record —
    // with every CRM object (Contacts, Companies, Deals, Tickets, Products, Owners, Notes, Tasks, Meetings,
    // Emails) mounted as a graceful service resource on the same authenticated session, exactly as
    // microsoft-entra hosts M365 and salesforce hosts its CRM objects. Fixed API host (api.hubapi.com), so
    // no per-org instance resolution; the token returns `expires_in` so the existing proactive-refresh
    // path needs no synthesized TTL. Scopes are per-object, so which hubs a portal has is discovered at
    // runtime from the granted scopes (see hubspotServiceAvailability) + per-module 403 degrade — nothing
    // hardcoded.
    id: 'hubspot',
    name: 'HubSpot',
    provider: 'HubSpot',
    description:
      'One HubSpot connector family: contacts, companies, deals, tickets, products, owners, notes, tasks, meetings, and emails — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://www.hubspot.com',
    docsUrl: 'https://developers.hubspot.com/docs/api/crm/understanding-the-crm',
    brandColor: '#FF7A59',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['contacts', 'tasks', 'activities', 'messages', 'events', 'calendar', 'documents'],
    // HubSpot OAuth scopes are per-object and read-only here. The REQUIRED set is the granular, least-
    // privilege `.read` scopes for the universal free-CRM objects (contacts/companies/deals/owners), so
    // requiring them never blocks connect. Everything else is `optional_scope` — auto-dropped by HubSpot
    // if the portal lacks the tool — so a portal without a given hub still connects and the granted set
    // reveals, at runtime, which objects are available. `tickets` is optional AND is HubSpot's only
    // tickets scope (there is no granular `crm.objects.tickets.read`); it is coarse (read+write), so
    // requesting it optionally keeps the required grant strictly least-privilege read-only.
    scopes: [
      { id: 'crm.objects.contacts.read', label: 'Contacts', description: 'Read contacts, and the notes, tasks, meetings, and emails logged against them.' },
      { id: 'crm.objects.companies.read', label: 'Companies', description: 'Read companies.' },
      { id: 'crm.objects.deals.read', label: 'Deals', description: 'Read deals across your pipelines.' },
      { id: 'crm.objects.owners.read', label: 'Owners', description: 'Read the owners (users) records are assigned to.' },
      { id: 'tickets', label: 'Tickets', description: 'Read support tickets (optional; HubSpot offers no read-only tickets scope).' },
      { id: 'e-commerce', label: 'Products', description: 'Read your product catalog (optional; Professional/Enterprise).' },
      { id: 'sales-email-read', label: 'Email content', description: 'Read the body of logged emails (optional).' },
    ],
    oauth: {
      authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      // HubSpot has no standard token-revoke endpoint (a refresh token is deleted via a REST DELETE, a
      // different shape than the engine's revoke POST), so disconnect drops the vaulted token locally.
      revokeUrl: null,
      // REQUIRED — granular, least-privilege `.read` scopes, all available to every account (free CRM), so
      // requiring them never blocks connect.
      scopes: ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.owners.read'],
      scopeSeparator: ' ',
      // HubSpot is a pure confidential flow (client secret at the token endpoint); it does not support PKCE.
      usePkce: false,
      tokenAuthStyle: 'body',
      // OPTIONAL scopes are auto-dropped by HubSpot if the portal lacks the tool, so auth still succeeds.
      // `tickets` is here (not required) because it is HubSpot's only — and coarse — tickets scope.
      extraAuthParams: { optional_scope: 'tickets e-commerce sales-email-read' },
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_HUBSPOT_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_HUBSPOT_CLIENT_SECRET',
      // HubSpot exact-matches the registered redirect URI; register http://127.0.0.1:42821/callback.
      loopbackPort: 42821,
    },
    multiAccount: true,
  },

  /* ─────────────── ITSM (connector family — one OAuth, many Table-API service adapters) ─────────────── */
  {
    // ONE ServiceNow family (ITSM + CMDB + Knowledge + Asset + Catalog). One card, one OAuth token, one
    // vault record — with every table (Incidents, Problems, Change Requests, Requests, Knowledge, CMDB,
    // Assets, Users, Groups, Catalog) mounted as a graceful Table-API service resource on the same
    // authenticated session, exactly as microsoft-entra hosts M365 and salesforce/hubspot host their
    // objects. The OAuth + REST endpoints all live on the customer's instance host, built from
    // NEUROPAUSE_SERVICENOW_INSTANCE (see SERVICENOW_BASE). The token returns `expires_in` so the existing
    // proactive-refresh path needs no synthesized TTL. Access is governed by the integration user's ROLES
    // (not OAuth scopes), so which apps a plugin exposes is discovered at runtime from the per-module
    // degrade (a missing table 400 → unprovisioned) — nothing hardcoded.
    id: 'servicenow',
    name: 'ServiceNow',
    provider: 'ServiceNow',
    description:
      'One ServiceNow connector family: incidents, problems, change requests, requests, knowledge, CMDB, assets, users, groups, and catalog — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://www.servicenow.com',
    docsUrl: 'https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI',
    brandColor: '#62D84E',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['tasks', 'activities', 'contacts', 'documents'],
    // ServiceNow OAuth has no per-object scopes: `useraccount` is the built-in global scope and access is
    // governed by the integration user's ROLES/ACLs. Least-privilege is achieved by giving that user the
    // read-only `snc_read_only` role plus the read roles for the tables synced — NOT via OAuth scope. The
    // adapter only ever issues read-only Table-API GETs.
    scopes: [
      { id: 'useraccount', label: 'ServiceNow', description: 'Read ServiceNow records as the integration user (access is governed by that user\'s roles; use a read-only role).' },
    ],
    oauth: {
      // Instance-hosted endpoints (built from NEUROPAUSE_SERVICENOW_INSTANCE).
      authorizeUrl: `${SERVICENOW_BASE}/oauth_auth.do`,
      tokenUrl: `${SERVICENOW_BASE}/oauth_token.do`,
      revokeUrl: `${SERVICENOW_BASE}/oauth_revoke_token.do`,
      // `useraccount` is ServiceNow's built-in global scope (a no-op for access control — roles govern that).
      scopes: ['useraccount'],
      scopeSeparator: ' ',
      // Confidential flow (client secret at the token endpoint). ServiceNow's PKCE support is version-
      // dependent, so rely on the secret (universally supported), like Salesforce/HubSpot.
      usePkce: false,
      tokenAuthStyle: 'body',
      extraAuthParams: {},
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_SERVICENOW_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_SERVICENOW_CLIENT_SECRET',
      // ServiceNow exact-matches the registered redirect URI; register http://127.0.0.1:42823/callback.
      loopbackPort: 42823,
      // ServiceNow returns expires_in (1800s) with a durable refresh token → existing refresh path; no TTL.
    },
    // One instance per deployment (the instance is a single env var), so a single connected account.
    multiAccount: false,
  },

  /* ─────────────── ERP (connector family — one OAuth, many OData service adapters) ─────────────── */
  {
    // ONE SAP S/4HANA family (Finance / Procurement / Manufacturing / Sales / Inventory / Warehouse). One
    // card, one OAuth token, one vault record — with every business object (Business Partners, Customers,
    // Suppliers, Materials, Inventory, Sales/Purchase/Production Orders, Financials, Plants, Warehouses)
    // mounted as a graceful OData service resource on the same authenticated session, exactly as
    // microsoft-entra hosts M365 and servicenow hosts its tables. The OAuth + OData endpoints all live on
    // the customer's tenant host, built from NEUROPAUSE_SAP_HOST (see SAP_BASE). The token returns
    // `expires_in` so the existing proactive-refresh path needs no synthesized TTL. Access is governed by
    // the tenant's Communication Arrangement + the user's roles (not OAuth scopes), so which modules a
    // tenant exposes is discovered at runtime from the per-module degrade (a missing service 403/404).
    id: 'sap',
    name: 'SAP S/4HANA',
    provider: 'SAP',
    description:
      'One SAP S/4HANA connector family: business partners, customers, suppliers, materials, inventory, sales/purchase/production orders, financials, plants, and warehouses — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://www.sap.com',
    docsUrl: 'https://api.sap.com/products/SAPS4HANACloud/apis',
    brandColor: '#0FAAFF',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['tasks', 'activities', 'contacts', 'documents'],
    // SAP OAuth has no per-object scopes: access is governed by the integration (communication) user's
    // roles + the tenant's Communication Arrangements. Least-privilege = a read-only communication user
    // with only the arrangements for the synced APIs. The adapter only issues read-only OData GETs.
    scopes: [
      { id: 'sap', label: 'SAP S/4HANA', description: 'Read SAP business data as the integration user (access is governed by that user\'s roles and Communication Arrangements).' },
    ],
    oauth: {
      // Tenant-hosted OAuth endpoints (built from NEUROPAUSE_SAP_HOST). The mandant (`sap-client`) is
      // required on the authorize + token requests.
      authorizeUrl: `${SAP_BASE}/sap/bc/sec/oauth2/authorize`,
      tokenUrl: `${SAP_BASE}/sap/bc/sec/oauth2/token`,
      // SAP has no standard OAuth token-revoke shape the engine's revoke POST matches, so disconnect drops
      // the vaulted token locally.
      revokeUrl: null,
      // No per-object scopes — SAP governs access by role + Communication Arrangement, not OAuth scope.
      scopes: [],
      scopeSeparator: ' ',
      // Confidential flow (client secret at the token endpoint), mirroring ServiceNow/Salesforce.
      usePkce: false,
      tokenAuthStyle: 'body',
      // The mandant/client must accompany both the authorize and token requests.
      extraAuthParams: { 'sap-client': SAP_CLIENT },
      extraTokenParams: { 'sap-client': SAP_CLIENT },
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_SAP_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_SAP_CLIENT_SECRET',
      // SAP exact-matches the registered redirect URI; register http://127.0.0.1:42825/callback in the
      // tenant's OAuth 2.0 client configuration.
      loopbackPort: 42825,
      // SAP returns expires_in → existing refresh path; no synthesized TTL.
    },
    // One tenant per deployment (the host is a single env var), so a single connected account.
    multiAccount: false,
  },

  {
    // ONE Oracle Fusion Cloud ERP family (Financials / Procurement / Supply Chain / Manufacturing /
    // Projects). One card, one OAuth token, one vault record — with every business object (Business Units,
    // Suppliers, Customers, Items, Inventory, Purchase Orders, Receipts, Invoices, Payments, Projects, Work
    // Orders) mounted as a graceful Fusion-REST service resource on the same authenticated session, exactly
    // as microsoft-entra hosts M365 and servicenow/sap host their objects. Oracle splits OAuth (the IDCS/IAM
    // host, NEUROPAUSE_ORACLE_IDCS_HOST) from the data API (the Fusion pod, NEUROPAUSE_ORACLE_FUSION_HOST,
    // read by oracle.ts). The IDCS token endpoint takes HTTP Basic client auth and returns `expires_in`
    // (3600s) + a refresh token (via offline_access), so the existing proactive-refresh path needs no
    // synthesized TTL. Access is governed by the integration user's roles + data-security policies (not
    // OAuth scopes), so which pillars a pod exposes is discovered at runtime from the per-module degrade.
    id: 'oracle',
    name: 'Oracle Fusion Cloud ERP',
    provider: 'Oracle',
    description:
      'One Oracle Fusion Cloud ERP connector family: business units, suppliers, customers, items, inventory, purchase orders, receipts, invoices, payments, projects, and work orders — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://www.oracle.com/erp/',
    docsUrl: 'https://docs.oracle.com/en/cloud/saas/index.html',
    brandColor: '#C74634',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['tasks', 'activities', 'contacts', 'documents', 'projects'],
    // Oracle Fusion OAuth has no per-object scopes: the granted scope is the coarse Fusion resource scope,
    // and access is governed by the integration user's job/duty roles + data-security policies. Least-
    // privilege = a read-only integration user with the relevant view duty roles. The adapter only issues
    // read-only Fusion REST GETs against these objects.
    scopes: [
      { id: 'oracle', label: 'Oracle Fusion ERP', description: 'Read Oracle Fusion ERP data as the integration user (access is governed by that user\'s roles and data-security policies).' },
    ],
    oauth: {
      // IDCS-hosted OAuth endpoints (built from NEUROPAUSE_ORACLE_IDCS_HOST), separate from the Fusion data
      // pod. offline_access yields the refresh token; the resource scope comes from NEUROPAUSE_ORACLE_SCOPE.
      authorizeUrl: `${ORACLE_IDCS_BASE}/oauth2/v1/authorize`,
      tokenUrl: `${ORACLE_IDCS_BASE}/oauth2/v1/token`,
      // IDCS revoke (/oauth2/v1/revoke) expects Basic-auth in a shape the engine's revoke POST doesn't match,
      // so disconnect drops the vaulted token locally (like SAP / ServiceNow / HubSpot).
      revokeUrl: null,
      scopes: ORACLE_OAUTH_SCOPES,
      scopeSeparator: ' ',
      // Confidential flow; IDCS confidential clients authenticate at the token endpoint with HTTP Basic —
      // the one auth-style difference from the body-credential ERP families.
      usePkce: false,
      tokenAuthStyle: 'basic',
      extraAuthParams: {},
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_ORACLE_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_ORACLE_CLIENT_SECRET',
      // IDCS exact-matches the registered redirect URI; register http://127.0.0.1:42827/callback as the
      // confidential application's redirect URL.
      loopbackPort: 42827,
      // IDCS returns expires_in (3600) → existing refresh path; no synthesized TTL.
    },
    // One pod per deployment (the hosts are single env vars), so a single connected account.
    multiAccount: false,
  },

  {
    // ONE Microsoft Dynamics 365 family (Sales / Customer Service / Field Service / Project Operations +
    // the core Dataverse tables). One card, one OAuth token, one vault record — with every table (Accounts,
    // Contacts, Leads, Opportunities, Cases, Products, Sales Orders, Purchase Orders, Invoices, Projects,
    // Assets, Users) mounted as a graceful Dataverse-Web-API service resource on the same authenticated
    // session, exactly as microsoft-entra hosts M365 and salesforce/servicenow host their objects. Dynamics
    // authenticates through Microsoft Entra ID — the SAME identity platform the microsoft-entra connector
    // uses (PKCE public client, offline_access → refresh, expires_in → the existing proactive-refresh path,
    // no synthesized TTL) — the only difference being the per-org Dataverse resource scope built from
    // NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL (which dynamics.ts also reads for the data host). Access is
    // governed by the user's Dataverse security roles (not per-object OAuth scopes), so which apps a org
    // exposes is discovered at runtime from the per-module degrade (a missing table's 404/403).
    id: 'dynamics365',
    name: 'Microsoft Dynamics 365',
    provider: 'Microsoft',
    description:
      'One Microsoft Dynamics 365 connector family: accounts, contacts, leads, opportunities, cases, products, sales orders, purchase orders, invoices, projects, assets, and users — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://www.microsoft.com/dynamics-365',
    docsUrl: 'https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview',
    brandColor: '#002050',
    version: '1.0.0',
    // PKCE public client on the desktop loopback — identical to microsoft-entra (no client secret).
    authType: 'oauth2_pkce',
    capabilities: ['contacts', 'tasks', 'activities', 'documents', 'projects'],
    // Dynamics OAuth has no per-object scopes: the single Dataverse `user_impersonation` scope unlocks the
    // whole Web API, and access is governed by the user's Dataverse security roles. Least-privilege = a
    // read-only security role on the integration user. The adapter only issues read-only OData GETs.
    scopes: [
      { id: 'user_impersonation', label: 'Dynamics 365 data', description: 'Read your Dynamics 365 data as yourself (access is governed by your Dataverse security roles).' },
      { id: 'offline_access', label: 'Offline', description: 'Keep the connection alive in the background.' },
    ],
    oauth: {
      // Microsoft Entra ID v2.0 endpoints (built from the Dynamics tenant env), identical to microsoft-entra.
      authorizeUrl: `${DYNAMICS_AUTHORITY}/authorize`,
      tokenUrl: `${DYNAMICS_AUTHORITY}/token`,
      // Entra tokens are revoked by the user in Entra/account settings, not a standard revoke POST the engine
      // matches, so disconnect drops the vaulted token locally (like microsoft-entra).
      revokeUrl: null,
      // The per-org Dataverse resource scope + OpenID scopes + offline_access (built from the org URL env).
      scopes: DYNAMICS_OAUTH_SCOPES,
      scopeSeparator: ' ',
      // Public client + PKCE (no secret), exactly like microsoft-entra — a desktop loopback confidential
      // secret would trip AADSTS700025.
      usePkce: true,
      tokenAuthStyle: 'body',
      extraAuthParams: { prompt: 'select_account' },
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_MICROSOFT_DYNAMICS_CLIENT_ID',
      clientSecretEnv: null,
      // Entra exact-matches the redirect URI; register http://127.0.0.1:42829/callback under the app's
      // "Mobile and desktop applications" platform.
      loopbackPort: 42829,
      // Entra returns expires_in → existing refresh path; no synthesized TTL.
    },
    // One org per deployment (the org URL is a single env var), so a single connected account.
    multiAccount: false,
  },

  {
    // ONE Workday family (HR / Payroll / Benefits / Recruiting / Learning / Time Tracking / Absence /
    // Compensation). One card, one OAuth token, one vault record — with every HCM object (Workers,
    // Organizations, Positions, Jobs, Departments, Supervisory Organizations, Recruiting, Candidates,
    // Benefits, Payroll, Learning, Time Off) mounted as a graceful REST service resource on the same
    // authenticated session, exactly as microsoft-entra hosts M365 and servicenow/sap host their objects.
    // The OAuth + REST endpoints all embed the customer's host + tenant, built from NEUROPAUSE_WORKDAY_HOST
    // and NEUROPAUSE_WORKDAY_TENANT (which workday.ts also reads for the data calls). The token endpoint takes
    // HTTP Basic client auth and returns `expires_in` (+ an optionally non-expiring refresh token), so the
    // existing proactive-refresh path needs no synthesized TTL. Access is governed by the Integration System
    // User's security groups (not per-object OAuth scopes), so which modules a tenant exposes is discovered
    // at runtime from the per-module degrade.
    id: 'workday',
    name: 'Workday',
    provider: 'Workday',
    description:
      'One Workday connector family: workers, organizations, positions, jobs, departments, supervisory organizations, recruiting, candidates, benefits, payroll, learning, and time off — synced through a single authenticated connection.',
    category: 'productivity',
    website: 'https://www.workday.com',
    docsUrl: 'https://community.workday.com/rest-api',
    brandColor: '#005CB9',
    version: '1.0.0',
    authType: 'oauth2_confidential',
    capabilities: ['contacts', 'tasks', 'activities', 'documents', 'events'],
    // Workday OAuth scopes are functional areas configured ON the API Client; the request-time scope set is
    // empty because actual access is governed by the Integration System User's security groups + domain
    // security policies (like SAP's role-governed model). Least-privilege = a read-only ISU with GET on only
    // the domains synced. The adapter only issues read-only REST GETs.
    scopes: [
      { id: 'workday', label: 'Workday', description: 'Read Workday HCM data as the integration system user (access is governed by that user\'s security groups and domain policies).' },
    ],
    oauth: {
      // Tenant-hosted OAuth endpoints (built from NEUROPAUSE_WORKDAY_HOST + NEUROPAUSE_WORKDAY_TENANT).
      authorizeUrl: `${WORKDAY_BASE}/ccx/oauth2/${WORKDAY_TENANT}/authorize`,
      tokenUrl: `${WORKDAY_BASE}/ccx/oauth2/${WORKDAY_TENANT}/token`,
      // Workday has no standard OAuth revoke shape the engine's revoke POST matches, so disconnect drops the
      // vaulted token locally (like SAP / ServiceNow / Oracle).
      revokeUrl: null,
      // No per-object request scopes — access is governed by the API Client's functional areas + the ISU's
      // security groups, not OAuth scope strings.
      scopes: [],
      scopeSeparator: ' ',
      // Confidential flow; the Workday token endpoint takes HTTP Basic client auth (the recommended method).
      usePkce: false,
      tokenAuthStyle: 'basic',
      extraAuthParams: {},
      extraTokenParams: {},
      callbackPath: '/callback',
      clientIdEnv: 'NEUROPAUSE_WORKDAY_CLIENT_ID',
      clientSecretEnv: 'NEUROPAUSE_WORKDAY_CLIENT_SECRET',
      // Workday API Clients exact-match the registered redirect URI; register http://127.0.0.1:42831/callback.
      loopbackPort: 42831,
      // Workday returns expires_in → existing refresh path; no synthesized TTL.
    },
    // One tenant per deployment (the host + tenant are single env vars), so a single connected account.
    multiAccount: false,
  },
];

/** Manifest lookup by id. */
export const MANIFEST_BY_ID: Record<string, ConnectorManifest> = Object.fromEntries(
  CONNECTOR_MANIFESTS.map((m) => [m.id, m]),
);
