/**
 * @neuropause/workplace — NEMS Wave 10 Enterprise Workspace & Digital Workplace Platform. Composes
 * Waves 1-9 (unchanged) into the daily digital workplace for employees: universal workspaces,
 * navigation, a unified inbox, documents, a knowledge platform, notes, tasks, calendar, chat,
 * meetings, whiteboard, files, forms, workspace AI, a command center, workspace automation,
 * dashboards, a marketplace, a workspace SDK, desktop/mobile experience, and a design system —
 * every service composed on the existing platform without duplicating functionality.
 *
 * NOTE: this package is `@neuropause/workplace` (packages/workplace). The base package
 * `@neuropause/workspace` already exists and is left untouched — Wave 10 is purely additive.
 *
 * Workspace runtimes/documents/knowledge/notes/tasks/calendar/chat/whiteboard/file-metadata/forms/
 * AI/command/automation/dashboards/marketplace/SDK/design-system are LIVE-VERIFIED in-process;
 * email/calendar/video/storage/messaging providers and desktop/mobile capabilities are
 * ADAPTER-VERIFIED until configured; real documents/chats/meetings/notes/knowledge/files are
 * BUSINESS-DATA-PENDING (registries start empty; never fabricated); and legal retention, government
 * archiving, compliance exports, and real email/video/storage/messaging infrastructure are
 * REGULATED-EXTERNAL and never executed or claimed. Every workspace operation is audited on the one
 * chain with a replay id and evidence level.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './governance';
export * from './providers';
export * from './workspaces';
export * from './navigation';
export * from './inbox';
export * from './documents';
export * from './knowledge';
export * from './notes';
export * from './tasks';
export * from './calendar';
export * from './collaboration';
export * from './meetings';
export * from './files';
export * from './forms';
export * from './ai';
export * from './command';
export * from './automation';
export * from './dashboards';
export * from './marketplace';
export * from './sdk';
export * from './experience';
export * from './platform';
