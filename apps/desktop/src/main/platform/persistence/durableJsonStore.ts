/**
 * NeuroPause Platform — durable JSON store (ERP Session 18).
 *
 * The smallest REAL durable persistence for the modular monolith: a single
 * append-mostly JSON file written ATOMICALLY (temp + rename), versioned and
 * quarantine-not-reset via the shared store envelope. This is "the existing
 * database" for the desktop main process — the same file-backed durability the
 * 106 enterprise module stores use — not SQL (the Postgres backend is a separate,
 * gated service). It survives process restart: a committed record is on disk and
 * is re-read on the next `load`.
 *
 * A single record write is atomic (one rename is atomic on the filesystem), which
 * is the property the outbox pattern rests on here — the durable idempotency
 * record, the domain event and the outbox entry are ONE record, so committing
 * them is ONE atomic write.
 *
 * Deliberately NOT a second EnterpriseRecordStore: those are tenant-scoped by an
 * ambient resolver and deny-unbound; a platform-internal journal must key tenancy
 * EXPLICITLY on every record (no ambient scope), so it uses its own tiny store.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { envelopeStamp, readStoreFile } from '../../storage/storeEnvelope';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * The store-scope classification for this generic durable primitive. Its tenancy
 * is BORROWED (like DocumentLineStore): the primitive keeps no ambient scope,
 * because its consumer — the DurableCommandJournal — stamps `tenantId` on every
 * record and reads back ONLY per tenant. Declared TENANT because that is the
 * grain the consumer keys on. Written down rather than assumed.
 */
declareStoreScope({
  name: 'platform-durable-json',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap, no TTL, no eviction. `put` replaces exactly ONE record by its `id`; the only ' +
    'whole-store removal is `destroy` (test/reset only). A removal reaches exactly its own ' +
    'record, never a cap that could delete across a tenant boundary. The rows carry their own ' +
    'tenant field (`tenantId`), stamped and filtered by the consumer.',
  reason:
    'ERP Session 18. A generic durable key/value store used by the DurableCommandJournal, which ' +
    'stamps `tenantId` on every committed record and reads back ONLY per tenant (no ambient scope, ' +
    'no cross-tenant read). Like DocumentLineStore the owner is a field on the record and the ' +
    'scoped resolve is the caller’s; the primitive itself enforces no ambient scope by design.',
});

interface RecordFile<T> {
  schemaVersion?: number;
  records?: T[];
}

export class DurableJsonStore<T extends { id: string }> {
  private records = new Map<string, T>();
  private loaded = false;
  /**
   * PER-STORE WRITE SERIALIZATION (ERP Session 33). Writes to the SAME store run strictly
   * one-at-a-time through this chained-promise latch (the S24/S28/S31 pattern), so two concurrent
   * `put`s can never race on the write→rename step. Before this, concurrent persists shared a fixed
   * `${filePath}.tmp` and collided — one rename would throw ENOENT (the tmp already renamed by a
   * sibling) and a stale-snapshot persist could rename last and lose a committed record (S32 saw
   * ~7/8 failures). The latch is per INSTANCE, so UNRELATED stores are never serialized against each
   * other. The queue itself never rejects, so a transient persist failure never poisons later writes
   * — and because each persist snapshots the map at RUN time, the next persist re-writes everything,
   * making a failed-then-retried write self-healing. Per-record atomicity (one rename) is preserved.
   */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Load once from disk (idempotent). A missing file is an empty store. */
  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<RecordFile<T>>(this.filePath);
    if (result.state === 'loaded' && result.data?.records) {
      for (const r of result.data.records) if (r?.id) this.records.set(r.id, r);
    }
    this.loaded = true;
  }

  /** Force a re-read from disk — used by restart/durability tests. */
  async reload(): Promise<void> {
    this.records = new Map();
    this.loaded = false;
    await this.load();
  }

  /**
   * The actual write. Snapshots the map, writes a UNIQUE temp file, then renames it over the
   * canonical file. The per-persist unique tmp name (S33) means even a hypothetical un-serialized
   * persist can never collide on the temp path; a failed write removes its own tmp, so a stale temp
   * file is never left to become authoritative state.
   */
  private async persistNow(): Promise<void> {
    const file: RecordFile<T> = { ...envelopeStamp(), records: [...this.records.values()] };
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
      await fs.rename(tmp, this.filePath); // atomic
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined); // never leave a stale tmp behind
      throw err;
    }
  }

  /**
   * Enqueue a mutation onto the per-store serialized write chain and return a promise for THIS
   * operation. The chain tail is normalized to a resolved promise so one failure never blocks the
   * next write, while the caller still sees the honest per-operation outcome.
   */
  private enqueue(run: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Append or replace one record and persist ATOMICALLY. The commit point. Concurrent `put`s to the
   * same store are serialized (S33) so the final file always equals the final map — no lost write,
   * no temp-file collision. Establishes a per-store write ORDERING: concurrent puts commit in the
   * order they were enqueued.
   */
  async put(record: T): Promise<void> {
    await this.load();
    this.records.set(record.id, record);
    await this.enqueue(() => this.persistNow());
  }

  get(id: string): T | undefined {
    return this.records.get(id);
  }

  all(): T[] {
    return [...this.records.values()];
  }

  /** Test/reset only — remove the backing file and clear memory. Serialized after pending writes. */
  async destroy(): Promise<void> {
    await this.enqueue(async () => {
      this.records = new Map();
      this.loaded = false;
      await fs.rm(this.filePath, { force: true }).catch(() => undefined);
    });
  }
}
