/**
 * Enterprise Operating System — shared type contracts (Phase 7).
 *
 * The organizational layer that turns NeuroPause into an operating environment
 * for a whole company: an organization runtime (org → units → teams → people +
 * AI workers), a relationship graph, org-wide governance (roles, permissions,
 * approval chains, compliance), multi-workspace isolation, and the executive
 * snapshot that rolls every layer up into one live view.
 *
 * All timestamps are ISO-8601 strings. These are the wire shapes shared by the
 * main process and the renderer.
 */

/* ───────────────────────── Organization runtime ───────────────────────── */

/**
 * What kind of organization this is. Affects nothing about isolation — a
 * personal tenant is isolated exactly as hard as an enterprise one.
 */
export type OrganizationType = 'personal' | 'business' | 'enterprise';

/**
 * Whether the tenant may be operated at all.
 *
 * `suspended` and `archived` both deny. They are distinct so an operator can
 * tell "paused, will return" from "closed, kept for the record", and so a
 * future restore path has something to restore FROM. Permanent deletion is
 * deliberately not a state here.
 */
export type OrganizationStatus = 'active' | 'suspended' | 'archived';

/**
 * THE TENANT.
 *
 * This type is the security boundary. It is not a new concept and there is no
 * `Tenant` interface anywhere — `Organization` already drove every permission
 * decision in the app, so promoting it is the only change that puts the
 * boundary where authorization already happens. A parallel `Tenant` entity
 * would have created a second authority to disagree with this one.
 *
 * `id` is preserved across the upgrade, including the existing `org-default`.
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Short human description of what the org does. */
  description: string;
  /** Optional so a pre-P11 file parses; absent is read as `business`. */
  type?: OrganizationType;
  /** Optional so a pre-P11 file parses; absent is read as `active`. */
  status?: OrganizationStatus;
  /**
   * The protected owner of this tenant — the root-of-trust member the owner
   * guards key on (P13C round 40). For the seeded organization this is the
   * compile-time `OWNER_USER_ID`; for provisioned organizations it is recorded
   * once at provisioning (the creator) and never reassigned by member edits.
   * Optional so pre-round-40 files parse; absent rows are healed on load from
   * the provisioned owner's row where it is unambiguous.
   */
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

/** The declared type, with the pre-P11 default applied in one place. */
export function organizationType(org: Organization): OrganizationType {
  return org.type ?? 'business';
}

/**
 * The declared status, with the pre-P11 default applied in one place.
 *
 * Defaults to `active` rather than denying, because every existing install has
 * no status field and must keep working. New tenants are written with an
 * explicit status, so the default only ever applies to data that predates it.
 */
export function organizationStatus(org: Organization): OrganizationStatus {
  return org.status ?? 'active';
}

/** Whether this tenant may be operated. Suspended and archived both refuse. */
export function organizationIsOperable(org: Organization): boolean {
  return organizationStatus(org) === 'active';
}

/** The hierarchical levels of an org chart, from broadest to narrowest. */
export type OrgUnitKind = 'business_unit' | 'department' | 'team';

export const ORG_UNIT_KINDS: readonly OrgUnitKind[] = ['business_unit', 'department', 'team'];

