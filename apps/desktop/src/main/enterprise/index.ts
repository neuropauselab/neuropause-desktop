/**
 * Enterprise Operating System composition root. Loads the organization runtime,
 * the workspace manager, and the governance store; binds the seeded owner to the
 * signed-in account; folds the live AI workforce into the org chart; and wires
 * every enterprise IPC channel behind the secure bridge.
 *
 * The org graph, compliance findings, and executive snapshot are *projections* —
 * recomputed on demand from the runtime plus the existing intelligence,
 * workforce, connector, and unified layers. Nothing here is fabricated.
 */
import type { EntityRef, ConnectorRef } from './graph/orgGraph';
import type {
  EnterpriseOrgCreateUnitRequest as TCreateUnit,
  EnterpriseOrgUpdateUnitRequest as TUpdateUnit,
  EnterpriseOrgDeleteUnitRequest as TDeleteUnit,
  EnterpriseOrgCreateUserRequest as TCreateUser,
  EnterpriseOrgUpdateUserRequest as TUpdateUser,
  EnterpriseOrgDeleteUserRequest as TDeleteUser,
  EnterpriseOrgCreateRoleRequest as TCreateRole,
  EnterpriseOrgUpdateRoleRequest as TUpdateRole,
  EnterpriseOrgDeleteRoleRequest as TDeleteRole,
  EnterpriseWorkspaceCreateRequest as TWsCreate,
  EnterpriseWorkspaceSwitchRequest as TWsSwitch,
  EnterpriseGraphNeighborsRequest as TNeighbors,
  EnterpriseGovernanceSetChainRequest as TSetChain,
  EnterpriseGovernanceSetRuleRequest as TSetRule,
  EnterpriseGovernanceAuditRequest as TAudit,
  AuthStatus,
  EnterprisePermission,
  Organization,
  PlatformEventInput,
  WorkspaceSummary,
  GovernanceConfig,
  BusinessActivitySummary,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  EnterpriseOrgCreateUnitRequest,
  EnterpriseOrgUpdateUnitRequest,
  EnterpriseOrgDeleteUnitRequest,
  EnterpriseOrgCreateUserRequest,
  EnterpriseOrgUpdateUserRequest,
  EnterpriseOrgDeleteUserRequest,
  EnterpriseOrgCreateRoleRequest,
  EnterpriseOrgUpdateRoleRequest,
  EnterpriseOrgDeleteRoleRequest,
  EnterpriseWorkspaceCreateRequest,
  EnterpriseWorkspaceSwitchRequest,
  EnterpriseGraphNeighborsRequest,
  EnterpriseGovernanceSetChainRequest,
  EnterpriseGovernanceSetRuleRequest,
  EnterpriseGovernanceAuditRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { orgStore } from './org/orgInstance';
import { workspaceStore } from './workspace/workspaceInstance';
import { governanceStore } from './governance/governanceInstance';
import { OWNER_USER_ID, ROLE_TO_UNIT_ID } from './org/seed';
import {
  canDeleteMember,
  createAuthorize,
  guardBuiltInRolePatch,
  guardOwnerUserPatch,
  withEnterpriseAuthz,
} from './authzGate';
import { initEnterpriseModules, type EnterpriseModuleRegistry } from './framework';
import { invoiceModule } from './modules/finance/invoiceModuleInstance';
import { paymentModule } from './modules/finance/paymentModuleInstance';
import { contactModule } from './modules/crm/contactModuleInstance';
import { leadModule } from './modules/crm/leadModuleInstance';
import { customerModule } from './modules/crm/customerModuleInstance';
import { quoteModule } from './modules/sales/quoteModuleInstance';
import { orderModule } from './modules/sales/orderModuleInstance';
import { productModule } from './modules/inventory/productModuleInstance';
import { warehouseModule } from './modules/inventory/warehouseModuleInstance';
import { stockMovementModule } from './modules/inventory/stockMovementModuleInstance';
import { notificationScheduler } from '../services/notificationScheduler';
import { buildOrgGraph, orgGraphNeighbors } from './graph/orgGraph';
import { evaluateCompliance, type ComplianceInput } from './governance/enterpriseGovernance';
import { computeExecutiveSnapshot } from './dashboard/executiveDashboard';
import { authService } from '../auth/authService';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { auditLog } from '../workforce/governance/auditInstance';
import { unifiedStore } from '../unified/storeInstance';
import { getEnterpriseTimeline } from '../timeline';
import { connectorService } from '../connectors/connectorService';
import { registry } from '../registry/registry';
import { generateBriefing } from '../intelligence/briefingGenerator';
import { generateRecommendations } from '../recommendations/recommendationEngine';

const log = createLogger('enterprise');

export interface EnterpriseDeps {
  broadcast: (channel: string, payload: unknown) => void;
  /** Platform event publisher → timeline + Executive Center (module lifecycle). */
  publish?: (input: PlatformEventInput) => void;
}

export interface EnterpriseSubsystem {
  handlers: SecureHandlerDef[];
  /** RBAC gate for the secure bridge — resolves the session actor and asserts. */
  authorize: (permission: EnterprisePermission) => void;
  /** The ERP module registry — future modules register into this at boot. */
  modules: EnterpriseModuleRegistry;
}

export async function initEnterprise(deps: EnterpriseDeps): Promise<EnterpriseSubsystem> {
  await orgStore.load();
  await workspaceStore.load();
  await governanceStore.load();

  // Bind the seeded owner to the signed-in account — at boot (restored session)
  // and on every later sign-in, since a fresh login lands after this init ran.
  const bindOwner = (status: AuthStatus): void => {
    if (status.state !== 'authenticated') return;
    const u = status.session.user;
    const name = u.displayName ?? u.email;
    const owner = orgStore.user(OWNER_USER_ID);
    if (owner && owner.name === name && owner.email === u.email) return; // already bound
    orgStore.setOwnerIdentity(name, u.email);
  };
  bindOwner(authService.getStatus());
  authService.on('statusChanged', bindOwner);

  // Fold the live AI workforce into the org chart, and keep it in sync.
  const syncWorkers = (): void => {
    const refs = workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name, role: w.role }));
    orgStore.syncWorkers(refs, ROLE_TO_UNIT_ID);
  };
  syncWorkers();
  workerRegistry.on('changed', syncWorkers);

  // Bridge store changes to the renderer as one enterprise event.
  const emit = (kind: string): void =>
    deps.broadcast(IpcChannel.EnterpriseEventBroadcast, { kind, at: new Date().toISOString() });
  orgStore.on('changed', () => emit('org'));
  workspaceStore.on('changed', () => emit('workspace'));
  governanceStore.on('changed', () => emit('governance'));

  log.info('Enterprise OS ready', {
    org: orgStore.defaultOrg().name,
    units: orgStore.unitsFor(orgStore.defaultOrg().id).length,
    members: orgStore.usersFor(orgStore.defaultOrg().id).length,
    workspaces: workspaceStore.list().length,
  });

  // RBAC: resolve the signed-in session to an org member and enforce the
  // per-channel permissions declared in authzGate on every enterprise call.
  const sessionEmail = (): string | null => {
    const st = authService.getStatus();
    return st.state === 'authenticated' ? st.session.user.email : null;
  };
  const authorize = createAuthorize({
    sessionEmail,
    activeOrgId: () => activeOrg().id,
    usersFor: (orgId) => orgStore.usersFor(orgId),
    rolesFor: (orgId) => orgStore.rolesFor(orgId),
    ownerMember: () => orgStore.user(OWNER_USER_ID),
  });

  // Enterprise Module Framework: the reusable ERP foundation. Every module
  // registered into this registry inherits RBAC, audit, timeline events,
  // renderer broadcasts, and the generic CRUD IPC surface — nothing per-module.
  const modules = initEnterpriseModules({
    authorize,
    audit: (e) => audit(e.action, e.target, e.summary),
    publish: deps.publish,
    broadcast: deps.broadcast,
    notify: (title, body) => notificationScheduler.notifyNow(title, body),
    actor: sessionEmail,
    now: () => new Date().toISOString(),
  });
  // ERP modules built on the foundation (each: descriptor + store + AI hook).
  modules.registry.register(invoiceModule); // Finance → Invoices
  modules.registry.register(contactModule); // CRM → Contacts
  modules.registry.register(leadModule); // CRM → Leads
  modules.registry.register(customerModule); // CRM → Customers
  modules.registry.register(quoteModule); // Sales → Quotes
  modules.registry.register(orderModule); // Sales → Orders (conversion target)
  modules.registry.register(paymentModule); // Finance → Payments
  modules.registry.register(productModule); // Inventory → Products
  modules.registry.register(warehouseModule); // Inventory → Warehouses
  modules.registry.register(stockMovementModule); // Inventory → Stock Movements (ledger)
  await Promise.all([
    invoiceModule.store.load(),
    contactModule.store.load(),
    leadModule.store.load(),
    customerModule.store.load(),
    quoteModule.store.load(),
    orderModule.store.load(),
    paymentModule.store.load(),
    productModule.store.load(),
    warehouseModule.store.load(),
    stockMovementModule.store.load(),
  ]);

  return {
    handlers: [...withEnterpriseAuthz(buildHandlers()), ...modules.handlers],
    authorize,
    modules: modules.registry,
  };
}

