/**
 * Medical Devices — the view model.
 *
 * These are the judgements the surface makes. Each test names the misreading it
 * prevents, because on this screen a misreading is not a cosmetic problem: a
 * lot shown as safe when it is quarantined, or a trace that reads as "went
 * nowhere" when it means "nothing was recorded", is how the wrong material
 * reaches a patient.
 */
import { describe, expect, it } from 'vitest';
import type { DeviceLotListItem, DeviceLotPage, TraceLine } from '@neuropause/shared';
import { LOT_STATUSES } from '@neuropause/shared';
import {
  EMPTY_LOT_DRAFT,
  LOT_STATUS_TONE,
  checkLotDraft,
  emptyMessage,
  friendlyError,
  lotFlag,
  lotSubtitle,
  lotTabs,
  previewSplit,
  quantityBreakdown,
  sortProducts,
  traceRows,
} from './medicalDevicesModel';

const lot = (over: Partial<DeviceLotListItem> = {}): DeviceLotListItem => ({
  id: 'lot-1',
  tenantId: 'default',
  lotNumber: 'LOT-001',
  productId: 'p1',
  productCode: 'TR-1001',
  productName: 'Cortical Screw',
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
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  remaining: 100,
  expired: false,
  ...over,
});

describe('Lot status tone', () => {
  it('covers every status, so no state renders untoned', () => {
    for (const status of LOT_STATUSES) expect(LOT_STATUS_TONE[status]).toBeDefined();
  });

  it('reserves the alarming tone for the states that demand action', () => {
    // If a normally-ended lot were coloured as a warning, people would stop
    // reading the colour that matters.
    expect(LOT_STATUS_TONE.recalled).toBe('bad');
    expect(LOT_STATUS_TONE.blocked).toBe('bad');
    expect(LOT_STATUS_TONE.consumed).toBe('neutral');
    expect(LOT_STATUS_TONE.exhausted).toBe('neutral');
    expect(LOT_STATUS_TONE.released).toBe('good');
  });
});

describe('Quantity breakdown', () => {
  it('shows original, consumed, split and remaining together', () => {
    // Showing only "remaining" hides whether material was used or renamed.
    const q = quantityBreakdown(lot({ quantity: 100, consumedQuantity: 30, splitQuantity: 20, remaining: 50 }));
    expect(q).toMatchObject({ original: 100, consumed: 30, split: 20, remaining: 50, remainingPct: 50 });
    expect(q.label).toBe('50 of 100 unit remaining');
    expect(q.inconsistency).toBeNull();
  });

  it('states an impossible quantity instead of tidying it into a bar', () => {
    const q = quantityBreakdown(lot({ quantity: 10, consumedQuantity: 20, splitQuantity: 0 }));
    expect(q.remaining).toBe(-10);
    expect(q.inconsistency).toContain('do not reconcile');
    expect(q.remainingPct).toBe(0);
  });

  it('handles a zero-quantity lot without dividing by zero', () => {
    expect(quantityBreakdown(lot({ quantity: 0 })).remainingPct).toBe(0);
  });
});

describe('Lot flags and subtitles', () => {
  it('says "no expiry recorded" rather than leaving the field blank', () => {
    // A blank reads as missing data. Most devices genuinely have no expiry.
    expect(lotSubtitle(lot())).toContain('no expiry recorded');
    expect(lotSubtitle(lot({ expiryDate: '2027-01-01' }))).toContain('expires 2027-01-01');
  });

  it('flags a recalled lot with what to do about it', () => {
    const flag = lotFlag(lot({ status: 'recalled' }));
    expect(flag?.tone).toBe('bad');
    expect(flag?.text).toContain('trace forward');
  });

  it('flags a lot whose date has passed but which nobody has marked expired', () => {
    const flag = lotFlag(lot({ expired: true, status: 'released' }));
    expect(flag?.tone).toBe('warn');
    expect(flag?.text).toContain('has not been marked expired');
  });

  it('shows no flag on an ordinary released lot — a badge that always appears stops being read', () => {
    expect(lotFlag(lot())).toBeNull();
  });
});

describe('Lot tabs', () => {
  it('renders every view even before the counts arrive', () => {
    expect(lotTabs(null).map((t) => t.id)).toEqual([
      'all',
      'quarantined',
      'released',
      'blocked',
      'expired',
      'recalled',
    ]);
    expect(lotTabs(null).every((t) => t.count === 0)).toBe(true);
  });

  it('carries the live counts', () => {
    const page = {
      view: 'all',
      lots: [],
      total: 0,
      counts: { all: 9, quarantined: 2, released: 4, blocked: 1, expired: 1, recalled: 1 },
    } as unknown as DeviceLotPage;
    expect(lotTabs(page).find((t) => t.id === 'quarantined')?.count).toBe(2);
  });
});

describe('Create form check', () => {
  it('requires a lot number, a product and a positive quantity', () => {
    const check = checkLotDraft(EMPTY_LOT_DRAFT);
    expect(check.ok).toBe(false);
    expect(check.errors.lotNumber).toBeDefined();
    expect(check.errors.productId).toBeDefined();
    expect(check.errors.quantity).toBeDefined();
  });

  it('rejects a zero or negative quantity', () => {
    const base = { ...EMPTY_LOT_DRAFT, lotNumber: 'L', productId: 'p' };
    expect(checkLotDraft({ ...base, quantity: '0' }).ok).toBe(false);
    expect(checkLotDraft({ ...base, quantity: '-5' }).ok).toBe(false);
    expect(checkLotDraft({ ...base, quantity: 'abc' }).ok).toBe(false);
    expect(checkLotDraft({ ...base, quantity: '5' }).ok).toBe(true);
  });

  it('catches an expiry before manufacture', () => {
    const check = checkLotDraft({
      ...EMPTY_LOT_DRAFT,
      lotNumber: 'L',
      productId: 'p',
      quantity: '1',
      manufactureDate: '2026-05-01',
      expiryDate: '2026-01-01',
    });
    expect(check.errors.expiryDate).toContain('before the manufacture date');
  });

  it('accepts a lot with no expiry at all', () => {
    const check = checkLotDraft({ ...EMPTY_LOT_DRAFT, lotNumber: 'L', productId: 'p', quantity: '1' });
    expect(check.ok).toBe(true);
  });
});