/** A node in the org chart. Business units contain departments contain teams. */
export interface OrgUnit {
  id: string;
  orgId: string;
  kind: OrgUnitKind;
  name: string;
  /** Parent unit id, or null for a top-level business unit. */
  parentId: string | null;
  /** The user id of the unit's lead, if assigned. */
  leadUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Whether an org member is a person or one of the governed AI workers. */
export type OrgMemberKind = 'human' | 'ai_worker';

export type OrgUserStatus = 'active' | 'invited' | 'suspended';

export interface OrgUser {
  id: string;
  orgId: string;
  name: string;
  email: string | null;
  /** Job title for humans, or the worker role for AI workers. */
  title: string;
  kind: OrgMemberKind;
  /** For AI workers, the underlying worker id in the workforce registry. */
  workerId: string | null;
  /** The unit this member belongs to, if any. */
  unitId: string | null;
  roleIds: string[];
  /**
   * Which workspaces inside the tenant this member may operate in.
   *
   * ABSENT means every workspace in the tenant — which is what the app did
   * before P11 and what every existing member row means, so the upgrade
   * changes nobody's access. PRESENT means restricted to exactly this list.
   * An EMPTY array is not "all"; it is a member of the tenant with no
   * workspace, which denies.
   *
   * `orgId` above is the tenant membership. It already existed; nothing ever
   * consulted it as one, which is the gap P11 closes.
   */
  workspaceIds?: string[];
  status: OrgUserStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether a member may operate in a workspace of their own tenant.
 *
 * Deliberately does NOT check the tenant — the caller has to establish that
 * separately, because conflating "wrong tenant" with "wrong workspace" is how
 * a workspace check ends up accidentally answering a tenant question.
 */
export function memberMayUseWorkspace(member: OrgUser, workspaceId: string): boolean {
  if (member.status !== 'active') return false;
  if (member.workspaceIds === undefined) return true;
  return member.workspaceIds.includes(workspaceId);
}

/* ─────────────────────────── Roles & permissions ──────────────────────── */

/** Org-wide permission scopes. Coarse-grained and least-privilege by design. */
export type EnterprisePermission =
  | 'org:read'
  | 'org:manage'
  | 'people:read'
  | 'people:manage'
  | 'workspace:read'
  | 'workspace:manage'
  | 'workforce:read'
  | 'workforce:operate'
  | 'workforce:approve'
  | 'workforce:manage'
  | 'marketplace:read'
  | 'marketplace:manage'
  | 'governance:read'
  | 'governance:manage'
  | 'intelligence:read'
  | 'operations:read'
  | 'operations:manage'
  | 'crm:read'
  | 'crm:manage'
  | 'sales:read'
  | 'sales:manage'
  | 'inventory:read'
  | 'inventory:manage'
  | 'procurement:read'
  | 'procurement:manage'
  | 'warehouse:read'
  | 'warehouse:manage'
  | 'manufacturing:read'
  | 'manufacturing:manage'
  | 'maintenance:read'
  | 'maintenance:manage'
  | 'executive:read'
  | 'executive:approve'
  | 'executive:verify'
  | 'executive:execute'
  | 'dashboard:read'
  | 'sandbox:read'
  | 'sandbox:manage'
  | 'connectors:read'
  | 'connectors:manage'
  // ── P10 — Federation Platform: cross-org read, management, and delegated-approval authority. ──
  | 'federation:read'
  | 'federation:manage'
  | 'federation:approve'
  // ── P11 — Cloud Control Plane: read the global control plane, and manage/operate cloud resources. ──
  | 'cloud:read'
  | 'cloud:manage'
  /**
   * P13C ROUND 7 — THE PLATFORM OPERATOR. STRICTLY ABOVE `cloud:manage`.
   *
   * Every other permission in this union is granted by an ORGANIZATION ROLE, and
   * that is the right model for everything an organization owns. It cannot
   * express the one authority the control plane actually needs, because the
   * resources it governs — rate-limit policies, deployment replicas, the shared
   * runtime — belong to the MACHINE, not to any organization on it.
   *
   * `cloud:manage` was doing that job and it is the wrong shape: it is held by
   * every organization's Admin, so tenant A's administrator could disable the
   * rate limit protecting tenant B. Scoping the policies per tenant would be
   * worse than the exposure — per-tenant limits over one shared runtime are not
   * limits at all.
   *
   * So this permission is deliberately UNREACHABLE FROM ANY ORGANIZATION ROLE.
   * See `PLATFORM_ONLY_PERMISSIONS` below and `platformOperatorRegistry.ts`: it is
   * held by an install-level operator identity and by nothing else, and switching
   * organizations cannot confer it because it was never keyed on one.
   */
  | 'cloud:operate'
  // ── P12 — Developer Platform: read the developer console, and manage keys/OAuth/publishing/billing. ──
  | 'developer:read'
  | 'developer:manage'
  // ── P13 — Industry Solution Platform: read the industry solution-pack catalog + readiness. ──
  | 'industry:read'
  // ── P14 — Autonomous Enterprise Intelligence: read the strategic intelligence layer. ──
  | 'strategy:read'
  // ── P15 — Enterprise Digital Twin: read the digital-twin visualization/composition layer. ──
  | 'twin:read'
  // ── P16 — Enterprise Knowledge Fabric: read the knowledge-fabric projection layer. ──
  | 'knowledge:read'
  // ── P17 — Global AI Orchestration Platform: read the orchestration projection layer. ──
  | 'orchestration:read'
  // ── P18 — Enterprise Intelligence Network: read the intelligence-network projection layer. ──
  | 'network:read'
  // ── P19 — Autonomous Enterprise Operations: read the closed-loop operations projection layer. ──
  | 'autonomousops:read'
  // ── P20 — NeuroPause Platform v2: read the commercial productization projection layer. ──
  | 'commercial:read'
  // ── Experience Program v1.0: read the decision-first experience/summary projection layer. ──
  | 'experience:read'
  // ── Intent Experience Program v2.0: read the intent-native reprojection of the strategy goals. ──
  | 'intent:read'
  // ── Phase 6 — Universal Enterprise Data Plane. Import is split into three
  // escalating scopes deliberately: reading an analysis is not the same right as
  // writing records, and neither is the same right as APPROVING a high-risk
  // (money / payroll / master-data) import. Segregation of duties depends on
  // `data:import` and `data:approve` being separable. ──
  | 'data:read'
  | 'data:import'
  | 'data:approve'
  // ── Medical Device Manufacturing Pack. Finer-grained than the ERP domains
  // above on purpose: a quality reviewer who releases and blocks lots is not
  // the person who maintains the product catalogue, and a regulatory or
  // customer-service reader needs the traceability answer without either write
  // right. The `scope:subject.action` shape keeps the existing `scope:action`
  // convention while carrying the extra subject the charter names. ──
  | 'medicalDevice:product.read'
  | 'medicalDevice:product.write'
  | 'medicalDevice:lot.read'
  | 'medicalDevice:lot.write'
  | 'medicalDevice:traceability.read';

export const ALL_ENTERPRISE_PERMISSIONS: readonly EnterprisePermission[] = [
  'org:read',
  'org:manage',
  'people:read',
  'people:manage',
  'workspace:read',
  'workspace:manage',
  'workforce:read',
  'workforce:operate',
  'workforce:approve',
  'workforce:manage',
  'marketplace:read',
  'marketplace:manage',
  'governance:read',
  'governance:manage',
  'intelligence:read',
  'operations:read',
  'operations:manage',
  'crm:read',
  'crm:manage',
  'sales:read',
  'sales:manage',
  'inventory:read',
  'inventory:manage',
  'procurement:read',
  'procurement:manage',
  'warehouse:read',
  'warehouse:manage',
  'manufacturing:read',
  'manufacturing:manage',
  'maintenance:read',
  'maintenance:manage',
  'executive:read',
  'executive:approve',
  'executive:verify',
  'executive:execute',
  'dashboard:read',
  'sandbox:read',
  'sandbox:manage',
  'connectors:read',
  'connectors:manage',
  // ── P10 — Federation Platform ──
  'federation:read',
  'federation:manage',
  'federation:approve',
  // ── P11 — Cloud Control Plane ──
  'cloud:read',
  'cloud:manage',
  'cloud:operate',
  // ── P12 — Developer Platform ──
  'developer:read',
  'developer:manage',
  // ── P13 — Industry Solution Platform ──
  'industry:read',
  // ── P14 — Autonomous Enterprise Intelligence ──
  'strategy:read',
  // ── P15 — Enterprise Digital Twin ──
  'twin:read',
  // ── P16 — Enterprise Knowledge Fabric ──
  'knowledge:read',
  // ── P17 — Global AI Orchestration Platform ──
  'orchestration:read',
  // ── P18 — Enterprise Intelligence Network ──
  'network:read',
  // ── P19 — Autonomous Enterprise Operations ──
  'autonomousops:read',
  // ── P20 — NeuroPause Platform v2 (commercial productization) ──
  'commercial:read',
  // ── Phase 6 — Universal Enterprise Data Plane ──
  'data:read',
  'data:import',
  'data:approve',
  // ── Experience Program v1.0 (decision-first experience) ──
  'experience:read',
  // ── Intent Experience Program v2.0 (intent-native experience) ──
  'intent:read',
  // ── Medical Device Manufacturing Pack ──
  'medicalDevice:product.read',
  'medicalDevice:product.write',
  'medicalDevice:lot.read',
  'medicalDevice:lot.write',
  'medicalDevice:traceability.read',
];

/**
 * Permissions NO ORGANIZATION ROLE MAY EVER HOLD.
 *
 * P13C ROUND 7. This list is the whole mechanism, and it exists because of a
 * trap in the seed: the Owner role is defined as `[...ALL_ENTERPRISE_PERMISSIONS]`,
 * so ANY permission added to that array is granted — silently, to every
 * organization's Owner, on the next reconcile. A capability meant to be
 * install-level would have become the most widely held one in the product,
 * reachable by creating a second organization and owning it.
 *
 * `BUILT_IN_ROLE_SPECS` filters the Owner wildcard through this set, so the
 * default is now "the wildcard means everything an ORGANIZATION can do", which
 * is what it was always read as. Anything here needs a different authority, and
 * the code that grants it must say where that authority comes from.
 */
export const PLATFORM_ONLY_PERMISSIONS: readonly EnterprisePermission[] = ['cloud:operate'];

/** True when this permission cannot be satisfied by an organization role. */
export function isPlatformOnlyPermission(p: EnterprisePermission): boolean {
  return PLATFORM_ONLY_PERMISSIONS.includes(p);
}

export interface OrgRole {
  id: string;
  orgId: string;
  name: string;
  description: string;
  permissions: EnterprisePermission[];
  /** Built-in roles ship with the OS and cannot be deleted. */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────── Workspaces ───────────────────────────── */

/**
 * A workspace is an isolated operating context bound to exactly one
 * organization. Multiple workspaces coexist with their data kept separate;
 * exactly one is active at a time.
 */
export interface Workspace {
  id: string;
  name: string;
  organizationId: string;
  /** Isolation posture. 'isolated' = data is scoped to this workspace only. */
  isolation: 'isolated';
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  organizationId: string;
  orgName: string;
  userCount: number;
  unitCount: number;
  active: boolean;
}

/**
 * One organization the SIGNED-IN ACCOUNT belongs to (P13C Part 3).
 *
 * The switcher's row. Deliberately thin: a name, the caller's own role names,
 * and how many workspaces they may enter. It carries no headcount, no unit
 * count and no workspace ids for organizations other than the one being
 * described, because this list is exactly where an attacker would otherwise
 * collect the identifiers for a direct-object reference — and a switcher only
 * needs enough to be chosen from.
 */
export interface OrganizationSummary {
  id: string;
  name: string;
  /** Whether this is the organization the session currently resolves to. */
  active: boolean;
  /** The caller's role names in THIS organization. Never anyone else's. */
  roles: string[];
  /** How many workspaces here the caller may operate in. */
  workspaceCount: number;
}

/* ─────────────────────────── Organization graph ───────────────────────── */

export type OrgGraphNodeKind =
  'organization' | 'unit' | 'user' | 'worker' | 'project' | 'customer' | 'document' | 'connector';

export type OrgGraphEdgeKind =
  | 'contains' // org → unit, unit → unit
  | 'member_of' // user → unit
  | 'leads' // user → unit
  | 'reports_to' // unit → parent unit
  | 'operates' // worker → workspace/org
  | 'owns' // user/unit → project
  | 'works_on' // user/worker → project
  | 'engages' // org → customer
  | 'authored' // user → document
  | 'connected'; // org → connector

export interface OrgGraphNode {
  id: string;
  kind: OrgGraphNodeKind;
  label: string;
  /** Optional sublabel — title, role, status, etc. */
  detail: string | null;
  metadata: Record<string, unknown>;
}

export interface OrgGraphEdge {
  id: string;
  kind: OrgGraphEdgeKind;
  from: string;
  to: string;
}

export interface OrgGraph {
  nodes: OrgGraphNode[];
  edges: OrgGraphEdge[];
  counts: {
    nodes: number;
    edges: number;
    byNodeKind: Record<string, number>;
  };
  builtAt: string;
}

export interface OrgGraphNeighbor {
  edge: OrgGraphEdge;
  node: OrgGraphNode;
  direction: 'out' | 'in';
}

export interface OrgGraphNeighbors {
  node: OrgGraphNode;
  neighbors: OrgGraphNeighbor[];
}

/* ───────────────────────── Enterprise governance ──────────────────────── */

/** A trigger describing which kind of action an approval chain governs. */
export type ApprovalTrigger =
  'workforce_side_effect' | 'governance_change' | 'org_structure_change' | 'spend' | 'data_export';

export interface ApprovalChainStep {
  id: string;
  name: string;
  /** The role whose holders may clear this step. */
  roleId: string;
  order: number;
}

export interface ApprovalChain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  appliesTo: ApprovalTrigger;
  steps: ApprovalChainStep[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ComplianceSeverity = 'info' | 'warning' | 'critical';

/** The deterministic checks the compliance engine knows how to evaluate. */
export type ComplianceCheckKind =
  | 'every_side_effect_approved'
  | 'no_unhealthy_workers'
  | 'audit_trail_present'
  | 'every_unit_has_lead'
  | 'no_orphaned_members'
  | 'approval_chain_defined';

export interface ComplianceRule {
  id: string;
  orgId: string;
  name: string;
  description: string;
  category: string;
  severity: ComplianceSeverity;
  check: ComplianceCheckKind;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ComplianceStatus = 'pass' | 'warn' | 'fail';

export interface ComplianceFinding {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: ComplianceSeverity;
  status: ComplianceStatus;
  detail: string;
  /** Identifiers of the things that drove the finding. */
  evidence: string[];
}

export interface EnterpriseAuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  summary: string;
  workspaceId: string;
  /**
   * P13C ROUND 6 — the owning ORGANIZATION.
   *
   * `workspaceId` alone could not partition this trail. It is stamped from
   * `activeWorkspaceIdForDisplay()`, which returns one install-wide variable and
   * never consults the principal — so a row written under a background fan-out
   * carried whatever workspace the WINDOW happened to be showing. Worse, the
   * unswitched value is the shared constant `workspace-default`, so every tenant
   * that had never created a workspace wrote into the same partition and read
   * each other's rows: record ids, record titles, actors and actions.
   *
   * OPTIONAL, and that is load-bearing. Rows written before this field existed
   * must hash exactly as they did or the tamper-evident chain reports forgery on
   * the first upgrade. `canonicalAudit` therefore includes the key ONLY when it
   * is present. See `governanceStore.visibleAudit` for how unattributed legacy
   * rows are handled — they are not given an owner, because a migration that
   * invents provenance has destroyed the thing it was protecting.
   */
  tenantId?: string;
}

/** The editable governance configuration for an organization. */
export interface GovernanceConfig {
  roles: OrgRole[];
  approvalChains: ApprovalChain[];
  complianceRules: ComplianceRule[];
}

/* ───────────────────────── Executive dashboard ────────────────────────── */

export interface OrgHealthSummary {
  organizationId: string;
  organizationName: string;
  userCount: number;
  humanCount: number;
  workerCount: number;
  unitCount: number;
  /** Share of org units that have a lead assigned, 0..1. */
  leadershipCoverage: number;
  /** Composite 0..1 health score, with how it was derived. */
  healthScore: number;
  healthLabel: string;
}

export interface WorkforceSummary {
  total: number;
  idle: number;
  running: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
  averageTrust: number;
  jobsRun: number;
  successRate: number;
}

export interface BusinessActivitySummary {
  projects: number;
  tasks: number;
  documents: number;
  customers: number;
  events: number;
  /** Activity entries in the last 24h. */
  recentEvents: number;
}

export interface RiskItem {
  id: string;
  severity: ComplianceSeverity;
  title: string;
  detail: string;
  evidence: string[];
}

export interface RiskSummary {
  level: 'low' | 'elevated' | 'high';
  openFindings: number;
  criticalFindings: number;
  items: RiskItem[];
}

export interface ApprovalsSummary {
  pending: number;
  approvedRecently: number;
  rejectedRecently: number;
  oldestPendingAgeMs: number | null;
}

export interface IntelligenceSummary {
  headline: string;
  recommendationCount: number;
  topRecommendations: { id: string; title: string; priority: string }[];
  grounded: boolean;
}

export interface OperationsSummary {
  connectors: number;
  connectedAccounts: number;
  installedApps: number;
  auditEntries: number;
}

export interface ExecutiveSnapshot {
  generatedAt: string;
  workspaceId: string;
  organization: OrgHealthSummary;
  workforce: WorkforceSummary;
  activity: BusinessActivitySummary;
  risk: RiskSummary;
  approvals: ApprovalsSummary;
  intelligence: IntelligenceSummary;
  operations: OperationsSummary;
}
