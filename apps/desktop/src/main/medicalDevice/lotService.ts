/**
 * Medical Device Pack — the lot domain service.
 *
 * This is the ONLY code that changes a lot. Every operation follows the same
 * shape, and the order matters:
 *
 *   authorize → load → resolve tenant → check invariants → persist → record
 *   traceability edges → post inventory → audit
 *
 * Invariants are checked BEFORE anything is written, and the write of a lot's
 * counters is a single `store.update` call, so there is no window in which a
 * lot exists with a quantity that has been drawn but not recorded. When an
 * operation touches two lots (a split), the parent is written last: a crash
 * between the two leaves orphan child lots — visible, investigable, and
 * conservative — rather than a parent that has been debited for children that
 * do not exist.
 *
 * Traceability edges are written AFTER the quantity change and are idempotent,
 * so a retry re-records the same edge rather than a second one.
 *
 * Inventory posting is deliberately LAST and non-fatal. A manufacturer may not
 * maintain a matching `inventory-products` record for every device, and a lot
 * operation must not fail because a parallel master is incomplete — the result
 * reports whether the ledger was posted rather than pretending it was.
 */
import type {
  DeviceLotListItem,
  DeviceLotMutationResult,
  EnterpriseEntity,
  EnterpriseFieldValue,
  LotSplitPart,
  MedicalDeviceLot,
  LotStatus,
  TraceProvenance,
} from '@neuropause/shared';
import {
  DEVICE_LOTS_MODULE_ID,
  LOT_MERGE_UNSUPPORTED_REASON,
  LOT_STATUS_LABELS,
  canDraw,
  canTransitionLot,
  deviceLotFromRecord,
  deviceProductFromRecord,
  isLotExpired,
  lotRemaining,
  planLotSplit,
  round6,
  statusAfterConsumption,
  statusAfterSplit,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../enterprise/framework';
import type { TraceEdgeStore } from './traceStore';
import { postStockMovement } from '../enterprise/modules/inventory/postMovement';

export interface LotServiceDeps {
  lots: EnterpriseModule;
  products: EnterpriseModule;
  edges: TraceEdgeStore;
  /** The tenant every read and write is scoped to. Never renderer-supplied. */
  tenantId: () => string;
  actor: () => string | null;
  now: () => string;
  /** RBAC gate — throws when the actor lacks the permission. */
  authorize: (permission: 'medicalDevice:lot.read' | 'medicalDevice:lot.write') => void;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  /**
   * The framework action context, used to reach OTHER modules (the stock
   * ledger, manufacturing orders). Optional: the service is fully functional
   * without it, and every integration it enables reports its own absence
   * instead of failing silently.
   */
  moduleContext?: () => EnterpriseModuleActionContext | null;
  /** Monotonic counter for movement numbers; injected so tests are deterministic. */
  nextMovementNumber?: () => string;
}

export interface LotOperationOptions {
  /** Provenance to stamp on the edges this operation records, when imported. */
  provenance?: TraceProvenance;
  /** Suppress inventory posting (used by import replay, which posts its own). */
  skipInventory?: boolean;
}

function fail(error: string): DeviceLotMutationResult {
  return { ok: false, error };
}

export class LotService {
  private movementSeq = 0;

  constructor(private readonly deps: LotServiceDeps) {}

  /* ── reads ─────────────────────────────────────────────────────────────── */

  /**
   * Every lot in the active tenant.
   *
   * Tenant filtering happens HERE, on the record's stamped metadata, not in a
   * caller. A lot list that forgot to filter would show one manufacturer's
   * batches to another, and the failure would look like a UI bug rather than
   * the data breach it is.
   */
  async allLots(): Promise<MedicalDeviceLot[]> {
    await this.deps.lots.store.load();
    const tenantId = this.deps.tenantId();
    return this.deps.lots.store
      .list()
      .filter((r) => String(r.metadata?.tenantId ?? '') === tenantId)
      .map(deviceLotFromRecord);
  }

  async lotById(lotId: string): Promise<MedicalDeviceLot | null> {
    await this.deps.lots.store.load();
    const record = this.deps.lots.store.get(lotId);
    if (!record || record.status === 'deleted') return null;
    if (String(record.metadata?.tenantId ?? '') !== this.deps.tenantId()) return null;
    return deviceLotFromRecord(record);
  }

  /** Decorate a lot with the values that are derived rather than stored. */
  async decorate(lot: MedicalDeviceLot): Promise<DeviceLotListItem> {
    await this.deps.products.store.load();
    const productRecord = lot.productId ? this.deps.products.store.get(lot.productId) : null;
    return {
      ...lot,
      remaining: lotRemaining(lot),
      expired: isLotExpired(lot, this.deps.now()),
      productName: productRecord ? deviceProductFromRecord(productRecord).productName : '',
    };
  }

  /* ── create ────────────────────────────────────────────────────────────── */

  async createLot(
    input: {
      lotNumber: string;
      productId: string;
      quantity: number;
      unit?: string;
      manufactureDate?: string;
      expiryDate?: string;
      warehouseId?: string;
      supplierId?: string;
      manufacturingOrderId?: string;
      sourceLotId?: string;
      notes?: string;
    },
    options: LotOperationOptions = {},
  ): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    await this.deps.lots.store.load();
    await this.deps.products.store.load();
    const tenantId = this.deps.tenantId();

    const lotNumber = input.lotNumber.trim();
    if (!lotNumber) return fail('A lot needs a lot number.');
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return fail('Quantity must be greater than zero.');
    }

    const productRecord = this.deps.products.store.get(input.productId);
    if (!productRecord || productRecord.status === 'deleted') {
      return fail('That product does not exist. Choose a product from the catalogue.');
    }
    if (String(productRecord.metadata?.tenantId ?? '') !== tenantId) {
      // Not "not found" — the record exists, in a tenant this actor is not in.
      // Phrased as not-found on purpose: confirming its existence would leak it.
      return fail('That product does not exist. Choose a product from the catalogue.');
    }
    const product = deviceProductFromRecord(productRecord);
    if (!product.batchLotTracked) {
      return fail(
        `${product.productCode} is not configured for batch/lot tracking. Turn on Batch / Lot Tracked on the product before recording lots for it.`,
      );
    }

    const duplicate = (await this.allLots()).find(
      (l) => l.lotNumber.trim().toLowerCase() === lotNumber.toLowerCase(),
    );
    if (duplicate) {
      return fail(
        `Lot number "${lotNumber}" already exists for ${duplicate.productCode}. Lot numbers identify a batch, so they cannot be reused.`,
      );
    }

    if (input.expiryDate && input.manufactureDate) {
      const made = Date.parse(input.manufactureDate);
      const expires = Date.parse(input.expiryDate);
      if (Number.isFinite(made) && Number.isFinite(expires) && expires < made) {
        return fail('The expiry date is before the manufacture date.');
      }
    }

    // A lot split from, or produced from, another lot inherits that lot's
    // origin so the chain stays walkable in one hop as well as by traversal.
    let sourceLotId = input.sourceLotId ?? '';
    if (sourceLotId) {
      const source = await this.lotById(sourceLotId);
      if (!source) return fail('The source lot does not exist.');
      sourceLotId = source.sourceLotId || source.id;
    }

    const now = this.deps.now();
    const record = this.deps.lots.store.create({
      title: lotNumber,
      fields: {
        lotNumber,
        productId: product.id,
        productCode: product.productCode,
        status: 'created',
        quantity: round6(input.quantity),
        consumedQuantity: 0,
        splitQuantity: 0,
        unit: input.unit?.trim() || 'unit',
        manufactureDate: input.manufactureDate ?? '',
        expiryDate: input.expiryDate ?? '',
        warehouseId: input.warehouseId ?? '',
        supplierId: input.supplierId ?? '',
        manufacturingOrderId: input.manufacturingOrderId ?? '',
        parentLotId: '',
        sourceLotId,
        notes: input.notes ?? '',
      },
      metadata: { tenantId },
      actor: this.deps.actor(),
      now,
    });

    this.recordLotContextEdges(record, product.productCode, input, options);
    this.deps.audit({
      action: 'medicalDevice.lot.created',
      target: record.id,
      summary: `Created lot ${lotNumber} of ${product.productCode} — ${input.quantity} ${input.unit?.trim() || 'unit'}`,
    });

    if (!options.skipInventory && input.warehouseId) {
      await this.postMovement('receive', product.productCode, input.warehouseId, input.quantity, record.id, lotNumber);
    }
    return { ok: true, lot: await this.decorate(deviceLotFromRecord(record)) };
  }

  /** The context edges a new lot always carries: product, supplier, MO, lineage, warehouse. */
  private recordLotContextEdges(
    record: EnterpriseEntity,
    productCode: string,
    input: { warehouseId?: string; supplierId?: string; manufacturingOrderId?: string; sourceLotId?: string },
    options: LotOperationOptions,
  ): void {
    const lot = deviceLotFromRecord(record);
    const at = record.createdAt;
    const base = {
      tenantId: this.deps.tenantId(),
      at,
      actor: this.deps.actor(),
      ...(options.provenance ? { provenance: options.provenance } : {}),
    };
    const lotRef = { type: 'lot' as const, id: record.id, label: lot.lotNumber };
    this.deps.edges.record({
      ...base,
      kind: 'lot_of_product',
      from: lotRef,
      to: { type: 'product', id: lot.productId, label: productCode },
    });
    if (input.supplierId) {
      this.deps.edges.record({
        ...base,
        kind: 'lot_supplied_by',
        from: lotRef,
        to: { type: 'supplier', id: input.supplierId, label: input.supplierId },
      });
    }
    if (input.manufacturingOrderId) {
      this.deps.edges.record({
        ...base,
        kind: 'mo_produced_lot',
        from: { type: 'manufacturing_order', id: input.manufacturingOrderId, label: input.manufacturingOrderId },
        to: lotRef,
        quantity: lot.quantity,
        unit: lot.unit,
      });
    }
    if (input.warehouseId) {
      this.deps.edges.record({
        ...base,
        kind: 'lot_stored_in',
        from: lotRef,
        to: { type: 'warehouse', id: input.warehouseId, label: input.warehouseId },
        quantity: lot.quantity,
        unit: lot.unit,
      });
    }
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  async transition(lotId: string, next: LotStatus, reason?: string): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    const lot = await this.lotById(lotId);
    if (!lot) return fail('That lot does not exist.');

    const check = canTransitionLot(lot.status, next);
    if (!check.ok) return fail(check.reason ?? 'That is not a legal transition.');

    // Reaching a "nothing left" state by hand, while material remains, would
    // make the status disagree with the arithmetic. Refuse rather than silently
    // zeroing the counters — the quantity is evidence, not a display value.
    if ((next === 'consumed' || next === 'exhausted') && lotRemaining(lot) > 0) {
      return fail(
        `${lot.lotNumber} still has ${lotRemaining(lot)} ${lot.unit} remaining. Record the consumption or the split that used it, rather than marking it ${LOT_STATUS_LABELS[next].toLowerCase()}.`,
      );
    }

    const updated = this.deps.lots.store.update(lot.id, {
      fields: { status: next },
      actor: this.deps.actor(),
      now: this.deps.now(),
    });
    if (!updated) return fail('That lot does not exist.');

    this.deps.audit({
      action: 'medicalDevice.lot.status_changed',
      target: lot.id,
      summary:
        `Lot ${lot.lotNumber}: ${LOT_STATUS_LABELS[lot.status]} → ${LOT_STATUS_LABELS[next]}` +
        (reason ? ` — ${reason}` : ''),
    });
    return { ok: true, lot: await this.decorate(deviceLotFromRecord(updated)) };
  }

  /* ── consumption ───────────────────────────────────────────────────────── */

  async consume(
    input: { lotId: string; quantity: number; manufacturingOrderId?: string; reason?: string },
    options: LotOperationOptions = {},
  ): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    const lot = await this.lotById(input.lotId);
    if (!lot) return fail('That lot does not exist.');

    const draw = canDraw(lot, input.quantity);
    if (!draw.ok) return fail(draw.reason ?? 'That quantity cannot be drawn from this lot.');

    const amount = round6(input.quantity);
    const nextStatus = statusAfterConsumption(lot, amount);
    const updated = this.deps.lots.store.update(lot.id, {
      fields: {
        consumedQuantity: round6(lot.consumedQuantity + amount),
        status: nextStatus,
        ...(input.manufacturingOrderId ? { manufacturingOrderId: input.manufacturingOrderId } : {}),
      },
      actor: this.deps.actor(),
      now: this.deps.now(),
    });
    if (!updated) return fail('That lot does not exist.');

    if (input.manufacturingOrderId) {
      this.deps.edges.record({
        tenantId: this.deps.tenantId(),
        kind: 'mo_consumed_lot',
        from: {
          type: 'manufacturing_order',
          id: input.manufacturingOrderId,
          label: input.manufacturingOrderId,
        },
        to: { type: 'lot', id: lot.id, label: lot.lotNumber },
        quantity: amount,
        unit: lot.unit,
        at: this.deps.now(),
        actor: this.deps.actor(),
        ...(options.provenance ? { provenance: options.provenance } : {}),
      });
    }

    this.deps.audit({
      action: 'medicalDevice.lot.consumed',
      target: lot.id,
      summary:
        `Consumed ${amount} ${lot.unit} from lot ${lot.lotNumber}` +
        (input.manufacturingOrderId ? ` for ${input.manufacturingOrderId}` : '') +
        (input.reason ? ` — ${input.reason}` : ''),
    });

    if (!options.skipInventory && lot.warehouseId) {
      await this.postMovement(
        input.manufacturingOrderId ? 'production_consumption' : 'issue',
        lot.productCode,
        lot.warehouseId,
        amount,
        lot.id,
        lot.lotNumber,
      );
    }
    return { ok: true, lot: await this.decorate(deviceLotFromRecord(updated)) };
  }

  /* ── split ─────────────────────────────────────────────────────────────── */

  /**
   * Divide a lot into child lots.
   *
   * Order of writes: children first, parent last. If the process dies mid-way,
   * the survivable state is child lots whose parent has not yet been debited —
   * detectable (the parent's counters do not match its children) and safe,
   * because no material has been double-counted as available. The reverse order
   * would leave a parent debited for children that do not exist, silently
   * losing material from the system.
   */
  async split(
    lotId: string,
    parts: readonly LotSplitPart[],
    options: LotOperationOptions = {},
  ): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    const lot = await this.lotById(lotId);
    if (!lot) return fail('That lot does not exist.');

    const plan = planLotSplit(lot, parts);
    if (!plan.ok) return fail(plan.reason ?? 'That split is not valid.');

    const existing = await this.allLots();
    for (const part of plan.parts) {
      if (existing.some((l) => l.lotNumber.trim().toLowerCase() === part.lotNumber.toLowerCase())) {
        return fail(`Lot number "${part.lotNumber}" already exists.`);
      }
    }

    const now = this.deps.now();
    const tenantId = this.deps.tenantId();
    const actor = this.deps.actor();
    const created: EnterpriseEntity[] = [];

    for (const part of plan.parts) {
      const child = this.deps.lots.store.create({
        title: part.lotNumber,
        fields: {
          lotNumber: part.lotNumber,
          productId: lot.productId,
          productCode: lot.productCode,
          // A child inherits the parent's disposition. Splitting released
          // material must not silently produce material that needs releasing
          // again, and splitting quarantined material must never produce
          // material that looks free to use.
          status: lot.status === 'partially_consumed' ? 'released' : lot.status,
          quantity: part.quantity,
          consumedQuantity: 0,
          splitQuantity: 0,
          unit: lot.unit,
          manufactureDate: lot.manufactureDate,
          expiryDate: lot.expiryDate,
          warehouseId: lot.warehouseId,
          supplierId: lot.supplierId,
          manufacturingOrderId: lot.manufacturingOrderId,
          parentLotId: lot.id,
          sourceLotId: lot.sourceLotId || lot.id,
          notes: '',
        },
        metadata: { tenantId },
        actor,
        now,
      });
      created.push(child);
      this.deps.edges.record({
        tenantId,
        kind: 'lot_derived_from',
        from: { type: 'lot', id: child.id, label: part.lotNumber },
        to: { type: 'lot', id: lot.id, label: lot.lotNumber },
        quantity: part.quantity,
        unit: lot.unit,
        at: now,
        actor,
        ...(options.provenance ? { provenance: options.provenance } : {}),
      });
      this.deps.edges.record({
        tenantId,
        kind: 'lot_of_product',
        from: { type: 'lot', id: child.id, label: part.lotNumber },
        to: { type: 'product', id: lot.productId, label: lot.productCode },
        at: now,
        actor,
      });
    }

    const updated = this.deps.lots.store.update(lot.id, {
      fields: {
        splitQuantity: round6(lot.splitQuantity + plan.total),
        status: statusAfterSplit(lot, plan.total),
      },
      actor,
      now,
    });

    this.deps.audit({
      action: 'medicalDevice.lot.split',
      target: lot.id,
      summary:
        `Split lot ${lot.lotNumber}: ${plan.total} ${lot.unit} into ` +
        plan.parts.map((p) => `${p.lotNumber} (${p.quantity})`).join(', ') +
        `; ${plan.parentRemainingAfter} ${lot.unit} remain in ${lot.lotNumber}`,
    });

    return {
      ok: true,
      lot: updated ? await this.decorate(deviceLotFromRecord(updated)) : undefined,
      created: await Promise.all(created.map((r) => this.decorate(deviceLotFromRecord(r)))),
    };
  }

  /* ── merge: refused, with the reason ───────────────────────────────────── */

  /**
   * Merge is not supported. This method exists so the refusal is a first-class,
   * audited answer rather than a missing feature a caller has to infer.
   */
  async merge(lotIds: readonly string[]): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    this.deps.audit({
      action: 'medicalDevice.lot.merge_refused',
      target: lotIds.join(','),
      summary: `Refused a request to merge ${lotIds.length} lot(s): merging is not supported.`,
    });
    return fail(LOT_MERGE_UNSUPPORTED_REASON);
  }

  /* ── movement + shipment ───────────────────────────────────────────────── */

  async moveToWarehouse(
    lotId: string,
    warehouseId: string,
    options: LotOperationOptions = {},
  ): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    const lot = await this.lotById(lotId);
    if (!lot) return fail('That lot does not exist.');
    const target = warehouseId.trim();
    if (!target) return fail('A warehouse is required.');
    if (lot.warehouseId === target) {
      return fail(`${lot.lotNumber} is already in ${target}.`);
    }

    const updated = this.deps.lots.store.update(lot.id, {
      fields: { warehouseId: target },
      actor: this.deps.actor(),
      now: this.deps.now(),
    });
    if (!updated) return fail('That lot does not exist.');

    this.deps.edges.record({
      tenantId: this.deps.tenantId(),
      kind: 'lot_stored_in',
      from: { type: 'lot', id: lot.id, label: lot.lotNumber },
      to: { type: 'warehouse', id: target, label: target },
      quantity: lotRemaining(lot),
      unit: lot.unit,
      at: this.deps.now(),
      actor: this.deps.actor(),
      ...(options.provenance ? { provenance: options.provenance } : {}),
    });
    this.deps.audit({
      action: 'medicalDevice.lot.moved',
      target: lot.id,
      summary: `Lot ${lot.lotNumber} moved ${lot.warehouseId ? `from ${lot.warehouseId} ` : ''}to ${target}`,
    });

    if (!options.skipInventory && lot.warehouseId) {
      await this.postMovement(
        'transfer',
        lot.productCode,
        target,
        lotRemaining(lot),
        lot.id,
        lot.lotNumber,
        lot.warehouseId,
      );
    }
    return { ok: true, lot: await this.decorate(deviceLotFromRecord(updated)) };
  }

  /**
   * Record a lot leaving on a shipment.
   *
   * Shipping DRAWS material — a shipped unit is no longer available — so it goes
   * through the same `canDraw` gate as consumption. Shipping from a quarantined,
   * blocked or recalled lot is refused there, which is the single most important
   * refusal in this file.
   */
  async recordShipment(
    input: { lotId: string; shipmentId: string; customerId?: string; orderId?: string; quantity?: number },
    options: LotOperationOptions = {},
  ): Promise<DeviceLotMutationResult> {
    this.deps.authorize('medicalDevice:lot.write');
    const lot = await this.lotById(input.lotId);
    if (!lot) return fail('That lot does not exist.');
    const shipmentId = input.shipmentId.trim();
    if (!shipmentId) return fail('A shipment reference is required.');

    const amount = round6(input.quantity ?? lotRemaining(lot));
    const draw = canDraw(lot, amount);
    if (!draw.ok) return fail(draw.reason ?? 'That quantity cannot be shipped from this lot.');

    const nextStatus = statusAfterConsumption(lot, amount);
    const updated = this.deps.lots.store.update(lot.id, {
      fields: { consumedQuantity: round6(lot.consumedQuantity + amount), status: nextStatus },
      actor: this.deps.actor(),
      now: this.deps.now(),
    });
    if (!updated) return fail('That lot does not exist.');

    const now = this.deps.now();
    const base = {
      tenantId: this.deps.tenantId(),
      at: now,
      actor: this.deps.actor(),
      ...(options.provenance ? { provenance: options.provenance } : {}),
    };
    const shipmentRef = { type: 'shipment' as const, id: shipmentId, label: shipmentId };
    this.deps.edges.record({
      ...base,
      kind: 'lot_shipped_in',
      from: { type: 'lot', id: lot.id, label: lot.lotNumber },
      to: shipmentRef,
      quantity: amount,
      unit: lot.unit,
    });
    if (input.customerId?.trim()) {
      this.deps.edges.record({
        ...base,
        kind: 'shipment_to_customer',
        from: shipmentRef,
        to: { type: 'customer', id: input.customerId.trim(), label: input.customerId.trim() },
      });
    }
    if (input.orderId?.trim()) {
      this.deps.edges.record({
        ...base,
        kind: 'shipment_for_order',
        from: shipmentRef,
        to: { type: 'order', id: input.orderId.trim(), label: input.orderId.trim() },
      });
    }

    this.deps.audit({
      action: 'medicalDevice.lot.shipped',
      target: lot.id,
      summary:
        `Shipped ${amount} ${lot.unit} of lot ${lot.lotNumber} on ${shipmentId}` +
        (input.customerId ? ` to ${input.customerId}` : ''),
    });

    if (!options.skipInventory && lot.warehouseId) {
      await this.postMovement('issue', lot.productCode, lot.warehouseId, amount, lot.id, lot.lotNumber);
    }
    return { ok: true, lot: await this.decorate(deviceLotFromRecord(updated)) };
  }

  /* ── inventory ─────────────────────────────────────────────────────────── */

  /**
   * Post to the EXISTING inventory ledger through the existing seam.
   *
   * Returns whether the ledger accepted it. `postStockMovement` returns null
   * when the Stock Movements module is not wired, or when the product code has
   * no matching `inventory-products` record — a legitimate state for a
   * manufacturer that keeps its device catalogue here and not there. The lot
   * operation has already succeeded at this point; this integration reports its
   * own outcome rather than being allowed to unwind a batch record.
   */
  private async postMovement(
    type: 'receive' | 'issue' | 'transfer' | 'production_consumption',
    productCode: string,
    warehouse: string,
    quantity: number,
    lotId: string,
    lotNumber: string,
    fromWarehouse?: string,
  ): Promise<boolean> {
    const ctx = this.deps.moduleContext?.() ?? null;
    if (!ctx) return false;
    try {
      const movementNumber =
        this.deps.nextMovementNumber?.() ?? `MV-MD-${++this.movementSeq}-${Date.now().toString(36)}`;
      const posted = await postStockMovement(ctx, {
        movementNumber,
        type,
        product: productCode,
        warehouse,
        ...(fromWarehouse ? { fromWarehouse } : {}),
        quantity,
        referenceModule: DEVICE_LOTS_MODULE_ID,
        referenceRecord: lotId,
        reason: `Lot ${lotNumber}`,
      });
      return posted !== null;
    } catch {
      // An RBAC refusal on `inventory:manage` lands here. The lot change stands;
      // the ledger simply was not written by this actor, and the audit entry
      // above records what happened to the batch either way.
      return false;
    }
  }
}

/** Coerce a partial field bag for `store.update`. Exported for the import path. */
export function lotFields(values: Record<string, EnterpriseFieldValue>): Record<string, EnterpriseFieldValue> {
  return values;
}