/* ── shared helpers ── */

function activeOrg(): Organization {
  const ws = workspaceStore.active();
  return orgStore.organization(ws.organizationId) ?? orgStore.defaultOrg();
}

function orgBundle(): {
  organization: Organization;
  units: ReturnType<typeof orgStore.unitsFor>;
  roles: ReturnType<typeof orgStore.rolesFor>;
  users: ReturnType<typeof orgStore.usersFor>;
} {
  const org = activeOrg();
  return {
    organization: org,
    units: orgStore.unitsFor(org.id),
    roles: orgStore.rolesFor(org.id),
    users: orgStore.usersFor(org.id),
  };
}

function actorName(): string {
  const st = authService.getStatus();
  return st.state === 'authenticated'
    ? (st.session.user.displayName ?? st.session.user.email)
    : 'owner';
}

function audit(action: string, target: string, summary: string): void {
  governanceStore.record({
    actor: actorName(),
    action,
    target,
    summary,
    workspaceId: workspaceStore.activeWorkspaceId(),
  });
}

function mapEntities(): EntityRef[] {
  const items = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const out: EntityRef[] = [];
  for (const e of items) {
    if (e.kind === 'project')
      out.push({ id: e.id, kind: 'project', title: e.title, connectorId: e.connectorId });
    else if (e.kind === 'document' || e.kind === 'file')
      out.push({ id: e.id, kind: 'document', title: e.title, connectorId: e.connectorId });
    else if (e.kind === 'organization' || e.kind === 'contact')
      out.push({ id: e.id, kind: 'customer', title: e.title, connectorId: e.connectorId });
  }
  return out;
}

