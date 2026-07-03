/**
 * The Unified Query Engine — the one API every future module queries.
 *
 * `findProjects()`, `findTasks()`, `findConversations()` … all resolve against
 * the unified store, so callers (Activity Intelligence, AI Memory, Automation,
 * Daily Summary, Analytics) never know — or care — which connector owns a
 * record. Each finder is a thin, typed projection over `query` with the kind
 * fixed; the full `UnifiedQuery` is available for advanced filtering.
 */
import type { UnifiedEntityKind, UnifiedQuery, UnifiedQueryResult } from '@neuropause/shared';
import { unifiedStore } from './storeInstance';

/** A finder's options: any query filter except `kinds` (which the finder sets). */
export type FindOptions = Omit<UnifiedQuery, 'kinds'>;

function find(kind: UnifiedEntityKind, opts: FindOptions = {}): UnifiedQueryResult {
  return unifiedStore.query({ ...opts, kinds: [kind] });
}

export const unifiedQuery = {
  /** Generic structured query (all kinds / advanced filters). */
  query: (q: UnifiedQuery): UnifiedQueryResult => unifiedStore.query(q),

  findProjects: (o?: FindOptions): UnifiedQueryResult => find('project', o),
  findTasks: (o?: FindOptions): UnifiedQueryResult => find('task', o),
  findDocuments: (o?: FindOptions): UnifiedQueryResult => find('document', o),
  findFiles: (o?: FindOptions): UnifiedQueryResult => find('file', o),
  findConversations: (o?: FindOptions): UnifiedQueryResult => find('conversation', o),
  findMessages: (o?: FindOptions): UnifiedQueryResult => find('message', o),
  findNotifications: (o?: FindOptions): UnifiedQueryResult => find('notification', o),
  findCalendarEvents: (o?: FindOptions): UnifiedQueryResult => find('calendar_event', o),
  findEvents: (o?: FindOptions): UnifiedQueryResult => find('event', o),
  findActivities: (o?: FindOptions): UnifiedQueryResult => find('activity', o),
  findContacts: (o?: FindOptions): UnifiedQueryResult => find('contact', o),
  findLabels: (o?: FindOptions): UnifiedQueryResult => find('label', o),
  findWorkspaces: (o?: FindOptions): UnifiedQueryResult => find('workspace', o),
  findOrganizations: (o?: FindOptions): UnifiedQueryResult => find('organization', o),
  findAccounts: (o?: FindOptions): UnifiedQueryResult => find('account', o),
  findAttachments: (o?: FindOptions): UnifiedQueryResult => find('attachment', o),
};