describe('Split preview', () => {
  const parent = lot({ quantity: 100, remaining: 100 });

  it('shows the arithmetic before the button is pressed', () => {
    const preview = previewSplit(parent, [
      { lotNumber: 'A', quantity: '60' },
      { lotNumber: 'B', quantity: '40' },
    ]);
    expect(preview.ok).toBe(true);
    expect(preview.total).toBe(100);
    expect(preview.remainingAfter).toBe(0);
  });

  it('names the overdraw amount rather than just refusing', () => {
    const preview = previewSplit(parent, [
      { lotNumber: 'A', quantity: '60' },
      { lotNumber: 'B', quantity: '60' },
    ]);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toContain('20 unit more');
  });

  it('refuses a rename disguised as a split', () => {
    const preview = previewSplit(parent, [{ lotNumber: 'LOT-002', quantity: '100' }]);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toContain('Renumbering a lot is not a split');
  });

  it('refuses duplicate and parent-reusing child numbers', () => {
    expect(
      previewSplit(parent, [
        { lotNumber: 'A', quantity: '1' },
        { lotNumber: 'a', quantity: '1' },
      ]).reason,
    ).toContain('same lot number');
    expect(
      previewSplit(parent, [
        { lotNumber: 'LOT-001', quantity: '1' },
        { lotNumber: 'B', quantity: '1' },
      ]).reason,
    ).toContain('reuse the parent lot number');
  });

  it('says nothing at all while the form is still empty', () => {
    // An error message on an untouched form is noise.
    const preview = previewSplit(parent, [
      { lotNumber: '', quantity: '' },
      { lotNumber: '', quantity: '' },
    ]);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toBeNull();
  });

  it('accounts for material already consumed or split out', () => {
    const partial = lot({ quantity: 100, consumedQuantity: 40, splitQuantity: 20, remaining: 40 });
    expect(previewSplit(partial, [{ lotNumber: 'A', quantity: '30' }, { lotNumber: 'B', quantity: '20' }]).ok).toBe(
      false,
    );
    expect(previewSplit(partial, [{ lotNumber: 'A', quantity: '20' }, { lotNumber: 'B', quantity: '10' }]).ok).toBe(
      true,
    );
  });
});

describe('Trace rows', () => {
  const line = (depth: number, verb: string): TraceLine => ({
    depth,
    kind: 'mo_consumed_lot',
    verb,
    from: { type: 'manufacturing_order', id: 'MO-102', label: 'MO-102' },
    to: { type: 'lot', id: 'l1', label: 'LOT-RM-001' },
    quantity: '30 kg',
    at: '2026-08-09T00:00:00.000Z',
    hasProvenance: false,
  });

  it('reads forward from the thing that was reached', () => {
    const [row] = traceRows([line(1, 'consumed')], 'forward');
    expect(row?.marker).toBe('↓');
    expect(row?.text).toContain('Lot LOT-RM-001');
    expect(row?.text).toContain('MO-102');
    expect(row?.text).toContain('30 kg');
  });

  it('reads backward from the thing that produced it', () => {
    const [row] = traceRows([line(1, 'consumed')], 'backward');
    expect(row?.marker).toBe('←');
    expect(row?.text).toContain('Manufacturing order MO-102');
  });

  it('caps indentation so a deep chain stays readable', () => {
    const rows = traceRows([line(20, 'consumed')], 'forward');
    expect(rows[0]?.indent).toBe(6);
  });
});

describe('Empty and error messages', () => {
  it('distinguishes "you have none" from "your filter matched nothing"', () => {
    // Telling someone to add their first product when they have four hundred and
    // a typo in the search box is how a surface loses trust.
    expect(emptyMessage('products', false).title).toBe('No products yet');
    expect(emptyMessage('products', true).title).toBe('Nothing matches');
  });

  it('states an empty lot view as a fact about the batches, not a missing feature', () => {
    const empty = emptyMessage('lots', false, 'quarantined');
    expect(empty.title).toBe('No quarantined');
    expect(empty.body).toContain('not a missing feature');
  });

  it('turns a permission failure into something a user can act on', () => {
    const friendly = friendlyError(new Error('Missing permission: medicalDevice:lot.write'));
    expect(friendly.title).toContain('do not have access');
    expect(friendly.detail).toContain('administrator');
  });

  it('never renders an empty error body', () => {
    expect(friendlyError(new Error('')).detail).toBeTruthy();
  });
});

describe('Product ordering', () => {
  it('sorts by code, which is how a catalogue is read', () => {
    const products = [
      { productCode: 'TR-1010' },
      { productCode: 'SP-2001' },
      { productCode: 'TR-1001' },
    ] as unknown as Parameters<typeof sortProducts>[0];
    expect(sortProducts(products).map((p) => p.productCode)).toEqual(['SP-2001', 'TR-1001', 'TR-1010']);
  });
});
