/**
 * Dashboard Persistence (Wave 1, Module 4). Real persisted dashboards — layouts,
 * widget positions, themes, filters, and saved views — at personal / organization
 * / executive scope. Replaces the prototype's in-memory demo widgets. Tenant-
 * scoped; every mutation audited + published (nems.dashboard.updated).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from '@neuropause/persistence';
import { one, many, run, toJson } from './db';
import { recordMutation, type Gov } from './governance';
import type { MutationContext } from './types';

export type DashboardScope = 'personal' | 'organization' | 'executive';
export interface Dashboard {
  id: string; tenantId: string; ownerId: string | null; scope: DashboardScope;
  name: string; layout: unknown[]; theme: string; filters: Record<string, unknown>;
  createdAt: number; updatedAt: number;
}
export interface Widget { id: string; dashboardId: string; type: string; position: Record<string, unknown>; config: Record<string, unknown>; }

const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
interface DashRow { id: string; tenant_id: string; owner_id: string | null; scope: DashboardScope; name: string; layout: unknown[]; theme: string; filters: Record<string, unknown>; created_at: string | number; updated_at: string | number; }
function mapDash(r: DashRow): Dashboard {
  return { id: r.id, tenantId: r.tenant_id, ownerId: r.owner_id, scope: r.scope, name: r.name, layout: r.layout ?? [], theme: r.theme, filters: r.filters ?? {}, createdAt: num(r.created_at), updatedAt: num(r.updated_at) };
}

export class DashboardService {
  constructor(private readonly db: SqlDriver, private readonly clock: Clock, private readonly gov: Gov) {}

  async create(ctx: MutationContext, input: { name: string; scope?: DashboardScope; ownerId?: string; layout?: unknown[]; theme?: string; filters?: Record<string, unknown> }): Promise<Dashboard> {
    const id = randomId('dash');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_dashboards (id, tenant_id, owner_id, scope, name, layout, theme, filters, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$9)`,
      [id, ctx.tenantId, input.ownerId ?? (input.scope && input.scope !== 'personal' ? null : ctx.actorId), input.scope ?? 'personal', input.name, toJson(input.layout ?? []), input.theme ?? 'light', toJson(input.filters ?? {}), at]);
    await recordMutation(this.gov, { ctx, entity: 'dashboard', entityId: id, operation: 'create', after: { name: input.name, scope: input.scope ?? 'personal' }, event: 'nems.dashboard.updated' });
    return (await this.get(ctx.tenantId, id))!;
  }
  async get(tenantId: string, id: string): Promise<Dashboard | undefined> {
    const r = await one<DashRow>(this.db, `SELECT * FROM nems_dashboards WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r ? mapDash(r) : undefined;
  }
  async list(tenantId: string, filter: { scope?: DashboardScope; ownerId?: string } = {}): Promise<Dashboard[]> {
    const clauses = ['tenant_id=$1']; const params: unknown[] = [tenantId];
    if (filter.scope) { params.push(filter.scope); clauses.push(`scope=$${params.length}`); }
    if (filter.ownerId) { params.push(filter.ownerId); clauses.push(`owner_id=$${params.length}`); }
    return (await many<DashRow>(this.db, `SELECT * FROM nems_dashboards WHERE ${clauses.join(' AND ')} ORDER BY created_at`, params)).map(mapDash);
  }
  async update(ctx: MutationContext, id: string, patch: { name?: string; layout?: unknown[]; theme?: string; filters?: Record<string, unknown> }): Promise<Dashboard> {
    const before = await this.get(ctx.tenantId, id);
    if (!before) throw new Error(`dashboard '${id}' not found`);
    const next = { name: patch.name ?? before.name, layout: patch.layout ?? before.layout, theme: patch.theme ?? before.theme, filters: patch.filters ?? before.filters };
    await run(this.db, `UPDATE nems_dashboards SET name=$3, layout=$4::jsonb, theme=$5, filters=$6::jsonb, updated_at=$7 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, id, next.name, toJson(next.layout), next.theme, toJson(next.filters), this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'dashboard', entityId: id, operation: 'update', before: { theme: before.theme }, after: { theme: next.theme }, event: 'nems.dashboard.updated' });
    return (await this.get(ctx.tenantId, id))!;
  }

  async addWidget(ctx: MutationContext, dashboardId: string, input: { type: string; position?: Record<string, unknown>; config?: Record<string, unknown> }): Promise<Widget> {
    const id = randomId('wid');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_widgets (id, tenant_id, dashboard_id, type, position, config, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$7)`, [id, ctx.tenantId, dashboardId, input.type, toJson(input.position ?? {}), toJson(input.config ?? {}), at]);
    await recordMutation(this.gov, { ctx, entity: 'widget', entityId: id, operation: 'create', after: { type: input.type, dashboardId }, event: 'nems.dashboard.updated' });
    return { id, dashboardId, type: input.type, position: input.position ?? {}, config: input.config ?? {} };
  }
  async moveWidget(ctx: MutationContext, widgetId: string, position: Record<string, unknown>): Promise<void> {
    await run(this.db, `UPDATE nems_widgets SET position=$3::jsonb, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, widgetId, toJson(position), this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'widget', entityId: widgetId, operation: 'update', after: { position }, event: 'nems.dashboard.updated' });
  }
  async widgets(tenantId: string, dashboardId: string): Promise<Widget[]> {
    return (await many<{ id: string; dashboard_id: string; type: string; position: Record<string, unknown>; config: Record<string, unknown> }>(this.db, `SELECT id,dashboard_id,type,position,config FROM nems_widgets WHERE tenant_id=$1 AND dashboard_id=$2 ORDER BY created_at`, [tenantId, dashboardId]))
      .map((r) => ({ id: r.id, dashboardId: r.dashboard_id, type: r.type, position: r.position ?? {}, config: r.config ?? {} }));
  }

  async saveView(ctx: MutationContext, input: { ownerId: string; name: string; entity: string; query: Record<string, unknown> }): Promise<{ id: string }> {
    const id = randomId('view');
    await run(this.db, `INSERT INTO nems_saved_views (id, tenant_id, owner_id, name, entity, query, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [id, ctx.tenantId, input.ownerId, input.name, input.entity, toJson(input.query), this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'saved_view', entityId: id, operation: 'create', after: { name: input.name, entity: input.entity }, event: 'nems.dashboard.updated' });
    return { id };
  }
  async savedViews(tenantId: string, ownerId: string): Promise<Array<{ id: string; name: string; entity: string; query: Record<string, unknown> }>> {
    return (await many<{ id: string; name: string; entity: string; query: Record<string, unknown> }>(this.db, `SELECT id,name,entity,query FROM nems_saved_views WHERE tenant_id=$1 AND owner_id=$2 ORDER BY created_at`, [tenantId, ownerId]))
      .map((r) => ({ id: r.id, name: r.name, entity: r.entity, query: r.query ?? {} }));
  }
}
