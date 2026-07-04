/**
 * Unified Interaction Router + Registry (V2.8).
 *
 * PURE core: one registry of commands (the single source of truth for the command
 * palette, quick actions, and context menus) and one router that resolves any
 * UnifiedCommand — regardless of source — into a CommandResolution the shell runs
 * with EXISTING services. Also adapts voice output (V2.6 VoiceResponse) into the
 * same model, so voice and palette share one pipeline. No new search, palette, or
 * governance is created here.
 */
import type {
  CommandDescriptor,
  CommandId,
  CommandResolution,
  UnifiedCommand,
  VoiceResponse,
} from '@neuropause/shared';

/** The command registry — every command the app exposes, in one place. */
export const COMMAND_REGISTRY: CommandDescriptor[] = [
  // Navigate
  {
    id: 'open.founder',
    title: 'Open Founder AI',
    group: 'Navigate',
    keywords: ['founder', 'ai', 'ask'],
    shortcut: '⌘⇧F',
  },
  {
    id: 'open.mission-brief',
    title: 'Open Mission Brief',
    group: 'Navigate',
    keywords: ['brief', 'mission', 'priorities'],
  },
  {
    id: 'open.engineering',
    title: 'Open Engineering Dashboard',
    group: 'Navigate',
    keywords: ['engineering', 'eng', 'dashboard'],
  },
  {
    id: 'open.organization',
    title: 'Open Organization',
    group: 'Navigate',
    keywords: ['organization', 'org', 'company'],
  },
  {
    id: 'open.memory',
    title: 'Open AI Memory',
    group: 'Navigate',
    keywords: ['memory', 'remember', 'history'],
  },
  {
    id: 'open.notifications',
    title: 'Open Notifications',
    group: 'Navigate',
    keywords: ['notifications', 'alerts'],
  },
  {
    id: 'open.executive-center',
    title: 'Open Executive Center',
    group: 'Navigate',
    keywords: ['executive', 'center', 'dashboard'],
  },
  // Search (reuses the existing enterprise search)
  {
    id: 'search.organizations',
    title: 'Search Organizations',
    group: 'Search',
    keywords: ['search', 'organization', 'find org'],
  },
  {
    id: 'search.memory',
    title: 'Search Memory',
    group: 'Search',
    keywords: ['search', 'memory', 'find'],
  },
  {
    id: 'search.timeline',
    title: 'Search Timeline',
    group: 'Search',
    keywords: ['search', 'timeline', 'activity'],
  },
  // Create / actions (governed)
  {
    id: 'action.create-task',
    title: 'Create Task',
    group: 'Create',
    keywords: ['create', 'task', 'todo'],
  },
  {
    id: 'action.generate-report',
    title: 'Generate Report',
    group: 'Create',
    keywords: ['generate', 'report'],
  },
  {
    id: 'action.notify-team',
    title: 'Notify Team',
    group: 'Create',
    keywords: ['notify', 'team', 'message'],
  },
  // Voice
  {
    id: 'voice.start-session',
    title: 'Start Voice Session',
    group: 'Voice',
    keywords: ['voice', 'talk', 'speak', 'listen'],
    shortcut: '⌘⇧V',
  },
  // Contextual quick actions (STEP 4)
  {
    id: 'org.view-health',
    title: 'View Organization Health',
    group: 'Organization',
    keywords: ['health', 'organization'],
  },
  {
    id: 'org.notify-members',
    title: 'Notify Members',
    group: 'Organization',
    keywords: ['notify', 'members'],
  },
  {
    id: 'brief.explain',
    title: 'Explain Brief',
    group: 'Mission Brief',
    keywords: ['explain', 'brief'],
  },
  {
    id: 'brief.export',
    title: 'Export Brief',
    group: 'Mission Brief',
    keywords: ['export', 'brief'],
  },
  { id: 'brief.share', title: 'Share Brief', group: 'Mission Brief', keywords: ['share', 'brief'] },
  {
    id: 'eng.open-issue',
    title: 'Open Issue',
    group: 'Engineering',
    keywords: ['issue', 'open', 'bug'],
  },
  {
    id: 'eng.view-failures',
    title: 'View Failures',
    group: 'Engineering',
    keywords: ['failures', 'ci', 'broken'],
  },
  // Notification actions (STEP 5)
  { id: 'notification.snooze', title: 'Snooze', group: 'Notification', keywords: ['snooze'] },
  { id: 'notification.dismiss', title: 'Dismiss', group: 'Notification', keywords: ['dismiss'] },
  { id: 'notification.explain', title: 'Explain', group: 'Notification', keywords: ['explain'] },
];

