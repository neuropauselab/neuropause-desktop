/**
 * Unified Interaction Layer (V2.8) — shared types.
 *
 * One command model that EVERY interaction source maps into: voice, keyboard,
 * command palette, quick actions, context menus, and notification actions. The
 * router resolves a UnifiedCommand to a CommandResolution that reuses an existing
 * service (navigation, the intelligence pipeline, or a governed action). This adds
 * no new search, no new palette, and no new governance — it composes them.
 */

/** Where an interaction originated (for audit + surface-specific behavior). */
export type InteractionSource =
  'voice' | 'keyboard' | 'command-palette' | 'quick-action' | 'context-menu' | 'notification';

/** The stable command identifiers the whole app shares. Adding one is additive. */
export type CommandId =
  | 'open.founder'
  | 'open.mission-brief'
  | 'open.engineering'
  | 'open.organization'
  | 'open.memory'
  | 'open.notifications'
  | 'open.executive-center'
  | 'search.organizations'
  | 'search.memory'
  | 'search.timeline'
  | 'action.create-task'
  | 'action.generate-report'
  | 'action.notify-team'
  | 'voice.start-session'
  | 'org.view-health'
  | 'org.notify-members'
  | 'brief.explain'
  | 'brief.export'
  | 'brief.share'
  | 'eng.open-issue'
  | 'eng.view-failures'
  | 'notification.snooze'
  | 'notification.dismiss'
  | 'notification.explain';

/** How a resolved command should be executed by the shell. */
export type CommandResolutionKind = 'navigate' | 'intelligence' | 'action' | 'search' | 'ui';

/** The resolution the router produces; the shell executes it with existing services. */
export interface CommandResolution {
  kind: CommandResolutionKind;
  /** For 'navigate'/'search': the deep-link (reuses the V2.5 deepLinkToSection). */
  deepLink?: string;
  /** For 'search': the query to run in the EXISTING enterprise search. */
  query?: string;
  /** For 'intelligence': which existing pipeline to invoke. */
  intelligence?: 'founder' | 'brief' | 'org-health' | 'executive-snapshot';
  /** For 'action': the governed action id (must pass the existing approval path). */
  actionId?: string;
  /** True when execution requires explicit approval (governance). */
  requiresApproval?: boolean;
  /** For 'ui': a shell UI effect (e.g. open the voice widget, open palette). */
  uiEffect?: 'open-voice' | 'open-command-palette' | 'toggle-sidebar';
}

/** A command flowing through the router, tagged with its source. */
export interface UnifiedCommand {
  id: CommandId;
  source: InteractionSource;
  /** Optional free-text payload (a search query, a voice transcript tail, etc). */
  payload?: string;
  /** Optional target context (e.g. the notification id being snoozed). */
  contextId?: string;
}

/** A palette/quick-action/context-menu entry the UI renders, backed by a CommandId. */
export interface CommandDescriptor {
  id: CommandId;
  title: string;
  /** Grouping for the palette / menu. */
  group:
    | 'Navigate'
    | 'Search'
    | 'Create'
    | 'Organization'
    | 'Mission Brief'
    | 'Engineering'
    | 'Voice'
    | 'Notification';
  /** Keywords for palette fuzzy-matching (reuses the existing palette's filter). */
  keywords: string[];
  /** Optional keyboard shortcut hint (e.g. "⌘⇧F"). */
  shortcut?: string;
}
