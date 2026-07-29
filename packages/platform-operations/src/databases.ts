/**
 * EPIC 3 — Production Databases. Descriptors + connection pools + health monitoring + replication
 * descriptors + backup integration + restore validation for PostgreSQL / Redis / Qdrant. Registration
 * REUSES the Sprint-2 infrastructure database activation, which records health as 'unknown' until a real
 * probe against a provisioned database runs — so health is never fabricated healthy. Backup + restore
 * validation REUSE the production backup platform. A provisioned, running database is infrastructure-
 * pending.
 */
import { randomId } from '@neuropause/cloud-core';
import { DB_ENGINES, NO_INFRA_DATA, type DbEngine } from './constants';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface DatabaseDescriptor {
  id: string;
  engine: DbEngine;
  name: string;
  poolSize: number;
  health: string; // 'unknown' until a real probe — never fabricated healthy
  reusedInfrastructure: boolean;
  replicationDescribed: boolean;
}

export class DatabasePlatform {
  private readonly databases = new Map<string, DatabaseDescriptor>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  engines(): readonly DbEngine[] {
    return DB_ENGINES;
  }

  async register(input: { engine: DbEngine; name: string; poolSize?: number; replicas?: number }): Promise<DatabaseDescriptor> {
    if (!DB_ENGINES.includes(input.engine)) throw new Error(`unknown db engine: ${input.engine}`);
    let health = 'unknown';
    let reusedInfrastructure = false;
    if (this.ctx.infrastructure) {
      const rec = await this.ctx.infrastructure.databases().register({ engine: input.engine, name: input.name });
      health = rec.health; // 'unknown' — infrastructure never fabricates healthy
      reusedInfrastructure = true;
    }
    const db: DatabaseDescriptor = {
      id: randomId('db'),
      engine: input.engine,
      name: input.name,
      poolSize: input.poolSize ?? 10,
      health,
      reusedInfrastructure,
      replicationDescribed: (input.replicas ?? 0) > 0,
    };
    this.databases.set(db.id, db);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_db', version: '_platform', epic: 'E3', operation: `register.${input.engine}`, targetId: input.name, evidence: 'infrastructure-pending', decision: `health=${health}` });
    return db;
  }

  /** Connection health requires a real probe against a provisioned database — reported honestly. */
  connectionHealth(id: string): { id: string; live: boolean; health: string } {
    const db = this.databases.get(id);
    if (!db) throw new Error(`unknown database: ${id}`);
    const live = db.health === 'healthy';
    return { id, live, health: db.health === 'unknown' ? NO_INFRA_DATA : db.health };
  }

  /** Backup + restore validation REUSE the production backup platform (real record-integrity check). */
  async validateBackup(id: string): Promise<{ id: string; reusedProduction: boolean; restoreValidated: boolean; note: string }> {
    const db = this.databases.get(id);
    if (!db) throw new Error(`unknown database: ${id}`);
    if (this.ctx.production) {
      const snap = await this.ctx.production.backups().createBackup({ kind: 'database', targetId: db.name });
      const val = await this.ctx.production.backups().validateRestore(snap.id);
      await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_db', version: '_platform', epic: 'E3', operation: 'validate-backup', targetId: db.name, evidence: 'live-verified', decision: val.valid ? 'restore validated' : 'validation failed' });
      return { id, reusedProduction: true, restoreValidated: val.valid, note: 'snapshot record integrity validated via production backups; real data restore requires a provisioned database' };
    }
    return { id, reusedProduction: false, restoreValidated: false, note: 'production backup platform not wired in' };
  }

  list(engine?: DbEngine): DatabaseDescriptor[] {
    const all = [...this.databases.values()];
    return engine ? all.filter((d) => d.engine === engine) : all;
  }
  healthyCount(): number {
    return [...this.databases.values()].filter((d) => d.health === 'healthy').length;
  }
}
