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

  private async persist(): Promise<void> {
    const file: RecordFile<T> = { ...envelopeStamp(), records: [...this.records.values()] };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath); // atomic
  }

  /** Append or replace one record and persist ATOMICALLY. The commit point. */
  async put(record: T): Promise<void> {
    await this.load();
    this.records.set(record.id, record);
    await this.persist();
  }

  get(id: string): T | undefined {
    return this.records.get(id);
  }

  all(): T[] {
    return [...this.records.values()];
  }

  /** Test/reset only — remove the backing file and clear memory. */
  async destroy(): Promise<void> {
    this.records = new Map();
    this.loaded = false;
    await fs.rm(this.filePath, { force: true }).catch(() => undefined);
  }
}
