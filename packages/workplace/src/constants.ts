/**
 * Wave 10 constants. Isolated module (no imports).
 */
export const WORKPLACE_VERSION = '0.0.0-preview.1';

/** The one honest answer a dashboard gives when no real data exists. */
export const NO_WORKSPACE_DATA = 'No business data available';

/** Module 1 — workspace scopes. */
export const WORKSPACE_SCOPES = ['personal', 'team', 'department', 'organization', 'shared', 'external'] as const;
export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[number];

/** Module 3 — unified inbox item kinds. */
export const INBOX_KINDS = ['notification', 'task', 'approval', 'mention', 'workflow-message', 'system-alert', 'ai-suggestion'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Modules 8/9/10/12 — external provider categories (adapter-verified until configured). */
export const PROVIDER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'Gmail', category: 'email' },
  { system: 'Outlook', category: 'email' },
  { system: 'Google Calendar', category: 'calendar' },
  { system: 'Microsoft 365 Calendar', category: 'calendar' },
  { system: 'Zoom', category: 'video' },
  { system: 'Microsoft Teams', category: 'video' },
  { system: 'Google Meet', category: 'video' },
  { system: 'Google Drive', category: 'storage' },
  { system: 'OneDrive', category: 'storage' },
  { system: 'Dropbox', category: 'storage' },
  { system: 'Slack', category: 'messaging' },
];

/** Module 17 — dashboard roles. */
export const DASHBOARD_ROLES = ['employee', 'manager', 'executive', 'department', 'organization'] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

/** Module 15 — command kinds. */
export const COMMAND_KINDS = ['ai', 'workflow', 'search', 'business', 'navigation'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** Module 19 — workspace SDK artifact kinds. */
export const SDK_ARTIFACTS = ['widget', 'page', 'command', 'dashboard', 'workflow', 'panel', 'extension'] as const;
export type SdkArtifact = (typeof SDK_ARTIFACTS)[number];

/** Module 18 — marketplace app kinds. */
export const MARKETPLACE_APP_KINDS = ['workspace-app', 'industry-app', 'internal-app', 'ai-skill', 'widget', 'dashboard', 'template'] as const;
export type MarketplaceAppKind = (typeof MARKETPLACE_APP_KINDS)[number];

/** Module 23 — design system themes. */
export const DESIGN_THEMES = ['light', 'dark', 'high-contrast'] as const;
export type DesignTheme = (typeof DESIGN_THEMES)[number];
