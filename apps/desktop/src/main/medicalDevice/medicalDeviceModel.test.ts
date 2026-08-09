/**
 * Medical Device Pack — the pure model.
 *
 * Everything asserted here is decided by a function with no I/O: the lifecycle
 * state machine, the quantity algebra, split planning, expiry, the Lot Center
 * views, and both traversal directions. If one of these breaks, a recall gives
 * the wrong answer — so each test states the consequence it protects against,
 * not just the behaviour it observes.
 */
import { describe, expect, it } from 'vitest';
import {
  ANATOMICAL_TAXONOMY,
  CONSUMABLE_LOT_STATUSES,
  LOT_MERGE_UNSUPPORTED_REASON,
  LOT_STATUSES,
  LOT_STATUS_TRANSITIONS,
  MEDICAL_DEVICE_PACK_MANIFEST,
  PRODUCT_FAMILY_TAXONOMY,
  STERILE_STATUS_TAXONOMY,
  type MedicalDeviceLot,
  type TraceEdge,
  canDraw,
  canTransitionLot,
  countLotViews,
  isLotExpired,
  lotContext,
  lotInView,
  lotRemaining,
  matchesProductSearch,
  parseRegulatoryMetadata,
  planLotSplit,
  resolveTaxonomy,
  round6,
  serializeRegulatoryMetadata,
  statusAfterConsumption,
  statusAfterSplit,
  taxonomyValues,
  traceBackward,
  traceForward,
  validateIndustryPackManifest,
  type MedicalDeviceProduct,
} from '@neuropause/shared';

const T0 = '2026-08-09T00:00:00.000Z';

