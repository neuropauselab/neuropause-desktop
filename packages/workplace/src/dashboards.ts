/**
 * Module 17 — Enterprise Dashboard. Employee / manager / executive / department / organization
 * dashboards plus personal analytics, composed ONLY from real registries. Any panel with no data
 * shows 'No business data available' — nothing is fabricated.
 */
import { NO_WORKSPACE_DATA, type DashboardRole } from './constants';
import type { WorkspaceTasks } from './tasks';
import type { DocumentRuntime } from './documents';
import type { KnowledgePlatform } from './knowledge';
import type { UnifiedInbox } from './inbox';
import type { NoteRuntime } from './notes';
import type { BusinessPlatform } from './types';

export interface WorkspaceDashboard {
  role: DashboardRole;
  panels: Record<string, number | string>;
  note: string;
}

export interface DashboardDeps {
  tasks: WorkspaceTasks;
  documents: DocumentRuntime;
  knowledge: KnowledgePlatform;
  inbox: UnifiedInbox;
  notes: NoteRuntime;
  business?: BusinessPlatform;
}

const orNoData = (count: number, value: number): number | string => (count > 0 ? value : NO_WORKSPACE_DATA);

export class WorkspaceDashboards {
  constructor(private readonly deps: DashboardDeps) {}

  build(role: DashboardRole): WorkspaceDashboard {
    const tasks = this.deps.tasks.count();
    const documents = this.deps.documents.count();
    const knowledge = this.deps.knowledge.count();
    const notes = this.deps.notes.count();
    const inbox = this.deps.inbox.count();
    const panels: Record<string, number | string> = {
      tasks: orNoData(tasks, tasks),
      documents: orNoData(documents, documents),
      knowledgeArticles: orNoData(knowledge, knowledge),
      notes: orNoData(notes, notes),
      inboxItems: orNoData(inbox, inbox),
    };
    if (role === 'executive' || role === 'organization') {
      const customers = this.deps.business ? this.deps.business.crm().counts().accounts : 0;
      panels['businessCustomers'] = orNoData(customers, customers);
    }
    return { role, panels, note: "panels reflect real in-process registries only; empty panels show 'No business data available'" };
  }
}
