/**
 * NEMS composition root (Wave 1, Module 11). `createNemsPlatform(runtime, { driver })`
 * assembles the production multi-tenant foundation on the EXISTING platform: the one
 * database (persistence SqlDriver), the one identity/authorization model (Phase-14
 * security), and the one audit chain + event bus (runtime). It exposes the runtime
 * API surface — organizations / users / roles / sessions / okrs / dashboards /
 * settings / preferences / events / search — and seeds the built-in roles. Nothing
 * is duplicated; every service reuses platform primitives.
 */
import { randomId, systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform, DEFAULT_SESSION_POLICY, type SecurityPlatform, type SessionPolicy } from '@neuropause/security';
import { MigrationRunner, type SqlDriver } from '@neuropause/persistence';
import { NEMS_VERSION, BUILTIN_ROLES, type BuiltinRole } from './constants';
import { NEMS_SCHEMA } from './schema';
import { NemsAudit } from './audit';
import { NemsEvents } from './events';
import type { Gov } from './governance';
import { OrganizationService } from './organizations';
import { UserService, type User } from './users';
import { IdentityService } from './identity';
import { DashboardService } from './dashboards';
import { OkrService } from './okrs';
import { SettingsService } from './settings';
import { SearchService } from './search';
import type { MutationContext } from './types';

export const ROLE_PERMISSIONS: Record<BuiltinRole, string[]> = {
  admin: ['*'],
  executive: ['dashboard:*', 'okr:*', 'org:read', 'user:read', 'settings:read', 'report:*'],
  manager: ['dashboard:read', 'dashboard:write', 'okr:*', 'user:read', 'team:*', 'task:*'],
  contributor: ['dashboard:read', 'okr:read', 'okr:write', 'task:*'],
  viewer: ['dashboard:read', 'okr:read', 'report:read'],
};

export interface NemsPlatformOptions {
  driver: SqlDriver;
  clock?: Clock;
  security?: SecurityPlatform;
  sessionPolicy?: SessionPolicy;
}

export interface RolesApi {
  list(): Promise<Array<{ name: string; permissions: string[]; builtin: boolean }>>;
  permissions(role: string): string[];
  authorize(user: User, action: string, resourceType: string): boolean;
  defineCustom(name: string, permissions: string[]): Promise<void>;
}
export interface PreferencesApi {
  get(tenantId: string, userId: string): Promise<Record<string, unknown>>;
  set(ctx: MutationContext, userId: string, data: Record<string, unknown>): Promise<void>;
}

export interface NemsPlatform {
  version: string;
  migrate(): Promise<void>;
  organizations(): OrganizationService;
  users(): UserService;
  roles(): RolesApi;
  sessions(): IdentityService;
  identity(): IdentityService;
  okrs(): OkrService;
  dashboards(): DashboardService;
  settings(): SettingsService;
  preferences(): PreferencesApi;
  events(): NemsEvents;
  search(): SearchService;
  audit(): NemsAudit;
  security(): SecurityPlatform;
}

export function createNemsPlatform(runtime: EnterpriseRuntime, options: NemsPlatformOptions): NemsPlatform {
  const clock = options.clock ?? systemClock;
  const driver = options.driver;
  const security = options.security ?? createSecurityPlatform(runtime, { clock });
  const policy = options.sessionPolicy ?? DEFAULT_SESSION_POLICY;

  const audit = new NemsAudit(runtime, clock);
  const events = new NemsEvents(runtime);
  const gov: Gov = { audit, events };

  const organizations = new OrganizationService(driver, clock, gov);
  const users = new UserService(driver, clock, gov, security.authorization());
  const identity = new IdentityService(driver, clock, gov, users, policy);
  const dashboards = new DashboardService(driver, clock, gov);
  const okrs = new OkrService(driver, clock, gov);
  const settings = new SettingsService(driver, clock, gov);
  const search = new SearchService(driver);

  const roles: RolesApi = {
    list: async () => (await driver.query<{ name: string; permissions: string[]; builtin: boolean }>(`SELECT name, permissions, builtin FROM nems_roles ORDER BY name`)).rows.map((r) => ({ name: r.name, permissions: r.permissions ?? [], builtin: r.builtin })),
    permissions: (role: string) => ROLE_PERMISSIONS[role as BuiltinRole] ?? [],
    authorize: (user, action, resourceType) => users.can(user, action, resourceType),
    defineCustom: async (name: string, permissions: string[]) => {
      security.authorization().defineRole({ id: name, name, permissions });
      await driver.query(`INSERT INTO nems_roles (id, tenant_id, name, permissions, builtin, created_at) VALUES ($1,NULL,$2,$3::jsonb,FALSE,$4)`, [randomId('role'), name, JSON.stringify(permissions), clock.now()]);
    },
  };

  const preferences: PreferencesApi = {
    get: (tenantId, userId) => settings.preferences(tenantId, userId),
    set: (ctx, userId, data) => settings.setPreferences(ctx, userId, data),
  };

  return {
    version: NEMS_VERSION,
    async migrate() {
      await new MigrationRunner(driver, clock).up(NEMS_SCHEMA);
      for (const role of BUILTIN_ROLES) {
        const perms = ROLE_PERMISSIONS[role];
        security.authorization().defineRole({ id: role, name: role, permissions: perms });
        await driver.query(
          `INSERT INTO nems_roles (id, tenant_id, name, permissions, builtin, created_at)
           SELECT $1, NULL, $2, $3::jsonb, TRUE, $4 WHERE NOT EXISTS (SELECT 1 FROM nems_roles WHERE name=$2 AND tenant_id IS NULL)`,
          [randomId('role'), role, JSON.stringify(perms), clock.now()],
        );
      }
    },
    organizations: () => organizations,
    users: () => users,
    roles: () => roles,
    sessions: () => identity,
    identity: () => identity,
    okrs: () => okrs,
    dashboards: () => dashboards,
    settings: () => settings,
    preferences: () => preferences,
    events: () => events,
    search: () => search,
    audit: () => audit,
    security: () => security,
  };
}