function connectorRefs(): ConnectorRef[] {
  return connectorService.list().map((c) => ({ id: c.id, name: c.name }));
}

function buildGraph(): ReturnType<typeof buildOrgGraph> {
  const org = activeOrg();
  return buildOrgGraph({
    org,
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    entities: mapEntities(),
    connectors: connectorRefs(),
  });
}

function buildComplianceInput(): ComplianceInput {
  const org = activeOrg();
  const jobs = jobStore.page({ limit: 500 }).jobs;
  return {
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    workers: workerRegistry
      .summaries()
      .map((w) => ({ id: w.id, name: w.name, healthState: w.healthState })),
    jobs: jobs.map((j) => ({
      id: j.id,
      proposals: j.proposals.map((p) => ({
        id: p.id,
        verdict: { decision: p.verdict.decision },
        approval: p.approval,
      })),
    })),
    auditCount: auditLog.size() + governanceStore.auditCount(),
    jobsRun: jobStore.size(),
    approvalChains: governanceStore.chains(),
  };
}

function governanceConfig(): GovernanceConfig {
  const org = activeOrg();
  return {
    roles: orgStore.rolesFor(org.id),
    approvalChains: governanceStore.chains(),
    complianceRules: governanceStore.rules(),
  };
}

function workspaceSummaries(): WorkspaceSummary[] {
  const active = workspaceStore.activeWorkspaceId();
  return workspaceStore.list().map((ws) => {
    const org = orgStore.organization(ws.organizationId);
    const orgId = org?.id ?? ws.organizationId;
    return {
      id: ws.id,
      name: ws.name,
      organizationId: ws.organizationId,
      orgName: org?.name ?? 'Unknown',
      userCount: orgStore.usersFor(orgId).length,
      unitCount: orgStore.unitsFor(orgId).length,
      active: ws.id === active,
    };
  });
}

function computeActivity(now: string): BusinessActivitySummary {
  const items = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  let projects = 0;
  let tasks = 0;
  let documents = 0;
  let customers = 0;
  let events = 0;
  for (const e of items) {
    if (e.kind === 'project') projects += 1;
    else if (e.kind === 'task') tasks += 1;
    else if (e.kind === 'document' || e.kind === 'file') documents += 1;
    else if (e.kind === 'organization' || e.kind === 'contact') customers += 1;
    else if (e.kind === 'event' || e.kind === 'calendar_event') events += 1;
  }
  const tl = getEnterpriseTimeline();
  const timeline = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const cutoff = new Date(now).getTime() - 24 * 60 * 60 * 1000;
  const recentEvents = timeline.filter((t) => new Date(t.at).getTime() >= cutoff).length;
  return { projects, tasks, documents, customers, events, recentEvents };
}

