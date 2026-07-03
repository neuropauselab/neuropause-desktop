/**
 * The default organization seed. On first run the Organization Runtime is
 * populated with a realistic org chart (business units → departments → teams),
 * the built-in roles, and a single Owner member bound to the signed-in account.
 * The live AI workforce is folded in separately via `OrgStore.syncWorkers`.
 *
 * Everything here uses stable ids so the seed is deterministic and the
 * worker→team mapping below can reference units directly.
 */
import type {
  EnterprisePermission,
  Organization,
  OrgRole,
  OrgUnit,
  OrgUser,
} from '@neuropause/shared';
import { ALL_ENTERPRISE_PERMISSIONS } from '@neuropause/shared';

export const ORG_ID = 'org-default';
export const OWNER_USER_ID = 'user-owner';

/** Stable unit ids so worker roles can be mapped onto teams. */
export const UNIT = {
  productEng: 'unit-product-eng',
  engineering: 'unit-engineering',
  platform: 'unit-platform',
  aiTeam: 'unit-ai-team',
  design: 'unit-design',
  business: 'unit-business',
  sales: 'unit-sales',
  marketing: 'unit-marketing',
  finance: 'unit-finance',
  legal: 'unit-legal',
  operations: 'unit-operations',
  it: 'unit-it',
  support: 'unit-support',
} as const;

/** Stable role ids. */
export const ROLE = {
  owner: 'role-owner',
  admin: 'role-admin',
  manager: 'role-manager',
  member: 'role-member',
  viewer: 'role-viewer',
  aiWorker: 'role-ai-worker',
} as const;

/** Worker role → the team it belongs to in the org chart. */
export const ROLE_TO_UNIT_ID: Record<string, string> = {
  founder: UNIT.productEng,
  engineering: UNIT.platform,
  research: UNIT.aiTeam,
  marketing: UNIT.marketing,
  sales: UNIT.sales,
  finance: UNIT.finance,
  legal: UNIT.legal,
  operations: UNIT.it,
  support: UNIT.support,
  '*': UNIT.operations,
};

const READ_ONLY: EnterprisePermission[] = [
  'org:read',
  'people:read',
  'workspace:read',
  'workforce:read',
  'governance:read',
  'intelligence:read',
  'operations:read',
  'dashboard:read',
];

const MEMBER: EnterprisePermission[] = [...READ_ONLY, 'workforce:operate'];

const MANAGER: EnterprisePermission[] = [...MEMBER, 'workforce:approve', 'people:manage', 'operations:manage'];

const ADMIN: EnterprisePermission[] = [...MANAGER, 'org:manage', 'governance:manage', 'workspace:manage'];

const AI_WORKER: EnterprisePermission[] = ['workforce:read', 'intelligence:read'];

export interface Seed {
  organizations: Organization[];
  units: OrgUnit[];
  roles: OrgRole[];
  users: OrgUser[];
}

export function buildSeed(now = new Date().toISOString()): Seed {
  const org: Organization = {
    id: ORG_ID,
    name: 'NeuroPause',
    slug: 'neuropause',
    description: 'The default workspace organization. Rename it, restructure it, and add your people.',
    createdAt: now,
    updatedAt: now,
    metadata: { seeded: true },
  };

  const u = (id: string, kind: OrgUnit['kind'], name: string, parentId: string | null): OrgUnit => ({
    id,
    orgId: ORG_ID,
    kind,
    name,
    parentId,
    leadUserId: null,
    createdAt: now,
    updatedAt: now,
  });

  const units: OrgUnit[] = [
    u(UNIT.productEng, 'business_unit', 'Product & Engineering', null),
    u(UNIT.engineering, 'department', 'Engineering', UNIT.productEng),
    u(UNIT.platform, 'team', 'Platform Team', UNIT.engineering),
    u(UNIT.aiTeam, 'team', 'AI Team', UNIT.engineering),
    u(UNIT.design, 'department', 'Design', UNIT.productEng),
    u(UNIT.business, 'business_unit', 'Business', null),
    u(UNIT.sales, 'department', 'Sales', UNIT.business),
    u(UNIT.marketing, 'department', 'Marketing', UNIT.business),
    u(UNIT.finance, 'department', 'Finance', UNIT.business),
    u(UNIT.legal, 'department', 'Legal', UNIT.business),
    u(UNIT.operations, 'business_unit', 'Operations', null),
    u(UNIT.it, 'department', 'IT', UNIT.operations),
    u(UNIT.support, 'department', 'Support', UNIT.operations),
  ];

  const r = (
    id: string,
    name: string,
    description: string,
    permissions: EnterprisePermission[],
  ): OrgRole => ({ id, orgId: ORG_ID, name, description, permissions, builtIn: true, createdAt: now, updatedAt: now });

  const roles: OrgRole[] = [
    r(ROLE.owner, 'Owner', 'Full control of the organization and every workspace.', [...ALL_ENTERPRISE_PERMISSIONS]),
    r(ROLE.admin, 'Admin', 'Manage structure, people, and governance.', ADMIN),
    r(ROLE.manager, 'Manager', 'Operate the workforce, approve actions, manage a team.', MANAGER),
    r(ROLE.member, 'Member', 'Read access and the ability to run AI workers.', MEMBER),
    r(ROLE.viewer, 'Viewer', 'Read-only visibility across the organization.', READ_ONLY),
    r(ROLE.aiWorker, 'AI Worker', 'Constrained role held by governed AI workers.', AI_WORKER),
  ];

  const owner: OrgUser = {
    id: OWNER_USER_ID,
    orgId: ORG_ID,
    name: 'Workspace Owner',
    email: null,
    title: 'Owner',
    kind: 'human',
    workerId: null,
    unitId: UNIT.productEng,
    roleIds: [ROLE.owner],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  return { organizations: [org], units, roles, users: [owner] };
}
