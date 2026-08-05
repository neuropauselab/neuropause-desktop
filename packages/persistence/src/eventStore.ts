/**
 * Event store (NCEA 12.0, Phase 4). ONE append-only log for every platform event
 * (runtime, AI, connector, workspace, CKDL). Rows are only ever INSERTed —
 * there is no update or delete path — and each carries a content hash for
 * tamper-evidence and a `schema_version` for event evolution. Ordering is a
 * monotonic `seq` (bigserial). Supports replay from a sequence, per-stream
 * snapshots (so replay need not start from zero), and an upcaster seam for
 * migrating old event versions on read.
 */
import { sha256Hex, type Clock } from '@neuropause/cloud-core';
import type { SqlExecutor } from './driver';

export interface EventInput {
  stream: string;
  type: string;
  topic: string;
  payload: Record<string, unknown>;
  schemaVersion?: number;
}

export interface StoredEvent {
  seq: number;
  tenant: string;
  stream: string;
  type: string;
  topic: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  at: number;
  hash: string;
}

export interface ReadOptions {
  stream?: string;
  fromSeq?: number;
  limit?: number;
}

/** Upcaster: migrate an old-version payload of a given type forward on read. */
export type Upcaster = (payload: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;

interface EventRow {
  seq: number | string;
  tenant_id: string;
  stream: string;
  type: string;
  topic: string;
  schema_version: number;
  payload: unknown;
  at: number | string;
  hash: string;
}

function toEvent(row: EventRow, upcasters: Map<string, Upcaster>): StoredEvent {
  let payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>;
  const upcaster = upcasters.get(row.type);
  if (upcaster) payload = upcaster(payload, row.schema_version);
  return {
    seq: Number(row.seq),
    tenant: row.tenant_id,
    stream: row.stream,
    type: row.type,
    topic: row.topic,
    schemaVersion: row.schema_version,
    payload,
    at: Number(row.at),
    hash: row.hash,
  };
}

export class EventStore {
  private readonly upcasters = new Map<string, Upcaster>();

  constructor(
    private readonly exec: SqlExecutor,
    private readonly clock: Clock,
  ) {}

  /** Register an upcaster to migrate an event type's old payloads forward on read. */
  registerUpcaster(type: string, upcaster: Upcaster): void {
    this.upcasters.set(type, upcaster);
  }

  async append(tenant: string, input: EventInput): Promise<StoredEvent> {
    const at = this.clock.now();
    const schemaVersion = input.schemaVersion ?? 1;
    const hash = sha256Hex(`${tenant}|${input.stream}|${input.type}|${schemaVersion}|${JSON.stringify(input.payload)}|${at}`);
    const res = await this.exec.query<{ seq: number | string }>(
      `INSERT INTO events (tenant_id, stream, type, topic, schema_version, payload, at, hash)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING seq`,
      [tenant, input.stream, input.type, input.topic, schemaVersion, JSON.stringify(input.payload), at, hash],
    );
    return { seq: Number(res.rows[0]!.seq), tenant, stream: input.stream, type: input.type, topic: input.topic, schemaVersion, payload: input.payload, at, hash };
  }

  async read(tenant: string, opts: ReadOptions = {}): Promise<StoredEvent[]> {
    const clauses = ['tenant_id = $1'];
    const params: unknown[] = [tenant];
    if (opts.stream !== undefined) {
      params.push(opts.stream);
      clauses.push(`stream = $${params.length}`);
    }
    if (opts.fromSeq !== undefined) {
      params.push(opts.fromSeq);
      clauses.push(`seq > $${params.length}`);
    }
    const limit = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
    const res = await this.exec.query<EventRow>(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY seq${limit}`, params);
    return res.rows.map((r) => toEvent(r, this.upcasters));
  }

  /** Replay events in order through a handler; returns the count replayed. */
  async replay(tenant: string, handler: (e: StoredEvent) => void | Promise<void>, opts: ReadOptions = {}): Promise<number> {
    const events = await this.read(tenant, opts);
    for (const e of events) await handler(e);
    return events.length;
  }

  async snapshot(tenant: string, stream: string, seq: number, state: Record<string, unknown>): Promise<void> {
    await this.exec.query(
      `INSERT INTO event_snapshots (tenant_id, stream, seq, state, at) VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (tenant_id, stream) DO UPDATE SET seq = EXCLUDED.seq, state = EXCLUDED.state, at = EXCLUDED.at`,
      [tenant, stream, seq, JSON.stringify(state), this.clock.now()],
    );
  }

  async loadSnapshot(tenant: string, stream: string): Promise<{ seq: number; state: Record<string, unknown> } | undefined> {
    const res = await this.exec.query<{ seq: number | string; state: unknown }>('SELECT seq, state FROM event_snapshots WHERE tenant_id = $1 AND stream = $2', [
      tenant,
      stream,
    ]);
    const row = res.rows[0];
    if (!row) return undefined;
    return { seq: Number(row.seq), state: (typeof row.state === 'string' ? JSON.parse(row.state) : row.state) as Record<string, unknown> };
  }

  async count(tenant: string): Promise<number> {
    const res = await this.exec.query<{ n: number | string }>('SELECT count(*)::int AS n FROM events WHERE tenant_id = $1', [tenant]);
    return Number(res.rows[0]?.n ?? 0);
  }
}
