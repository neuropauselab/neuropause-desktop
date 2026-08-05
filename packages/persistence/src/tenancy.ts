/**
 * Multi-tenant persistence (NCEA 12.0, Phase 9). Every entity table is tenant_id
 * keyed, so isolation is enforced in TWO places: (1) at the repository layer —
 * every query is tenant-scoped, and a `TenantScopedRepository` BINDS a tenant so a
 * caller cannot accidentally read across tenants; (2) at the database layer — the
 * RLS policies from the schema, active when connecting as a scoped role that sets
 * `app.tenant_id`. Backups and restores are tenant-scopable (see BackupManager),
 * so a tenant can be exported and re-imported without touching others. Layer (1)
 * is tested in-container; layer (2) needs a non-superuser role (infra-pending).
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SqlDriver, SqlExecutor } from './driver';
import type { Entity, Stored, ListOptions, TableRepository } from './repository';

export interface Tenant {
  tenantId: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: number;
}

export class TenantRegistry {
  constructor(
    private readonly driver: SqlDriver,
    private readonly clock: Clock,
  ) {}

  async create(tenantId: string, name: string): Promise<Tenant> {
    const createdAt = this.clock.now();
    await this.driver.query('INSERT INTO tenants (tenant_id, name, status, created_at) VALUES ($1,$2,$3,$4)', [tenantId, name, 'active', createdAt]);
    return { tenantId, name, status: 'active', createdAt };
  }

  async get(tenantId: string): Promise<Tenant | undefined> {
    const res = await this.driver.query<{ tenant_id: string; name: string; status: string; created_at: number | string }>(
      'SELECT tenant_id, name, status, created_at FROM tenants WHERE tenant_id = $1',
      [tenantId],
    );
    const row = res.rows[0];
    return row ? { tenantId: row.tenant_id, name: row.name, status: row.status as Tenant['status'], createdAt: Number(row.created_at) } : undefined;
  }

  async list(): Promise<Tenant[]> {
    const res = await this.driver.query<{ tenant_id: string; name: string; status: string; created_at: number | string }>(
      'SELECT tenant_id, name, status, created_at FROM tenants ORDER BY created_at',
    );
    return res.rows.map((r) => ({ tenantId: r.tenant_id, name: r.name, status: r.status as Tenant['status'], createdAt: Number(r.created_at) }));
  }

  async setStatus(tenantId: string, status: Tenant['status']): Promise<void> {
    await this.driver.query('UPDATE tenants SET status = $2 WHERE tenant_id = $1', [tenantId, status]);
  }
}

/**
 * Bind a tenant to a repository so every operation is automatically scoped —
 * the structural guarantee that a caller cannot reach another tenant's rows.
 */
export class TenantScopedRepository<T extends Entity> {
  constructor(
    private readonly repo: TableRepository<T>,
    private readonly tenant: string,
  ) {}

  insert(entity: T): Promise<Stored<T>> {
    return this.repo.insert(this.tenant, entity);
  }
  upsert(entity: T): Promise<Stored<T>> {
    return this.repo.upsert(this.tenant, entity);
  }
  get(id: string): Promise<Stored<T> | undefined> {
    return this.repo.get(this.tenant, id);
  }
  update(entity: T, expectedVersion: number): Promise<Stored<T>> {
    return this.repo.update(this.tenant, entity, expectedVersion);
  }
  list(opts?: ListOptions): Promise<Array<Stored<T>>> {
    return this.repo.list(this.tenant, opts);
  }
  softDelete(id: string): Promise<boolean> {
    return this.repo.softDelete(this.tenant, id);
  }
  count(): Promise<number> {
    return this.repo.count(this.tenant);
  }
}

/**
 * Set the RLS session tenant (production role path). On a scoped, non-superuser
 * connection this activates the row-level-security policies; on the in-container
 * superuser connection it is a harmless no-op (superusers bypass RLS by design).
 */
export async function applyTenantSession(exec: SqlExecutor, tenant: string): Promise<void> {
  await exec.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenant]);
}