const lot = (over: Partial<MedicalDeviceLot> = {}): MedicalDeviceLot => ({
  id: 'lot-1',
  tenantId: 'default',
  lotNumber: 'LOT-001',
  productId: 'prod-1',
  productCode: 'TR-1001',
  manufacturingOrderId: '',
  status: 'released',
  manufactureDate: '2026-01-01',
  expiryDate: '',
  quantity: 100,
  consumedQuantity: 0,
  splitQuantity: 0,
  unit: 'unit',
  warehouseId: 'WH-01',
  supplierId: '',
  sourceLotId: '',
  parentLotId: '',
  notes: '',
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

/* ── industry pack layer ──────────────────────────────────────────────────── */

describe('Industry pack layer', () => {
  it('the medical device manifest is structurally valid', () => {
    expect(validateIndustryPackManifest(MEDICAL_DEVICE_PACK_MANIFEST)).toEqual([]);
  });

  it('catches a manifest that would resolve nothing forever', () => {
    const problems = validateIndustryPackManifest({
      ...MEDICAL_DEVICE_PACK_MANIFEST,
      moduleIds: [],
      taxonomies: [{ ...PRODUCT_FAMILY_TAXONOMY, values: [] }],
    });
    expect(problems.join(' ')).toContain('at least one module');
    expect(problems.join(' ')).toContain('no values');
  });

  it('a tenant may extend an open taxonomy', () => {
    const resolved = resolveTaxonomy(MEDICAL_DEVICE_PACK_MANIFEST, PRODUCT_FAMILY_TAXONOMY.key, {
      tenantId: 't1',
      packId: MEDICAL_DEVICE_PACK_MANIFEST.id,
      taxonomyExtensions: {
        [PRODUCT_FAMILY_TAXONOMY.key]: [{ value: 'sports_medicine', label: 'Sports Medicine' }],
      },
    });
    expect(resolved?.tenantValues).toHaveLength(1);
    expect(resolved?.values.map((v) => v.value)).toContain('sports_medicine');
  });

  it('a tenant may NOT extend a closed taxonomy — the state machine switches on those values', () => {
    const resolved = resolveTaxonomy(MEDICAL_DEVICE_PACK_MANIFEST, STERILE_STATUS_TAXONOMY.key, {
      tenantId: 't1',
      packId: MEDICAL_DEVICE_PACK_MANIFEST.id,
      taxonomyExtensions: {
        [STERILE_STATUS_TAXONOMY.key]: [{ value: 'probably_sterile', label: 'Probably sterile' }],
      },
    });
    expect(resolved?.tenantValues).toEqual([]);
    expect(resolved?.values.map((v) => v.value)).not.toContain('probably_sterile');
  });

  it('a tenant addition that duplicates a pack value is ignored, not doubled', () => {
    const values = taxonomyValues(MEDICAL_DEVICE_PACK_MANIFEST, ANATOMICAL_TAXONOMY.key, {
      tenantId: 't1',
      packId: MEDICAL_DEVICE_PACK_MANIFEST.id,
      taxonomyExtensions: { [ANATOMICAL_TAXONOMY.key]: [{ value: 'spine', label: 'Spine (ours)' }] },
    });
    expect(values.filter((v) => v === 'spine')).toHaveLength(1);
  });

  it('the pack names what it does not provide, rather than leaving it to be inferred', () => {
    const text = MEDICAL_DEVICE_PACK_MANIFEST.notProvided.join(' ');
    expect(text).toContain('Quality Center');
    expect(text).toContain('Document control');
    expect(text).toContain('not validated software');
  });
});

/* ── product model ────────────────────────────────────────────────────────── */

describe('Product model', () => {
  const product = (over: Partial<MedicalDeviceProduct> = {}): MedicalDeviceProduct => ({
    id: 'p1',
    tenantId: 'default',
    productCode: 'TR-1001',
    productName: '4.5mm Cortical Screw',
    productFamily: 'trauma',
    category: 'implant',
    anatomicalCategory: 'lower_extremity',
    material: 'stainless_steel_316l',
    size: '4.5 x 40',
    dimensions: '',
    sterileStatus: 'sterile',
    packaging: '',
    batchLotTracked: true,
    serialTracked: false,
    udi: '',
    regulatoryMetadata: {},
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  });

  it('searches the five fields the charter names, and nothing else', () => {
    const p = product({ packaging: 'blister' });
    expect(matchesProductSearch(p, 'TR-10')).toBe(true);
    expect(matchesProductSearch(p, 'cortical')).toBe(true);
    expect(matchesProductSearch(p, 'trauma')).toBe(true);
    expect(matchesProductSearch(p, 'implant')).toBe(true);
    expect(matchesProductSearch(p, 'stainless')).toBe(true);
    // Packaging is NOT a search field: a substring match over every field is how
    // a search returns a product because an unrelated note mentioned the word.
    expect(matchesProductSearch(p, 'blister')).toBe(false);
  });

  it('regulatory metadata round-trips, and a malformed value degrades to empty rather than throwing', () => {
    const meta = { riskClass: 'IIb', market: 'EU' };
    expect(parseRegulatoryMetadata(serializeRegulatoryMetadata(meta))).toEqual(meta);
    expect(serializeRegulatoryMetadata({})).toBe('');
    expect(parseRegulatoryMetadata('not json')).toEqual({});
    expect(parseRegulatoryMetadata('[1,2,3]')).toEqual({});
    expect(parseRegulatoryMetadata('')).toEqual({});
  });
});

/* ── lifecycle ────────────────────────────────────────────────────────────── */

describe('Lot lifecycle state machine', () => {
  it('every declared transition target is itself a declared status', () => {
    for (const from of LOT_STATUSES) {
      for (const to of LOT_STATUS_TRANSITIONS[from]) {
        expect(LOT_STATUSES).toContain(to);
      }
    }
  });

  it('refuses an undeclared transition and says why', () => {
    const check = canTransitionLot('blocked', 'consumed');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Blocked');
    expect(check.reason).toContain('Consumed');
  });

  it('a recall is final — there is no un-recall', () => {
    expect(LOT_STATUS_TRANSITIONS.recalled).toEqual([]);
    for (const to of LOT_STATUSES) {
      if (to === 'recalled') continue;
      expect(canTransitionLot('recalled', to).ok).toBe(false);
    }
  });

  it('a recall CAN land on material that has already been used', () => {
    // The most important event traceability exists for. Refusing it would make
    // the system unable to represent a recall of already-consumed material.
    expect(canTransitionLot('consumed', 'recalled').ok).toBe(true);
    expect(canTransitionLot('exhausted', 'recalled').ok).toBe(true);
  });

  it('expired material can be blocked or recalled, never re-released', () => {
    expect(canTransitionLot('expired', 'blocked').ok).toBe(true);
    expect(canTransitionLot('expired', 'recalled').ok).toBe(true);
    expect(canTransitionLot('expired', 'released').ok).toBe(false);
  });

  it('only released and partially consumed lots can supply material', () => {
    expect(CONSUMABLE_LOT_STATUSES).toEqual(['released', 'partially_consumed']);
    for (const status of LOT_STATUSES) {
      const ok = canDraw(lot({ status }), 1).ok;
      expect(ok).toBe(CONSUMABLE_LOT_STATUSES.includes(status));
    }
  });
});

/* ── quantity ─────────────────────────────────────────────────────────────── */

describe('Lot quantity integrity', () => {
  it('remaining is derived, never stored', () => {
    expect(lotRemaining(lot({ quantity: 100, consumedQuantity: 30, splitQuantity: 20 }))).toBe(50);
  });

  it('refuses over-consumption, naming what is actually left', () => {
    const l = lot({ quantity: 100, consumedQuantity: 90 });
    const check = canDraw(l, 20);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Only 10');
    expect(check.reason).toContain('LOT-001');
  });

  it('refuses a zero or negative draw', () => {
    expect(canDraw(lot(), 0).ok).toBe(false);
    expect(canDraw(lot(), -5).ok).toBe(false);
    expect(canDraw(lot(), Number.NaN).ok).toBe(false);
  });

  it('consumption and splitting compete for the SAME material', () => {
    // Checking them independently is how a lot ends up over-drawn by one of each.
    const l = lot({ quantity: 100, consumedQuantity: 60, splitQuantity: 30 });
    expect(canDraw(l, 10).ok).toBe(true);
    expect(canDraw(l, 11).ok).toBe(false);
  });

  it('the terminal state records WHY nothing is left', () => {
    // Used up → consumed. Divided into children → exhausted. The distinction is
    // "used" vs "renamed", which is the first thing an investigator asks.
    expect(statusAfterConsumption(lot({ quantity: 100, consumedQuantity: 40 }), 60)).toBe('consumed');
    expect(statusAfterConsumption(lot({ quantity: 100, splitQuantity: 40, consumedQuantity: 0 }), 60)).toBe(
      'exhausted',
    );
    expect(statusAfterConsumption(lot({ quantity: 100 }), 60)).toBe('partially_consumed');
    expect(statusAfterSplit(lot({ quantity: 100 }), 100)).toBe('exhausted');
  });

  it('fractional quantities do not leave an invisible residue', () => {
    // 100 − 60 − 40 in binary floats is 5.7e-15, which would leave the lot
    // eternally "partially consumed" with a remainder nobody can see or issue.
    const l = lot({ quantity: 0.3, consumedQuantity: 0.1, splitQuantity: 0.2 });
    expect(lotRemaining(l)).toBe(0);
    expect(round6(0.1 + 0.2)).toBe(0.3);
  });
});

/* ── split ────────────────────────────────────────────────────────────────── */

describe('Lot split', () => {
  it('conserves quantity: 100 = 60 + 40', () => {
    const parent = lot({ quantity: 100 });
    const plan = planLotSplit(parent, [
      { lotNumber: 'LOT-001-A', quantity: 60 },
      { lotNumber: 'LOT-001-B', quantity: 40 },
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.total).toBe(100);
    expect(plan.parentRemainingAfter).toBe(0);
    expect(plan.parentStatusAfter).toBe('exhausted');
  });

  it('a partial split leaves the remainder in the parent', () => {
    const plan = planLotSplit(lot({ quantity: 100 }), [{ lotNumber: 'A', quantity: 60 }, { lotNumber: 'B', quantity: 10 }]);
    expect(plan.ok).toBe(true);
    expect(plan.parentRemainingAfter).toBe(30);
    expect(plan.parentStatusAfter).toBe('partially_consumed');
  });

  it('refuses a split that exceeds what remains', () => {
    const plan = planLotSplit(lot({ quantity: 100, consumedQuantity: 50 }), [
      { lotNumber: 'A', quantity: 30 },
      { lotNumber: 'B', quantity: 30 },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('Only 50');
  });

  it('refuses a rename disguised as a split', () => {
    // Moving 100% into ONE new lot severs the link between a lot number and the
    // material it identifies, while looking like an ordinary operation.
    const plan = planLotSplit(lot({ quantity: 100 }), [{ lotNumber: 'LOT-002', quantity: 100 }]);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('renumbering a lot is not a split');
  });

  it('refuses duplicate child numbers and reuse of the parent number', () => {
    expect(planLotSplit(lot(), [{ lotNumber: 'A', quantity: 1 }, { lotNumber: 'a', quantity: 1 }]).reason).toContain(
      'same lot number',
    );
    expect(
      planLotSplit(lot(), [{ lotNumber: 'LOT-001', quantity: 1 }, { lotNumber: 'B', quantity: 1 }]).reason,
    ).toContain('parent lot number');
  });

  it('refuses zero, negative and unnamed parts', () => {
    expect(planLotSplit(lot(), []).ok).toBe(false);
    expect(planLotSplit(lot(), [{ lotNumber: 'A', quantity: 0 }, { lotNumber: 'B', quantity: 1 }]).ok).toBe(false);
    expect(planLotSplit(lot(), [{ lotNumber: '  ', quantity: 5 }, { lotNumber: 'B', quantity: 1 }]).ok).toBe(false);
  });

  it('refuses to split a lot that is not releasable material', () => {
    const plan = planLotSplit(lot({ status: 'quarantined' }), [
      { lotNumber: 'A', quantity: 10 },
      { lotNumber: 'B', quantity: 10 },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('quarantined');
  });
});

describe('Lot merge', () => {
  it('is documented as unsupported, with the consequence spelled out', () => {
    expect(LOT_MERGE_UNSUPPORTED_REASON).toContain('not supported');
    expect(LOT_MERGE_UNSUPPORTED_REASON).toContain('recall of material that was never at risk');
    expect(LOT_MERGE_UNSUPPORTED_REASON).toContain('manufacturing order');
  });
});

/* ── expiry + views ───────────────────────────────────────────────────────── */

describe('Expiry and the Lot Center views', () => {
  it('a lot with no expiry date is never expired', () => {
    // Many devices have no expiry at all. Empty must never read as a hazard.
    expect(isLotExpired(lot({ expiryDate: '' }), T0)).toBe(false);
  });

  it('expiry is computed at read, so it can never go stale', () => {
    const l = lot({ expiryDate: '2026-08-08T00:00:00.000Z' });
    expect(isLotExpired(l, '2026-08-07T00:00:00.000Z')).toBe(false);
    expect(isLotExpired(l, '2026-08-09T00:00:00.000Z')).toBe(true);
  });

  it('the Expired view shows lots whose date has passed, not only those someone marked', () => {
    // A view of already-marked lots is a list of work already done.
    const unmarked = lot({ status: 'released', expiryDate: '2026-01-01' });
    expect(lotInView(unmarked, 'expired', T0)).toBe(true);
    expect(lotInView(unmarked, 'released', T0)).toBe(true);
  });

  it('a recalled lot is not also listed as expired — the recall is the operative fact', () => {
    expect(lotInView(lot({ status: 'recalled', expiryDate: '2026-01-01' }), 'expired', T0)).toBe(false);
    expect(lotInView(lot({ status: 'recalled' }), 'recalled', T0)).toBe(true);
  });

  it('counts every view over one pass', () => {
    const counts = countLotViews(
      [
        lot({ id: 'a', status: 'quarantined' }),
        lot({ id: 'b', status: 'released' }),
        lot({ id: 'c', status: 'partially_consumed' }),
        lot({ id: 'd', status: 'blocked' }),
        lot({ id: 'e', status: 'recalled' }),
        lot({ id: 'f', status: 'released', expiryDate: '2026-01-01' }),
      ],
      T0,
    );
    expect(counts.all).toBe(6);
    expect(counts.quarantined).toBe(1);
    expect(counts.released).toBe(3); // released + partially consumed + the expired-but-released one
    expect(counts.blocked).toBe(1);
    expect(counts.recalled).toBe(1);
    expect(counts.expired).toBe(1);
  });
});

/* ── traceability traversal ───────────────────────────────────────────────── */

const edge = (
  id: string,
  kind: TraceEdge['kind'],
  from: [TraceEdge['from']['type'], string],
  to: [TraceEdge['to']['type'], string],
): TraceEdge => ({
  id,
  tenantId: 'default',
  kind,
  from: { type: from[0], id: from[1], label: from[1] },
  to: { type: to[0], id: to[1], label: to[1] },
  quantity: null,
  unit: '',
  at: T0,
  actor: null,
});

/**
 * The charter's chain, as a graph:
 *
 *   LOT-RM-001 ┐
 *              ├→ MO-102 → LOT-FG-001 → WH-01
 *   LOT-RM-002 ┘                      → SH-3001 → CUST-004
 *                                              → ORD-77
 */
const CHAIN: TraceEdge[] = [
  edge('e1', 'mo_consumed_lot', ['manufacturing_order', 'MO-102'], ['lot', 'LOT-RM-001']),
  edge('e2', 'mo_consumed_lot', ['manufacturing_order', 'MO-102'], ['lot', 'LOT-RM-002']),
  edge('e3', 'mo_produced_lot', ['manufacturing_order', 'MO-102'], ['lot', 'LOT-FG-001']),
  edge('e4', 'lot_stored_in', ['lot', 'LOT-FG-001'], ['warehouse', 'WH-01']),
  edge('e5', 'lot_shipped_in', ['lot', 'LOT-FG-001'], ['shipment', 'SH-3001']),
  edge('e6', 'shipment_to_customer', ['shipment', 'SH-3001'], ['customer', 'CUST-004']),
  edge('e7', 'shipment_for_order', ['shipment', 'SH-3001'], ['order', 'ORD-77']),
  edge('e8', 'lot_of_product', ['lot', 'LOT-FG-001'], ['product', 'TR-1001']),
];

describe('Forward traceability', () => {
  it('answers "where did this raw material go?" all the way to the customer', () => {
    const result = traceForward(CHAIN, { type: 'lot', id: 'LOT-RM-001', label: 'LOT-RM-001' });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('MO-102');
    expect(ids).toContain('LOT-FG-001');
    expect(ids).toContain('WH-01');
    expect(ids).toContain('SH-3001');
    expect(ids).toContain('CUST-004');
    expect(ids).toContain('ORD-77');
    expect(result.byType.customer.map((c) => c.id)).toEqual(['CUST-004']);
    expect(result.byType.warehouse.map((w) => w.id)).toEqual(['WH-01']);
  });

  it('does not walk a product into every other lot of that product', () => {
    // `lot_of_product` is context, not flow. Following it would return a
    // catalogue listing dressed as a trace.
    const withSibling = [...CHAIN, edge('e9', 'lot_of_product', ['lot', 'LOT-OTHER'], ['product', 'TR-1001'])];
    const result = traceForward(withSibling, { type: 'lot', id: 'LOT-FG-001', label: 'LOT-FG-001' });
    expect(result.nodes.map((n) => n.id)).not.toContain('LOT-OTHER');
    expect(result.nodes.map((n) => n.id)).not.toContain('TR-1001');
  });

  it('walks a split parent to its children, not to its own parent', () => {
    const split = [
      edge('s1', 'lot_derived_from', ['lot', 'CHILD-A'], ['lot', 'PARENT']),
      edge('s2', 'lot_derived_from', ['lot', 'CHILD-B'], ['lot', 'PARENT']),
      edge('s3', 'lot_derived_from', ['lot', 'PARENT'], ['lot', 'GRANDPARENT']),
    ];
    const forward = traceForward(split, { type: 'lot', id: 'PARENT', label: 'PARENT' });
    expect(forward.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['CHILD-A', 'CHILD-B']));
    expect(forward.nodes.map((n) => n.id)).not.toContain('GRANDPARENT');
  });

  it('reports nothing rather than guessing when no edge exists', () => {
    const result = traceForward(CHAIN, { type: 'lot', id: 'LOT-UNKNOWN', label: 'LOT-UNKNOWN' });
    expect(result.steps).toEqual([]);
    expect(result.nodes).toHaveLength(1);
  });
});

describe('Backward traceability', () => {
  it('answers "which raw materials made this?" from the finished lot', () => {
    const result = traceBackward(CHAIN, { type: 'lot', id: 'LOT-FG-001', label: 'LOT-FG-001' });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('MO-102');
    expect(ids).toContain('LOT-RM-001');
    expect(ids).toContain('LOT-RM-002');
    expect(result.byType.manufacturing_order.map((m) => m.id)).toEqual(['MO-102']);
  });

  it('answers the same question starting from the customer', () => {
    const result = traceBackward(CHAIN, { type: 'customer', id: 'CUST-004', label: 'CUST-004' });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('SH-3001');
    expect(ids).toContain('LOT-FG-001');
    expect(ids).toContain('LOT-RM-001');
    expect(ids).toContain('LOT-RM-002');
  });

  it('walks a child lot to its parent, not to its siblings', () => {
    const split = [
      edge('s1', 'lot_derived_from', ['lot', 'CHILD-A'], ['lot', 'PARENT']),
      edge('s2', 'lot_derived_from', ['lot', 'CHILD-B'], ['lot', 'PARENT']),
    ];
    const back = traceBackward(split, { type: 'lot', id: 'CHILD-A', label: 'CHILD-A' });
    expect(back.nodes.map((n) => n.id)).toContain('PARENT');
    // CHILD-B is reachable only by going down again, which is a forward step.
    expect(back.nodes.map((n) => n.id)).not.toContain('CHILD-B');
  });

  it('terminates on a cycle instead of walking forever', () => {
    // A rework loop, or a mis-imported pair, must not hang the UI on the day
    // someone needs the answer most.
    const cycle = [
      edge('c1', 'mo_produced_lot', ['manufacturing_order', 'MO-1'], ['lot', 'L1']),
      edge('c2', 'mo_consumed_lot', ['manufacturing_order', 'MO-1'], ['lot', 'L2']),
      edge('c3', 'mo_produced_lot', ['manufacturing_order', 'MO-2'], ['lot', 'L2']),
      edge('c4', 'mo_consumed_lot', ['manufacturing_order', 'MO-2'], ['lot', 'L1']),
    ];
    const back = traceBackward(cycle, { type: 'lot', id: 'L1', label: 'L1' });
    expect(back.nodes.length).toBeLessThan(10);
    expect(back.steps.length).toBe(4);
  });

  it('reports truncation instead of pretending the answer is complete', () => {
    const long: TraceEdge[] = [];
    for (let i = 0; i < 30; i += 1) {
      long.push(edge(`m${i}`, 'mo_produced_lot', ['manufacturing_order', `MO-${i}`], ['lot', `L${i}`]));
      long.push(edge(`c${i}`, 'mo_consumed_lot', ['manufacturing_order', `MO-${i}`], ['lot', `L${i + 1}`]));
    }
    const back = traceBackward(long, { type: 'lot', id: 'L0', label: 'L0' }, { maxDepth: 4 });
    expect(back.truncated).toBe(true);
  });
});

describe('Lot context', () => {
  it('separates parents from children and shows both manufacturing roles', () => {
    const edges = [
      ...CHAIN,
      edge('x1', 'lot_derived_from', ['lot', 'CHILD'], ['lot', 'LOT-FG-001']),
      edge('x2', 'lot_derived_from', ['lot', 'LOT-FG-001'], ['lot', 'ROOT']),
      edge('x3', 'lot_supplied_by', ['lot', 'LOT-FG-001'], ['supplier', 'SUP-1']),
    ];
    const ctx = lotContext(edges, 'LOT-FG-001');
    expect(ctx.childLots.map((l) => l.id)).toEqual(['CHILD']);
    expect(ctx.parentLots.map((l) => l.id)).toEqual(['ROOT']);
    expect(ctx.manufacturingOrders.map((m) => m.id)).toEqual(['MO-102']);
    expect(ctx.warehouses.map((w) => w.id)).toEqual(['WH-01']);
    expect(ctx.shipments.map((s) => s.id)).toEqual(['SH-3001']);
    expect(ctx.product?.id).toBe('TR-1001');
    expect(ctx.supplier?.id).toBe('SUP-1');
  });
});
