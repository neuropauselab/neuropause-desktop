/**
 * Module 2 — Enterprise Memory. Persisted to the ONE database (real Postgres via the
 * persistence SqlDriver) — store / retrieve / summarize / expire / version / audit all
 * genuinely execute. Eight kinds (conversation, decision, meeting, operational, project,
 * customer, incident, evidence). Versioned (every store appends a new version), TTL-
 * expirable, tenant-scoped, and audited via an injected hook. It also implements the
 * ai-runtime `LongTermMemory` interface, so it can back `createAiRuntime` without a
 * second memory system.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from '@neuropause/persistence';
import type { LongTermMemory, MemoryEntry } from '@neuropause/ai-runtime';
import type { MemoryKind } from './constants';

export interface MemoryRecord {
  id: string;
  tenantId: string;
  kind: MemoryKind;
  scope: string;
  key: string;
  value: unknown;
  version: number;
  createdAt: number;
  expiresAt?: number;
}

export type MemoryAuditHook = (record: MemoryRecord, op: 'store' | 'expire') => void;

const parseVal = (v: unknown): unknown => (typeof v === 'string' ? safeJson(v) : v);
const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

interface Row {
  id: string;
  tenant_id: string;
  kind: string;
  scope: string;
  mkey: string;
  value: unknown;
  version: number | string;
  created_at: number | string;
  expires_at: number | string | null;
}

const toRecord = (r: Row): MemoryRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  kind: r.kind as MemoryKind,
  scope: r.scope,
  key: r.mkey,
  value: parseVal(r.value),
  version: Number(r.version),
  createdAt: Number(r.created_at),
  ...(r.expires_at !== null ? { expiresAt: Number(r.expires_at) } : {}),
});

export class EnterpriseMemory implements LongTermMemory {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock,
    private readonly audit?: MemoryAuditHook,
  ) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS intel_memory (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        mkey TEXT NOT NULL,
        value JSONB NOT NULL,
        version INTEGER NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT
      );
      CREATE INDEX IF NOT EXISTS intel_memory_lookup ON intel_memory (tenant_id, kind, scope, mkey, version);
    `);
  }

  /** Store a new version of a memory (append-only versioning). */
  async store(tenantId: string, kind: MemoryKind, scope: string, key: string, value: unknown, opts: { ttlMs?: number } = {}): Promise<MemoryRecord> {
    const now = this.clock.now();
    const max = await this.db.query<{ v: number | null }>(
      `SELECT max(version) AS v FROM intel_memory WHERE tenant_id=$1 AND kind=$2 AND scope=$3 AND mkey=$4`,
      [tenantId, kind, scope, key],
    );
    const version = (Number(max.rows[0]?.v ?? 0)) + 1;
    const expiresAt = opts.ttlMs !== undefined ? now + opts.ttlMs : undefined;
    const id = randomId('mem');
    await this.db.query(
      `INSERT INTO intel_memory (id, tenant_id, kind, scope, mkey, value, version, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [id, tenantId, kind, scope, key, JSON.stringify(value ?? null), version, now, expiresAt ?? null],
    );
    const record: MemoryRecord = { id, tenantId, kind, scope, key, value, version, createdAt: now, ...(expiresAt !== undefined ? { expiresAt } : {}) };
    this.audit?.(record, 'store');
    return record;
  }

  /** Latest non-expired version of a memory. */
  async retrieve(tenantId: string, kind: MemoryKind, scope: string, key: string): Promise<MemoryRecord | undefined> {
    const now = this.clock.now();
    const res = await this.db.query<Row>(
      `SELECT * FROM intel_memory WHERE tenant_id=$1 AND kind=$2 AND scope=$3 AND mkey=$4
       AND (expires_at IS NULL OR expires_at > $5) ORDER BY version DESC LIMIT 1`,
      [tenantId, kind, scope, key, now],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : undefined;
  }

  /** All versions of a memory, oldest first. */
  async history(tenantId: string, kind: MemoryKind, scope: string, key: string): Promise<MemoryRecord[]> {
    const res = await this.db.query<Row>(
      `SELECT * FROM intel_memory WHERE tenant_id=$1 AND kind=$2 AND scope=$3 AND mkey=$4 ORDER BY version`,
      [tenantId, kind, scope, key],
    );
    return res.rows.map(toRecord);
  }

  /** Latest non-expired record per key within a (kind, scope). */
  async list(tenantId: string, kind: MemoryKind, scope: string): Promise<MemoryRecord[]> {
    const now = this.clock.now();
    const res = await this.db.query<Row>(
      `SELECT DISTINCT ON (mkey) * FROM intel_memory WHERE tenant_id=$1 AND kind=$2 AND scope=$3
       AND (expires_at IS NULL OR expires_at > $4) ORDER BY mkey, version DESC`,
      [tenantId, kind, scope, now],
    );
    return res.rows.map(toRecord);
  }

  /** Deterministic extractive summary of a (kind, scope) — counts + latest keys. */
  async summarize(tenantId: string, kind: MemoryKind, scope: string): Promise<string> {
    const records = await this.list(tenantId, kind, scope);
    if (records.length === 0) return `No ${kind} memory for scope '${scope}'.`;
    const keys = records.map((r) => r.key).slice(0, 8).join(', ');
    return `${records.length} ${kind} memory item(s) in '${scope}' (latest keys: ${keys}).`;
  }

  /** Delete expired records for a tenant; returns the number removed. */
  async expire(tenantId: string): Promise<number> {
    const now = this.clock.now();
    const res = await this.db.query(`DELETE FROM intel_memory WHERE tenant_id=$1 AND expires_at IS NOT NULL AND expires_at <= $2`, [tenantId, now]);
    return res.affectedRows;
  }

  // ── ai-runtime LongTermMemory interface (so createAiRuntime can reuse this store) ──
  async put(scope: string, key: string, value: unknown): Promise<void> {
    await this.store(scope, 'operational', 'long-term', key, value);
  }
  async get(scope: string, key: string): Promise<unknown> {
    return (await this.retrieve(scope, 'operational', 'long-term', key))?.value;
  }
  async query(scope: string): Promise<MemoryEntry[]> {
    const records = await this.list(scope, 'operational', 'long-term');
    return records.map((r) => ({ key: r.key, value: r.value, at: r.createdAt }));
  }
}
