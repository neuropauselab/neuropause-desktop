/**
 * NEMS production schema (Wave 1, Module 9). Versioned, reversible migrations run
 * through the EXISTING persistence MigrationRunner against the ONE database
 * (SqlDriver). Every entity table is tenant-aware (`tenant_id` = organization id),
 * with indexes, foreign keys, and constraints. Tables are `nems_`-prefixed so they
 * never collide with the platform's own schema. Audit and events are NOT tables
 * here — they reuse the one runtime audit chain and event bus (no duplication).
 */
import type { Migration } from '@neuropause/persistence';

export const NEMS_SCHEMA: Migration[] = [
  {
    version: 1,
    name: 'nems_organizations',
    up: `
      CREATE TABLE nems_organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
        metadata JSONB NOT NULL DEFAULT '{}',
        settings JSONB NOT NULL DEFAULT '{}',
        preferences JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_business_units (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        parent_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_departments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        business_unit_id TEXT REFERENCES nems_business_units(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_teams (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        department_id TEXT REFERENCES nems_departments(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX nems_bu_tenant ON nems_business_units (tenant_id);
      CREATE INDEX nems_dept_tenant ON nems_departments (tenant_id);
      CREATE INDEX nems_team_tenant ON nems_teams (tenant_id);
    `,
    down: `
      DROP TABLE IF EXISTS nems_teams;
      DROP TABLE IF EXISTS nems_departments;
      DROP TABLE IF EXISTS nems_business_units;
      DROP TABLE IF EXISTS nems_organizations;
    `,
  },
  {
    version: 2,
    name: 'nems_identity',
    up: `
      CREATE TABLE nems_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        display_name TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','deactivated')),
        roles JSONB NOT NULL DEFAULT '[]',
        mfa_secret TEXT,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE (tenant_id, email)
      );
      CREATE TABLE nems_sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES nems_users(id) ON DELETE CASCADE,
        device TEXT,
        correlation_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        revoked BOOLEAN NOT NULL DEFAULT FALSE,
        rotated_from TEXT
      );
      CREATE TABLE nems_roles (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        name TEXT NOT NULL,
        permissions JSONB NOT NULL DEFAULT '[]',
        builtin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE nems_role_assignments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES nems_users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES nems_roles(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        UNIQUE (tenant_id, user_id, role_id)
      );
      CREATE TABLE nems_memberships (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES nems_users(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES nems_teams(id) ON DELETE CASCADE,
        role TEXT,
        created_at BIGINT NOT NULL,
        UNIQUE (tenant_id, user_id, team_id)
      );
      CREATE TABLE nems_invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX nems_users_tenant ON nems_users (tenant_id);
      CREATE INDEX nems_sessions_user ON nems_sessions (tenant_id, user_id);
      CREATE INDEX nems_roleasn_user ON nems_role_assignments (tenant_id, user_id);
      CREATE INDEX nems_invites_tenant ON nems_invitations (tenant_id, email);
    `,
    down: `
      DROP TABLE IF EXISTS nems_invitations;
      DROP TABLE IF EXISTS nems_memberships;
      DROP TABLE IF EXISTS nems_role_assignments;
      DROP TABLE IF EXISTS nems_roles;
      DROP TABLE IF EXISTS nems_sessions;
      DROP TABLE IF EXISTS nems_users;
    `,
  },
  {
    version: 3,
    name: 'nems_dashboards',
    up: `
      CREATE TABLE nems_dashboards (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        owner_id TEXT,
        scope TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal','organization','executive')),
        name TEXT NOT NULL,
        layout JSONB NOT NULL DEFAULT '[]',
        theme TEXT NOT NULL DEFAULT 'light',
        filters JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_widgets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        dashboard_id TEXT NOT NULL REFERENCES nems_dashboards(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        position JSONB NOT NULL DEFAULT '{}',
        config JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_saved_views (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        entity TEXT NOT NULL,
        query JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX nems_dash_tenant ON nems_dashboards (tenant_id, scope);
      CREATE INDEX nems_widgets_dash ON nems_widgets (tenant_id, dashboard_id);
      CREATE INDEX nems_views_owner ON nems_saved_views (tenant_id, owner_id);
    `,
    down: `
      DROP TABLE IF EXISTS nems_saved_views;
      DROP TABLE IF EXISTS nems_widgets;
      DROP TABLE IF EXISTS nems_dashboards;
    `,
  },
  {
    version: 4,
    name: 'nems_okrs',
    up: `
      CREATE TABLE nems_objectives (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        owner_id TEXT,
        period TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'quarterly' CHECK (level IN ('annual','quarterly')),
        status TEXT NOT NULL DEFAULT 'on-track' CHECK (status IN ('planned','on-track','at-risk','behind','done','external')),
        progress INTEGER NOT NULL DEFAULT 0,
        risk TEXT,
        parent_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_key_results (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        objective_id TEXT NOT NULL REFERENCES nems_objectives(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        metric TEXT,
        target NUMERIC,
        current NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'on-track',
        progress INTEGER NOT NULL DEFAULT 0,
        evidence JSONB NOT NULL DEFAULT '[]',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_projects (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        objective_id TEXT REFERENCES nems_objectives(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        owner_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_milestones (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES nems_projects(id) ON DELETE SET NULL,
        objective_id TEXT REFERENCES nems_objectives(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        due_at BIGINT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES nems_projects(id) ON DELETE SET NULL,
        objective_id TEXT REFERENCES nems_objectives(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        assignee_id TEXT,
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in-progress','blocked','done')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE nems_dependencies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        from_type TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'blocks',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX nems_obj_tenant ON nems_objectives (tenant_id, period);
      CREATE INDEX nems_kr_obj ON nems_key_results (tenant_id, objective_id);
      CREATE INDEX nems_proj_tenant ON nems_projects (tenant_id);
      CREATE INDEX nems_task_tenant ON nems_tasks (tenant_id, status);
      CREATE INDEX nems_dep_tenant ON nems_dependencies (tenant_id);
    `,
    down: `
      DROP TABLE IF EXISTS nems_dependencies;
      DROP TABLE IF EXISTS nems_tasks;
      DROP TABLE IF EXISTS nems_milestones;
      DROP TABLE IF EXISTS nems_projects;
      DROP TABLE IF EXISTS nems_key_results;
      DROP TABLE IF EXISTS nems_objectives;
    `,
  },
  {
    version: 5,
    name: 'nems_settings',
    up: `
      CREATE TABLE nems_settings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('profile','organization','workspace')),
        owner_id TEXT,
        category TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        updated_at BIGINT NOT NULL,
        UNIQUE (tenant_id, scope, owner_id, category)
      );
      CREATE TABLE nems_preferences (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES nems_organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES nems_users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}',
        updated_at BIGINT NOT NULL,
        UNIQUE (tenant_id, user_id)
      );
      CREATE INDEX nems_settings_lookup ON nems_settings (tenant_id, scope, category);
    `,
    down: `
      DROP TABLE IF EXISTS nems_preferences;
      DROP TABLE IF EXISTS nems_settings;
    `,
  },
];