/** Static resolution table: CommandId → how the shell executes it (existing services). */
const RESOLUTIONS: Record<CommandId, (cmd: UnifiedCommand) => CommandResolution> = {
  'open.founder': () => ({ kind: 'navigate', deepLink: 'ai-workforce/founder' }),
  'open.mission-brief': () => ({ kind: 'navigate', deepLink: 'enterprise/briefings' }),
  'open.engineering': () => ({ kind: 'navigate', deepLink: 'ai-workforce/engineering' }),
  'open.organization': () => ({ kind: 'navigate', deepLink: 'enterprise/organization' }),
  'open.memory': () => ({ kind: 'navigate', deepLink: 'memory' }),
  'open.notifications': () => ({ kind: 'navigate', deepLink: 'notifications' }),
  'open.executive-center': () => ({ kind: 'navigate', deepLink: 'enterprise/executive' }),

  'search.organizations': (c) => ({
    kind: 'search',
    deepLink: 'enterprise/organization',
    query: c.payload,
  }),
  'search.memory': (c) => ({ kind: 'search', deepLink: 'memory', query: c.payload }),
  'search.timeline': (c) => ({
    kind: 'search',
    deepLink: 'enterprise/organization',
    query: c.payload,
  }),

  'action.create-task': () => ({ kind: 'action', actionId: 'create-task', requiresApproval: true }),
  'action.generate-report': () => ({
    kind: 'action',
    actionId: 'generate-report',
    requiresApproval: true,
  }),
  'action.notify-team': () => ({ kind: 'action', actionId: 'notify-team', requiresApproval: true }),

  'voice.start-session': () => ({ kind: 'ui', uiEffect: 'open-voice' }),

  'org.view-health': () => ({
    kind: 'intelligence',
    intelligence: 'org-health',
    deepLink: 'enterprise/organization',
  }),
  'org.notify-members': () => ({ kind: 'action', actionId: 'notify-team', requiresApproval: true }),

  'brief.explain': () => ({
    kind: 'intelligence',
    intelligence: 'brief',
    deepLink: 'enterprise/briefings',
  }),
  'brief.export': () => ({ kind: 'action', actionId: 'export-brief', requiresApproval: false }),
  'brief.share': () => ({ kind: 'action', actionId: 'share-brief', requiresApproval: true }),

  'eng.open-issue': () => ({ kind: 'navigate', deepLink: 'ai-workforce/engineering' }),
  'eng.view-failures': () => ({ kind: 'navigate', deepLink: 'ai-workforce/engineering' }),

  'notification.snooze': (c) => ({
    kind: 'action',
    actionId: 'snooze',
    requiresApproval: false,
    deepLink: c.contextId,
  }),
  'notification.dismiss': (c) => ({
    kind: 'action',
    actionId: 'dismiss',
    requiresApproval: false,
    deepLink: c.contextId,
  }),
  'notification.explain': () => ({
    kind: 'intelligence',
    intelligence: 'founder',
    deepLink: 'notifications',
  }),
};

/** Resolve any UnifiedCommand to its execution plan. Pure + total (every id mapped). */
export function resolveCommand(cmd: UnifiedCommand): CommandResolution {
  return RESOLUTIONS[cmd.id](cmd);
}

/**
 * Adapt a voice response (V2.6) into the unified model, so a spoken turn resolves
 * through the SAME pipeline as a palette command. Voice already yields a deepLink
 * and/or an actionId; we map those to a CommandResolution without re-deriving them.
 */
export function voiceResponseToResolution(v: VoiceResponse): CommandResolution {
  if (v.actionId) {
    return {
      kind: 'action',
      actionId: v.actionId,
      requiresApproval: v.requiresApproval ?? true,
      deepLink: v.deepLink,
    };
  }
  if (v.deepLink) {
    return { kind: 'navigate', deepLink: v.deepLink };
  }
  return { kind: 'ui' }; // pure spoken answer, no navigation/action
}

/** Contextual quick actions for a given screen (STEP 4). Returns registry descriptors. */
export function quickActionsFor(section: string): CommandDescriptor[] {
  const ids: CommandId[] = (() => {
    switch (section) {
      case 'organization':
      case 'enterprise/organization':
        return ['org.view-health', 'action.generate-report', 'org.notify-members'];
      case 'briefings':
      case 'enterprise/briefings':
        return ['brief.explain', 'brief.export', 'brief.share'];
      case 'engineering':
      case 'ai-workforce/engineering':
        return ['eng.open-issue', 'eng.view-failures', 'action.notify-team'];
      case 'notifications':
        return ['notification.explain', 'notification.snooze', 'notification.dismiss'];
      default:
        return [];
    }
  })();
  return COMMAND_REGISTRY.filter((c) => ids.includes(c.id));
}

/** Fuzzy-ish keyword filter for the palette (reuses the existing palette's approach). */
export function filterCommands(queryText: string): CommandDescriptor[] {
  const q = queryText.trim().toLowerCase();
  if (!q) return COMMAND_REGISTRY;
  return COMMAND_REGISTRY.filter(
    (c) => c.title.toLowerCase().includes(q) || c.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}
