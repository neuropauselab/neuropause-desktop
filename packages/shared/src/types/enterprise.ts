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

export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Short human description of what the org does. */
  description: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
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
  status: OrgUserStatus;
  createdAt: string;
  updatedAt: string;
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
  | 'cloud:manage';

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
];

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
