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
];

/** Manifest lookup by id. */
export const MANIFEST_BY_ID: Record<string, ConnectorManifest> = Object.fromEntries(
  CONNECTOR_MANIFESTS.map((m) => [m.id, m]),
);
