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

  constructor(private readonly filePath: string) {}

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
    if (this.mappings.length > MAX_SAVED_MAPPINGS) {
      this.mappings.splice(0, this.mappings.length - MAX_SAVED_MAPPINGS);
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
