/**
 * EPIC 4 — Database Activation. PostgreSQL, Redis, Qdrant, and object/file/cache/blob storage
 * registries with backup targets, connection health, and capacity monitoring. Databases are NEVER
 * fabricated as healthy: a registered database has health 'unknown' and status 'pending' until a
 * REAL connection probe reports — there is no probe here, so nothing reads healthy. Backup targets
 * REUSE the Sprint-1 backup foundation when connected.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';
import { DB_ENGINES, NO_INFRA_DATA, type DbEngine } from './constants';

export interface DatabaseRecord {
  id: string;
  engine: DbEngine;
  name: string;
  status: 'pending' | 'active';
  health: 'unknown' | 'healthy' | 'unhealthy';
  backupTarget: string;
  note: string;
}

export class DatabaseActivation {
  private readonly databases = new Map<string, DatabaseRecord>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext = {},
  ) {}

  async register(input: { engine: DbEngine; name: string; org?: string }): Promise<DatabaseRecord> {
    if (!DB_ENGINES.includes(input.engine)) throw new Error(`unknown database engine: ${input.engine}`);
    const db: DatabaseRecord = {
      id: randomId('db'),
      engine: input.engine,
      name: input.name,
      status: 'pending',
      health: 'unknown', // never fabricated healthy
      backupTarget: `backup:${input.engine}:${input.name}`,
      note: 'database represented — health is unknown until a real connection probe reports (none here)',
    };
    this.databases.set(db.id, db);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E4', operation: `database.register.${input.engine}`, targetId: db.id, evidence: 'infrastructure-pending' });
    return db;
  }

  /** Connection health — honest 'No infrastructure data available' with no real probe. */
  connectionHealth(id: string): { id: string; health: string; note: string } {
    const db = this.databases.get(id);
    if (!db) throw new Error(`no database ${id}`);
    return { id, health: db.health === 'unknown' ? NO_INFRA_DATA : db.health, note: 'connection health requires a real probe against a provisioned database' };
  }

  /** Backup targets — REUSES the Sprint-1 backup foundation policies when connected. */
  backupPolicy(): { retentionDays: number | string; source: string } {
    if (this.ctx.deploy) return { retentionDays: this.ctx.deploy.backups().policies().retentionDays, source: 'reused Sprint-1 backup foundation' };
    return { retentionDays: NO_INFRA_DATA, source: 'no deploy foundation connected' };
  }

  get(id: string): DatabaseRecord | undefined { return this.databases.get(id); }
  list(engine?: DbEngine): DatabaseRecord[] {
    const all = [...this.databases.values()];
    return engine ? all.filter((d) => d.engine === engine) : all;
  }
  healthyCount(): number { return [...this.databases.values()].filter((d) => d.health === 'healthy').length; }
  count(): number { return this.databases.size; }
}
