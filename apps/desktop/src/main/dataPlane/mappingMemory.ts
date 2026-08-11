/**
 * Phase 6 — Universal Enterprise Data Plane: smart mapping memory.
 *
 * When a reviewer confirms "Cust_Name → Customer.name", that decision should
 * not have to be made again for the next file from the same source.
 *
 * TENANT ISOLATION IS THE POINT. A mapping learned from one organization's
 * spreadsheet is that organization's private structural knowledge. Every read
 * and write is scoped by tenant id, and a lookup for tenant A can never return
 * a mapping saved by tenant B — asserted by test. There is no global corpus and
 * nothing is pooled across tenants.
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DataPlaneSavedMapping } from '@neuropause/shared';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { normalizeHeader } from './normalize';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'dataplane-mapping-memory',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /** P13C ROUND 10 — the checkable form of the prose below. */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    "Capped 5,000 PER TENANT as of Round 8 — the cap is computed over " +
    '`mappings.filter(m => m.tenantId === ctx.tenantId)`, which is exactly the predicate `list` and ' +
    "`find` read through, so an eviction can only remove the writer's own rows. It was an " +
    "install-wide `splice(0, length - MAX)`, so one tenant's imports deleted another tenant's " +
    'remembered column mappings and the next import of that file silently guessed again. The other ' +
    'removal, `forget(tenantId, signature)`, filters on the SAME tenant id and takes it from ' +
    '`deps.tenantId()` at the only call site (dataPlane/index.ts), never from the request payload.',
  reason: "A row is this organization's own spreadsheet headers mapped to its field decisions; m.tenantId is in every read predicate.",
});

interface MappingFile {
  schemaVersion?: number;
  mappings: DataPlaneSavedMapping[];
}

export const MAX_SAVED_MAPPINGS = 5_000;

/**
 * A stable signature for "a file shaped like this from this source": the sheet
 * name plus its normalized header set. Column ORDER is deliberately excluded —
 * exports reorder columns between runs while remaining the same shape.
 */
export function sourceSignature(tableName: string, headers: readonly string[]): string {
  const normalized = headers.map((h) => normalizeHeader(h)).filter((h) => h !== '').sort();
  const basis = `${normalizeHeader(tableName)}::${normalized.join('|')}`;
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

export class MappingMemoryStore {
  private mappings: DataPlaneSavedMapping[] = [];
  private loaded = false;

  /**
   * @param maxPerTenant Injectable so the PER-TENANT cap can be exercised without
   *                     writing five thousand rows. P13C Round 8 — a retention
   *                     boundary that is too slow to test is a boundary that does
   *                     not get tested, and this one used to delete other tenants'
   *                     rows.
   */
  constructor(
    private readonly filePath: string,
    private readonly maxPerTenant: number = MAX_SAVED_MAPPINGS,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const res = await readStoreFile<MappingFile>(this.filePath);
    if (res.state === 'loaded' && res.data && Array.isArray(res.data.mappings)) {
      this.mappings = res.data.mappings;
    }
    this.loaded = true;
  }

  /** Every mapping this tenant has saved. Never returns another tenant's. */
  list(tenantId: string, signature?: string): DataPlaneSavedMapping[] {
    return this.mappings.filter(
      (m) => m.tenantId === tenantId && (signature === undefined || m.signature === signature),
    );
  }

  /** The mapping for one signature, scoped to the tenant. */
  find(tenantId: string, signature: string): DataPlaneSavedMapping | null {
    return this.mappings.find((m) => m.tenantId === tenantId && m.signature === signature) ?? null;
  }

  /**
   * Save or update a mapping. Re-saving the same signature bumps `version` and
   * keeps the original `createdAt` — mapping changes are versioned, not silently
   * overwritten, so an audit can see the shape changed.
   */
  async save(
    input: { signature: string; entityId: string; columns: { header: string; fieldKey: string }[] },
    ctx: { tenantId: string; actor: string | null; now: string },
  ): Promise<DataPlaneSavedMapping> {
    await this.load();
    const existing = this.find(ctx.tenantId, input.signature);
    if (existing) {
      existing.entityId = input.entityId;
      existing.columns = input.columns;
      existing.version += 1;
      existing.updatedAt = ctx.now;
      existing.updatedBy = ctx.actor;
      await this.persist();
      return existing;
    }
    const created: DataPlaneSavedMapping = {
      signature: input.signature,
      entityId: input.entityId,
      columns: input.columns,
      tenantId: ctx.tenantId,
      version: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      updatedBy: ctx.actor,
      useCount: 0,
    };
    this.mappings.push(created);
    // The cap is checked against the WRITER's own rows, not the array length —
    // `this.mappings.length > MAX` would never fire for a tenant under the cap and
    // would fire for one that is, which is the bug in miniature.
    {
      /**
       * PER TENANT. P13C ROUND 8.
       *
       * `splice(0, length - MAX)` walked one shared array oldest-first, so one
       * tenant's imports deleted another tenant's remembered column mappings —
       * and a lost mapping means the next import of that file silently guesses
       * again. Eighth install-wide cap this program has found behind correct read
       * filters. A RETENTION CAP IS A WRITE.
       */
      const mine = this.mappings.filter((m) => m.tenantId === ctx.tenantId);
      if (mine.length > this.maxPerTenant) {
        const doomed = new Set(mine.slice(0, mine.length - this.maxPerTenant));
        this.mappings = this.mappings.filter((m) => !doomed.has(m));
      }
    }
    await this.persist();
    return created;
  }

  async forget(tenantId: string, signature: string): Promise<boolean> {
    await this.load();
    const before = this.mappings.length;
    this.mappings = this.mappings.filter((m) => !(m.tenantId === tenantId && m.signature === signature));
    if (this.mappings.length === before) return false;
    await this.persist();
    return true;
  }

  /** Record that a saved mapping was reused, for the review UI. */
  async noteUse(tenantId: string, signature: string, now: string): Promise<void> {
    const m = this.find(tenantId, signature);
    if (!m) return;
    m.useCount += 1;
    m.updatedAt = now;
    await this.persist();
  }

  count(): number {
    return this.mappings.length;
  }

  private async persist(): Promise<void> {
    const payload: MappingFile = { ...envelopeStamp(), mappings: this.mappings };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}

/**
 * Apply a remembered mapping over a fresh classification. A saved mapping is a
 * REVIEWER'S DECISION, so it outranks the machine's guess for the columns it
 * covers — but only for those columns, and it never invents a column that is
 * not present in this file.
 */
export function applySavedMapping<
  T extends { header: string; fieldKey: string | null; fieldLabel: string | null; confidence: number; band: string; reasons: string[] },
>(mappings: T[], saved: DataPlaneSavedMapping, fieldLabelFor: (key: string) => string | null): T[] {
  const byHeader = new Map(saved.columns.map((c) => [normalizeHeader(c.header), c.fieldKey]));
  return mappings.map((m) => {
    const key = byHeader.get(normalizeHeader(m.header));
    if (key === undefined || key === m.fieldKey) return m;
    return {
      ...m,
      fieldKey: key,
      fieldLabel: fieldLabelFor(key),
      confidence: 1,
      band: 'high',
      reasons: [`remembered mapping confirmed by a reviewer for this source (v${saved.version})`],
    };
  });
}