function buildSnapshot(): ReturnType<typeof computeExecutiveSnapshot> {
  const now = new Date().toISOString();
  const org = activeOrg();
  const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const tl = getEnterpriseTimeline();
  const events = tl ? tl.query({ limit: 2000, order: 'desc' }).entries : [];
  const briefing = generateBriefing('morning', { entities, events, now });
  const recommendations = generateRecommendations({ entities, events, now });
  const rules = governanceStore.rules();
  const stats = connectorService.stats();
  return computeExecutiveSnapshot({
    workspaceId: workspaceStore.activeWorkspaceId(),
    org,
    units: orgStore.unitsFor(org.id),
    users: orgStore.usersFor(org.id),
    workers: workerRegistry.summaries(),
    jobs: jobStore.page({ limit: 500 }).jobs,
    findings: evaluateCompliance(rules, buildComplianceInput()),
    recommendations,
    briefingHeadline: briefing.headline,
    briefingGrounded: briefing.grounded,
    activity: computeActivity(now),
    operations: {
      connectors: stats.total,
      connectedAccounts: stats.accounts,
      installedApps: registry.list().length,
      auditEntries: auditLog.size() + governanceStore.auditCount(),
    },
    now,
  });
}

/* ── handlers ── */

function buildHandlers(): SecureHandlerDef[] {
  return [
    { channel: IpcChannel.EnterpriseOrgGet, schema: EmptyRequest, handler: () => orgBundle() },

    {
      channel: IpcChannel.EnterpriseOrgCreateUnit,
      schema: EnterpriseOrgCreateUnitRequest,
      audit: true,
      handler: (p) => {
        const r = p as TCreateUnit;
        const unit = orgStore.createUnit({
          orgId: activeOrg().id,
          kind: r.kind,
          name: r.name,
          parentId: r.parentId ?? null,
          leadUserId: r.leadUserId ?? null,
        });
        audit('unit.create', unit.id, `Created ${r.kind.replace('_', ' ')} "${r.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgUpdateUnit,
      schema: EnterpriseOrgUpdateUnitRequest,
      audit: true,
      handler: (p) => {
        const r = p as TUpdateUnit;
        const unit = orgStore.updateUnit(r.id, {
          name: r.name,
          parentId: r.parentId,
          leadUserId: r.leadUserId,
        });
        if (unit) audit('unit.update', unit.id, `Updated unit "${unit.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgDeleteUnit,
      schema: EnterpriseOrgDeleteUnitRequest,
      audit: true,
      handler: (p) => {
        const r = p as TDeleteUnit;
        const ok = orgStore.deleteUnit(r.id);
        if (ok) audit('unit.delete', r.id, 'Deleted unit');
        return orgBundle();
      },
    },

    {
      channel: IpcChannel.EnterpriseOrgCreateUser,
      schema: EnterpriseOrgCreateUserRequest,
      audit: true,
      handler: (p) => {
        const r = p as TCreateUser;
        const user = orgStore.createUser({
          orgId: activeOrg().id,
          name: r.name,
          email: r.email ?? null,
          title: r.title ?? 'Member',
          unitId: r.unitId ?? null,
          roleIds: r.roleIds ?? [],
        });
        audit('user.create', user.id, `Added member "${r.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgUpdateUser,
      schema: EnterpriseOrgUpdateUserRequest,
      audit: true,
      handler: (p) => {
        const r = p as TUpdateUser;
        // Root of trust: the seeded owner's roles/status are immutable.
        const patch = guardOwnerUserPatch(r.id, OWNER_USER_ID, {
          name: r.name,
          email: r.email,
          title: r.title,
          unitId: r.unitId,
          roleIds: r.roleIds,
          status: r.status,
        });
        const user = orgStore.updateUser(r.id, patch);
        if (user) audit('user.update', user.id, `Updated member "${user.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgDeleteUser,
      schema: EnterpriseOrgDeleteUserRequest,
      audit: true,
      handler: (p) => {
        const r = p as TDeleteUser;
        // Root of trust: the seeded owner can never be removed.
        const ok = canDeleteMember(r.id, OWNER_USER_ID) && orgStore.deleteUser(r.id);
        if (ok) audit('user.delete', r.id, 'Removed member');
        return orgBundle();
      },
    },

    {
      channel: IpcChannel.EnterpriseOrgCreateRole,
      schema: EnterpriseOrgCreateRoleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TCreateRole;
        const role = orgStore.createRole({
          orgId: activeOrg().id,
          name: r.name,
          description: r.description ?? '',
          permissions: r.permissions,
        });
        audit('role.create', role.id, `Created role "${r.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgUpdateRole,
      schema: EnterpriseOrgUpdateRoleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TUpdateRole;
        // Built-in roles keep their calibrated permissions (Owner = all).
        const patch = guardBuiltInRolePatch(orgStore.role(r.id), {
          name: r.name,
          description: r.description,
          permissions: r.permissions,
        });
        const role = orgStore.updateRole(r.id, patch);
        if (role) audit('role.update', role.id, `Updated role "${role.name}"`);
        return orgBundle();
      },
    },
    {
      channel: IpcChannel.EnterpriseOrgDeleteRole,
      schema: EnterpriseOrgDeleteRoleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TDeleteRole;
        const ok = orgStore.deleteRole(r.id);
        if (ok) audit('role.delete', r.id, 'Deleted role');
        return orgBundle();
      },
    },

    {
      channel: IpcChannel.EnterpriseWorkspaceList,
      schema: EmptyRequest,
      handler: () => workspaceSummaries(),
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceActive,
      schema: EmptyRequest,
      handler: () => workspaceStore.active(),
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceCreate,
      schema: EnterpriseWorkspaceCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as TWsCreate;
        const ws = workspaceStore.create(r.name, r.organizationId ?? activeOrg().id);
        audit('workspace.create', ws.id, `Created workspace "${r.name}"`);
        return workspaceSummaries();
      },
    },
    {
      channel: IpcChannel.EnterpriseWorkspaceSwitch,
      schema: EnterpriseWorkspaceSwitchRequest,
      audit: true,
      handler: (p) => {
        const r = p as TWsSwitch;
        const ws = workspaceStore.switch(r.id);
        if (ws) audit('workspace.switch', ws.id, `Switched to workspace "${ws.name}"`);
        return workspaceStore.active();
      },
    },

    { channel: IpcChannel.EnterpriseGraph, schema: EmptyRequest, handler: () => buildGraph() },
    {
      channel: IpcChannel.EnterpriseGraphNeighbors,
      schema: EnterpriseGraphNeighborsRequest,
      handler: (p) => orgGraphNeighbors(buildGraph(), (p as TNeighbors).id),
    },

    {
      channel: IpcChannel.EnterpriseGovernanceConfig,
      schema: EmptyRequest,
      handler: () => governanceConfig(),
    },
    {
      channel: IpcChannel.EnterpriseGovernanceCompliance,
      schema: EmptyRequest,
      handler: () => evaluateCompliance(governanceStore.rules(), buildComplianceInput()),
    },
    {
      channel: IpcChannel.EnterpriseGovernanceSetChain,
      schema: EnterpriseGovernanceSetChainRequest,
      audit: true,
      handler: (p) => {
        const r = p as TSetChain;
        const c = governanceStore.setChainEnabled(r.id, r.enabled);
        if (c)
          audit(
            'governance.chain',
            c.id,
            `${r.enabled ? 'Enabled' : 'Disabled'} approval chain "${c.name}"`,
          );
        return governanceStore.chains();
      },
    },
    {
      channel: IpcChannel.EnterpriseGovernanceSetRule,
      schema: EnterpriseGovernanceSetRuleRequest,
      audit: true,
      handler: (p) => {
        const r = p as TSetRule;
        const rule = governanceStore.setRuleEnabled(r.id, r.enabled);
        if (rule)
          audit(
            'governance.rule',
            rule.id,
            `${r.enabled ? 'Enabled' : 'Disabled'} compliance rule "${rule.name}"`,
          );
        return governanceStore.rules();
      },
    },
    {
      channel: IpcChannel.EnterpriseGovernanceAudit,
      schema: EnterpriseGovernanceAuditRequest,
      handler: (p) => governanceStore.auditEntries((p as TAudit).limit ?? 100),
    },

    {
      channel: IpcChannel.EnterpriseDashboard,
      schema: EmptyRequest,
      handler: () => buildSnapshot(),
    },
  ];
}
