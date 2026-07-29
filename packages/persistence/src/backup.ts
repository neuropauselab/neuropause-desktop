/**
 * Backup & recovery (NCEA 12.0, Phase 8). Logical backup/restore over the SqlDriver:
 * a `full()` dump of every table (optionally tenant-scoped), an `incremental()`
 * dump of rows changed since a checkpoint, a checksum for integrity, and a
 * `restore()` that re-inserts rows idempotently (events append-only) so a
 * backup→wipe→restore round-trip reproduces the exact state — no data loss. This
 * is the application-level backup that is testable in-container. Cluster-level
 * point-in-time recovery, base backups, and WAL archiving are Postgres operational
 * procedures documented in the recovery guide (infra-pending here).
 */
import { sha256Hex, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from './driver';
import { TENANT_SCOPED_ENTITY_TABLES } from './schema';

interface TableSpec {
  cols: string[];
  jsonb: string[];
  pk: string[];
  tenantScoped: boolean;
  appendOnly?: boolean;
}

const ENTITY_COLS = ['tenant_id', 'id', 'doc', 'version', 'created_at', 'updated_at', 'deleted_at'];

const SPECS: Record<string, TableSpec> = {
  tenants: { cols: ['tenant_id', 'name', 'status', 'created_at'], jsonb: [], pk: ['tenant_id'], tenantScoped: false },
  ...Object.fromEntries(
    [...TENANT_SCOPED_ENTITY_TABLES, 'blob_metadata'].map((t) => [
      t,
      { cols: ENTITY_COLS, jsonb: ['doc'], pk: ['tenant_id', 'id'], tenantScoped: true } as TableSpec,
    ]),
  ),
  events: {
    cols: ['seq', 'tenant_id', 'stream', 'type', 'topic', 'schema_version', 'payload', 'at', 'hash'],
    jsonb: ['payload'],
    pk: ['seq'],
    tenantScoped: true,
    appendOnly: true,
  },
  event_snapshots: { cols: ['tenant_id', 'stream', 'seq', 'state', 'at'], jsonb: ['state'], pk: ['tenant_id', 'stream'], tenantScoped: true },
};

export interface BackupBundle {
  formatVersion: number;
  createdAt: number;
  scope: 'full' | 'incremental' | 'tenant';
  tenant?: string;
  since?: number;
  tables: Record<string, Array<Record<string, unknown>>>;
  checksum: string;
}

export interface RestoreResult {
  tables: Record<string, number>;
  rows: number;
}

function bundleChecksum(tables: Record<string, unknown[]>): string {
  const keys = Object.keys(tables).sort();
  return sha256Hex(JSON.stringify(keys.map((k) => [k, tables[k]])));
}

export class BackupManager {
  constructor(
    private readonly driver: SqlDriver,
    private readonly clock: Clock,
  ) {}

  async full(opts: { tenant?: string } = {}): Promise<BackupBundle> {
    return this.dump(opts.tenant ? 'tenant' : 'full', { ...(opts.tenant !== undefined ? { tenant: opts.tenant } : {}) });
  }

  /** Rows changed since `since` (entity/blob tables by updated_at/created_at; events by `at`). */
  async incremental(since: number, opts: { tenant?: string } = {}): Promise<BackupBundle> {
    return this.dump('incremental', { since, ...(opts.tenant !== undefined ? { tenant: opts.tenant } : {}) });
  }

  private async dump(scope: BackupBundle['scope'], opts: { tenant?: string; since?: number }): Promise<BackupBundle> {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    for (const [table, spec] of Object.entries(SPECS)) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (opts.tenant !== undefined && spec.tenantScoped) {
        params.push(opts.tenant);
        clauses.push(`tenant_id = $${params.length}`);
      } else if (opts.tenant !== undefined && table === 'tenants') {
        params.push(opts.tenant);
        clauses.push(`tenant_id = $${params.length}`);
      }
      if (opts.since !== undefined) {
        const col = spec.cols.includes('updated_at') ? 'updated_at' : spec.cols.includes('created_at') ? 'created_at' : spec.cols.includes('at') ? 'at' : null;
        if (col) {
          params.push(opts.since);
          clauses.push(`${col} >= $${params.length}`);
        }
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const res = await this.driver.query<Record<string, unknown>>(`SELECT ${spec.cols.join(', ')} FROM ${table}${where}`, params);
      tables[table] = res.rows;
    }
    return {
      formatVersion: 1,
      createdAt: this.clock.now(),
      scope,
      ...(opts.tenant !== undefined ? { tenant: opts.tenant } : {}),
      ...(opts.since !== undefined ? { since: opts.since } : {}),
      tables,
      checksum: bundleChecksum(tables),
    };
  }

  verify(bundle: BackupBundle): boolean {
    return bundleChecksum(bundle.tables) === bundle.checksum;
  }

  /** Restore a bundle. Idempotent: existing rows are updated (events are appended if new). */
  async restore(bundle: BackupBundle): Promise<RestoreResult> {
    if (!this.verify(bundle)) throw new Error('backup integrity check failed — checksum mismatch');
    const result: RestoreResult = { tables: {}, rows: 0 };
    await this.driver.transaction(async (tx) => {
      for (const [table, rows] of Object.entries(bundle.tables)) {
        const spec = SPECS[table];
        if (!spec) continue;
        let n = 0;
        for (const row of rows) {
          const values = spec.cols.map((c, i) => (spec.jsonb.includes(c) ? `$${i + 1}::jsonb` : `$${i + 1}`));
          const params = spec.cols.map((c) => (spec.jsonb.includes(c) && row[c] != null ? JSON.stringify(row[c]) : (row[c] ?? null)));
          const nonPk = spec.cols.filter((c) => !spec.pk.includes(c));
          const conflict = spec.appendOnly
            ? 'DO NOTHING'
            : nonPk.length
              ? `DO UPDATE SET ${nonPk.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
              : 'DO NOTHING';
          await tx.query(
            `INSERT INTO ${table} (${spec.cols.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT (${spec.pk.join(', ')}) ${conflict}`,
            params,
          );
          n += 1;
        }
        result.tables[table] = n;
        result.rows += n;
      }
    });
    return result;
  }
}
