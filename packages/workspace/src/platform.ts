/**
 * Workspace Platform composition root (NCEA 10.5, Phase 9).
 * `createWorkspacePlatform(runtime, { aiRuntime?, connectorPlatform? })` assembles
 * the organization, identity, workforce, task, inbox, knowledge, collaboration,
 * and dashboard subsystems onto an EXISTING Enterprise Runtime — sharing its one
 * event bus, audit chain, timeline, and scheduler through one WorkspaceGovernance.
 * The AI runtime (when provided) is where AI employees actually execute; the
 * connector platform (when provided) feeds connector health into the dashboard.
 * No new runtime, no new identity model, no new permission model.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { AiRuntime } from '@neuropause/ai-runtime';
import type { ConnectorPlatform } from '@neuropause/connectors';
import { WORKSPACE_VERSION } from './constants';
import { WorkspaceGovernance } from './governance';
import { OrganizationRegistry, type OrgNode } from './organization';
import { WorkspaceRegistry } from './workspaceRegistry';
import { ProjectRegistry } from './project';
import { IdentityDirectory, type Principal } from './identity';
import { DigitalWorkforce, aiRuntimeExecutor } from './workforce';
import { TaskBoard } from './tasks';
import { UniversalInbox } from './inbox';
import { KnowledgeGraph } from './knowledge';
import { CollaborationHub } from './collaboration';
import { ExecutiveDashboard } from './dashboard';

export interface WorkspacePlatformOptions {
  clock?: Clock;
  aiRuntime?: AiRuntime;
  connectorPlatform?: ConnectorPlatform;
}

/** Team-focused facade over the ONE org hierarchy + ONE identity model. */
export interface TeamDirectory {
  list(): OrgNode[];
  get(id: string): OrgNode | undefined;
  create(name: string, parentId: string, actor?: string): Promise<OrgNode>;
  members(teamId: string): Principal[];
  addMember(teamId: string, principalId: string, roleIds?: string[], actor?: string): Promise<void>;
}

export interface WorkspacePlatform {
  version: string;
  workspace(): WorkspaceRegistry;
  organizations(): OrganizationRegistry;
  teams(): TeamDirectory;
  projects(): ProjectRegistry;
  tasks(): TaskBoard;
  inbox(): UniversalInbox;
  knowledge(): KnowledgeGraph;
  workforce(): DigitalWorkforce;
  dashboard(): ExecutiveDashboard;
  collaboration(): CollaborationHub;
  identity(): IdentityDirectory;
  governance(): WorkspaceGovernance;
}

export function createWorkspacePlatform(
  runtime: EnterpriseRuntime,
  options: WorkspacePlatformOptions = {},
): WorkspacePlatform {
  const clock = options.clock ?? systemClock;
  const governance = new WorkspaceGovernance(runtime, clock);

  const organizations = new OrganizationRegistry(clock, governance);
  const workspaces = new WorkspaceRegistry(clock, governance);
  const projects = new ProjectRegistry(clock, governance);
  const identity = new IdentityDirectory(clock, governance);
  const workforce = new DigitalWorkforce(
    runtime,
    identity,
    governance,
    clock,
    options.aiRuntime ? aiRuntimeExecutor(options.aiRuntime) : undefined,
  );
  const tasks = new TaskBoard(clock, governance);
  const inbox = new UniversalInbox(runtime, clock);
  const knowledge = new KnowledgeGraph(clock, governance);
  const collaboration = new CollaborationHub(clock, governance);

  const dashboard = new ExecutiveDashboard({
    runtime,
    governance,
    organizations,
    workspaces,
    projects,
    identity,
    workforce,
    tasks,
    inbox,
    knowledge,
    ...(options.connectorPlatform ? { connectorHealth: () => options.connectorPlatform!.connectorHealth() } : {}),
  });

  const teams: TeamDirectory = {
    list: () => organizations.list('team'),
    get: (id) => organizations.get(id),
    create: (name, parentId, actor) => organizations.create({ type: 'team', name, parentId, ...(actor ? { actor } : {}) }),
    members: (teamId) => identity.members('team', teamId),
    addMember: async (teamId, principalId, roleIds, actor) => {
      await identity.addMembership(principalId, 'team', teamId, roleIds ?? [], actor ?? 'system');
    },
  };

  return {
    version: WORKSPACE_VERSION,
    workspace: () => workspaces,
    organizations: () => organizations,
    teams: () => teams,
    projects: () => projects,
    tasks: () => tasks,
    inbox: () => inbox,
    knowledge: () => knowledge,
    workforce: () => workforce,
    dashboard: () => dashboard,
    collaboration: () => collaboration,
    identity: () => identity,
    governance: () => governance,
  };
}
