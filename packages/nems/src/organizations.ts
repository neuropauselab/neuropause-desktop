/**
 * Organization Platform (Wave 1, Module 1). Organizations are the tenant boundary.
 * Supports multiple organizations, a business-unit → department → team hierarchy,
 * and org settings / preferences / metadata — all persisted in the one database
 * and every mutation audited + published. Every child entity is tenant-scoped.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from '@neuropause/persistence';
import { one, many, run, toJson } from './db';
import { recordMutation, type Gov } from './governance';
import { systemContext, type MutationContext } from './types';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  metadata: Record<string, unknown>;
  settings: Record<string, unknown>;
  preferences: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
export interface OrgNode {
  id: string;
  tenantId: string;
  name: string;
  createdAt: number;
}

interface OrgRow {
  id: string; name: string; slug: string; status: Organization['status'];
  metadata: Record<string, unknown>; settings: Record<string, unknown>; preferences: Record<string, unknown>;
  created_at: string | number; updated_at: string | number;
}
const n = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
function mapOrg(r: OrgRow): Organization {
  return { id: r.id, name: r.name, slug: r.slug, status: r.status, metadata: r.metadata ?? {}, settings: r.settings ?? {}, preferences: r.preferences ?? {}, createdAt: n(r.created_at), updatedAt: n(r.updated_at) };
}

export class OrganizationService {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock,
    private readonly gov: Gov,
  ) {}

  async create(input: { name: string; slug: string; actorId?: string; metadata?: Record<string, unknown>; settings?: Record<string, unknown> }): Promise<Organization> {
    const id = randomId('org');
    const at = this.clock.now();
    await run(
      this.db,
      `INSERT INTO nems_organizations (id, name, slug, status, metadata, settings, preferences, created_at, updated_at)
       VALUES ($1,$2,$3,'active',$4::jsonb,$5::jsonb,'{}'::jsonb,$6,$6)`,
      [id, input.name, input.slug, toJson(input.metadata ?? {}), toJson(input.settings ?? {}), at],
    );
    const org = (await this.get(id))!;
    const ctx: MutationContext = { tenantId: id, actorId: input.actorId ?? 'system' };
    await recordMutation(this.gov, { ctx, entity: 'organization', entityId: id, operation: 'create', after: { id, name: org.name, slug: org.slug }, event: 'nems.organization.created' });
    return org;
  }

  async get(id: string): Promise<Organization | undefined> {
    const r = await one<OrgRow>(this.db, `SELECT * FROM nems_organizations WHERE id = $1`, [id]);
    return r ? mapOrg(r) : undefined;
  }
  async bySlug(slug: string): Promise<Organization | undefined> {
    const r = await one<OrgRow>(this.db, `SELECT * FROM nems_organizations WHERE slug = $1`, [slug]);
    return r ? mapOrg(r) : undefined;
  }
  async list(): Promise<Organization[]> {
    return (await many<OrgRow>(this.db, `SELECT * FROM nems_organizations ORDER BY created_at`)).map(mapOrg);
  }

  async update(id: string, patch: Partial<Pick<Organization, 'name' | 'status' | 'metadata' | 'settings' | 'preferences'>>, ctx: MutationContext): Promise<Organization> {
    const before = await this.get(id);
    if (!before) throw new Error(`organization '${id}' not found`);
    const next: Organization = {
      ...before,
      name: patch.name ?? before.name,
      status: patch.status ?? before.status,
      metadata: patch.metadata ?? before.metadata,
      settings: patch.settings ?? before.settings,
      preferences: patch.preferences ?? before.preferences,
    };
    await run(
      this.db,
      `UPDATE nems_organizations SET name=$2, status=$3, metadata=$4::jsonb, settings=$5::jsonb, preferences=$6::jsonb, updated_at=$7 WHERE id=$1`,
      [id, next.name, next.status, toJson(next.metadata), toJson(next.settings), toJson(next.preferences), this.clock.now()],
    );
    await recordMutation(this.gov, { ctx, entity: 'organization', entityId: id, operation: 'update', before: { name: before.name, status: before.status }, after: { name: next.name, status: next.status }, event: 'nems.organization.updated' });
    return (await this.get(id))!;
  }

  // ── hierarchy ──
  private async node(table: string, ctx: MutationContext, name: string, extraCols: Record<string, unknown> = {}): Promise<OrgNode> {
    const id = randomId(table.replace('nems_', '').slice(0, 4));
    const at = this.clock.now();
    const cols = ['id', 'tenant_id', 'name', ...Object.keys(extraCols), 'created_at', 'updated_at'];
    const vals = [id, ctx.tenantId, name, ...Object.values(extraCols), at, at];
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    await run(this.db, `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph})`, vals);
    await recordMutation(this.gov, { ctx, entity: table.replace('nems_', ''), entityId: id, operation: 'create', after: { name }, event: 'nems.organization.updated' });
    return { id, tenantId: ctx.tenantId, name, createdAt: at };
  }
  createBusinessUnit(ctx: MutationContext, input: { name: string; parentId?: string }): Promise<OrgNode> {
    return this.node('nems_business_units', ctx, input.name, { parent_id: input.parentId ?? null });
  }
  createDepartment(ctx: MutationContext, input: { name: string; businessUnitId?: string }): Promise<OrgNode> {
    return this.node('nems_departments', ctx, input.name, { business_unit_id: input.businessUnitId ?? null });
  }
  createTeam(ctx: MutationContext, input: { name: string; departmentId?: string }): Promise<OrgNode> {
    return this.node('nems_teams', ctx, input.name, { department_id: input.departmentId ?? null });
  }
  async teams(tenantId: string): Promise<OrgNode[]> {
    return (await many<{ id: string; tenant_id: string; name: string; created_at: string | number }>(this.db, `SELECT id, tenant_id, name, created_at FROM nems_teams WHERE tenant_id=$1 ORDER BY created_at`, [tenantId]))
      .map((r) => ({ id: r.id, tenantId: r.tenant_id, name: r.name, createdAt: n(r.created_at) }));
  }
  async hierarchy(tenantId: string): Promise<{ businessUnits: number; departments: number; teams: number }> {
    const c = async (t: string): Promise<number> => n((await one<{ c: number }>(this.db, `SELECT count(*)::int AS c FROM ${t} WHERE tenant_id=$1`, [tenantId]))!.c);
    return { businessUnits: await c('nems_business_units'), departments: await c('nems_departments'), teams: await c('nems_teams') };
  }
}

export { systemContext };
