/**
 * Module 20 — Workspace APIs / composition root. `createWorkplacePlatform(runtime, …)` assembles
 * the Wave 10 digital workplace on the EXISTING platform: it reuses the one runtime audit chain +
 * event bus (workspace governance), the Wave 4 HITL gate (workspace approvals), the Wave 8 business
 * platform (global search, workspace AI, project tasks, dashboards), the Wave 9 industry platform
 * (low-code form builder), and — when provided — the Wave 5 execution platform (reused connector
 * count). No functionality is duplicated. Exposes the workspace.* API surface, the evidence matrix,
 * and readiness. (Package is `@neuropause/workplace`; the base `@neuropause/workspace` is untouched.)
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { HumanInTheLoopGate } from '@neuropause/automation';
import type { ExecutionPlatform } from '@neuropause/execution';
import type { BusinessPlatform, IndustryPlatform } from './types';
import { WORKPLACE_VERSION } from './constants';
import { WORKSPACE_MATRIX, workspaceReadiness, type CapabilityEvidence, type WorkspaceReadiness } from './evidence';
import { WorkspaceGovernance } from './governance';
import { ProviderRegistry } from './providers';
import { WorkspaceRuntime } from './workspaces';
import { NavigationRuntime } from './navigation';
import { UnifiedInbox } from './inbox';
import { DocumentRuntime } from './documents';
import { KnowledgePlatform } from './knowledge';
import { NoteRuntime } from './notes';
import { WorkspaceTasks } from './tasks';
import { CalendarRuntime } from './calendar';
import { ChatRuntime, WhiteboardRuntime } from './collaboration';
import { MeetingRuntime } from './meetings';
import { FileRuntime } from './files';
import { FormRuntime } from './forms';
import { WorkspaceAI } from './ai';
import { CommandCenter } from './command';
import { WorkspaceAutomation } from './automation';
import { WorkspaceDashboards } from './dashboards';
import { WorkspaceMarketplace } from './marketplace';
import { WorkspaceSDK } from './sdk';
import { ExperienceRuntime } from './experience';

export interface WorkplacePlatformOptions {
  clock?: Clock;
  business?: BusinessPlatform;
  industry?: IndustryPlatform;
  execution?: ExecutionPlatform;
}

export interface WorkplacePlatform {
  version: string;
  // workspace.* API surface (Module 20)
  notes(): NoteRuntime;
  documents(): DocumentRuntime;
  tasks(): WorkspaceTasks;
  calendar(): CalendarRuntime;
  chat(): ChatRuntime;
  meetings(): MeetingRuntime;
  files(): FileRuntime;
  forms(): FormRuntime;
  knowledge(): KnowledgePlatform;
  dashboard(): WorkspaceDashboards;
  ai(): WorkspaceAI;
  marketplace(): WorkspaceMarketplace;
  command(): CommandCenter;
  // additional accessors
  workspaces(): WorkspaceRuntime;
  navigation(): NavigationRuntime;
  inbox(): UnifiedInbox;
  whiteboard(): WhiteboardRuntime;
  automation(): WorkspaceAutomation;
  sdk(): WorkspaceSDK;
  experience(): ExperienceRuntime;
  providers(): ProviderRegistry;
  governance(): WorkspaceGovernance;
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): WorkspaceReadiness;
}

export function createWorkplacePlatform(runtime: EnterpriseRuntime, options: WorkplacePlatformOptions = {}): WorkplacePlatform {
  const clock = options.clock ?? systemClock;
  const governance = new WorkspaceGovernance(runtime, clock);
  const hitl = new HumanInTheLoopGate();

  const providers = new ProviderRegistry(governance);
  const workspaces = new WorkspaceRuntime(clock, governance);
  const navigation = new NavigationRuntime(governance, options.business);
  const inbox = new UnifiedInbox(clock, governance);
  const documents = new DocumentRuntime(clock, governance);
  const knowledge = new KnowledgePlatform(clock, governance);
  const notes = new NoteRuntime(clock, governance);
  const tasks = new WorkspaceTasks(clock, governance, options.business);
  const calendar = new CalendarRuntime(clock, governance);
  const chat = new ChatRuntime(clock, governance);
  const whiteboard = new WhiteboardRuntime(governance);
  const meetings = new MeetingRuntime(clock, governance);
  const files = new FileRuntime(clock, governance);
  const forms = new FormRuntime(clock, governance, options.industry);
  const ai = new WorkspaceAI(options.business);
  const command = new CommandCenter(governance, navigation, ai);
  const automation = new WorkspaceAutomation(governance, hitl);
  const dashboards = new WorkspaceDashboards({ tasks, documents, knowledge, inbox, notes, ...(options.business ? { business: options.business } : {}) });
  const marketplace = new WorkspaceMarketplace(clock, governance);
  const sdk = new WorkspaceSDK(clock, governance);
  const experience = new ExperienceRuntime(governance);

  return {
    version: WORKPLACE_VERSION,
    notes: () => notes,
    documents: () => documents,
    tasks: () => tasks,
    calendar: () => calendar,
    chat: () => chat,
    meetings: () => meetings,
    files: () => files,
    forms: () => forms,
    knowledge: () => knowledge,
    dashboard: () => dashboards,
    ai: () => ai,
    marketplace: () => marketplace,
    command: () => command,
    workspaces: () => workspaces,
    navigation: () => navigation,
    inbox: () => inbox,
    whiteboard: () => whiteboard,
    automation: () => automation,
    sdk: () => sdk,
    experience: () => experience,
    providers: () => providers,
    governance: () => governance,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => WORKSPACE_MATRIX,
    readiness: () => workspaceReadiness(),
  };
}
