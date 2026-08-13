/**
 * Medical Devices — the view model.
 *
 * Every judgement the surface makes lives here, so it can be tested without
 * rendering anything: which tone a lot status gets, what a quantity bar means,
 * whether a split form is submittable, how a trace reads as a sentence, and
 * what to say when there is nothing to show.
 *
 * The components below this file decide layout. They do not decide meaning.
 */
import type {
  DeviceLotListItem,
  DeviceLotPage,
  DeviceProductListItem,
  LotCenterView,
  LotStatus,
  TraceLine,
} from '@neuropause/shared';
import {
  LOT_CENTER_VIEWS,
  LOT_CENTER_VIEW_LABELS,
  LOT_STATUS_LABELS,
  round6,
} from '@neuropause/shared';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/**
 * The tone a lot status carries.
 *
 * `recalled` and `blocked` are the only `bad` states, and they are bad in the
 * sense that they demand attention — not that something went wrong with the
 * software. `consumed` and `exhausted` are neutral: a fully used lot is a
 * normal end state, and colouring it as a warning would train people to ignore
 * the colour that matters.
 */
export const LOT_STATUS_TONE: Record<LotStatus, Tone> = {
  created: 'neutral',
  quarantined: 'warn',
  released: 'good',
  blocked: 'bad',
  partially_consumed: 'good',
  consumed: 'neutral',
  exhausted: 'neutral',
  expired: 'warn',
  recalled: 'bad',
};

export interface LotTab {
  id: LotCenterView;
  label: string;
  count: number;
}

export function lotTabs(page: DeviceLotPage | null): LotTab[] {
  return LOT_CENTER_VIEWS.map((id) => ({
    id,
    label: LOT_CENTER_VIEW_LABELS[id],
    count: page?.counts[id] ?? 0,
  }));
}

/**
 * How a lot's quantity reads at a glance.
 *
 * The three parts are shown together, always. Showing only "remaining" would
 * hide whether a lot is half-used or half-split, which is the difference
 * between material that was consumed and material that still exists under
 * another number.
 */
export interface QuantityBreakdown {
  original: number;
  remaining: number;
  consumed: number;
  split: number;
  /** 0–100. Never exceeds 100 even if the record is somehow inconsistent. */
  remainingPct: number;
  /** Set when the parts do not reconcile — a defect, stated rather than hidden. */
  inconsistency: string | null;
  label: string;
}

export function quantityBreakdown(lot: DeviceLotListItem): QuantityBreakdown {
  const remaining = round6(lot.quantity - lot.consumedQuantity - lot.splitQuantity);
  const pct = lot.quantity > 0 ? Math.max(0, Math.min(100, (remaining / lot.quantity) * 100)) : 0;
  // A negative remainder cannot be produced by the service, so if one appears
  // the record was written by something else. Saying so is the only honest
  // option — rendering it as zero would hide the defect behind a tidy bar.
  const inconsistency =
    remaining < 0
      ? `This lot's quantities do not reconcile: ${lot.quantity} original, ${lot.consumedQuantity} consumed, ${lot.splitQuantity} split out. Something wrote this record outside the Batch/Lot Center.`
      : null;
  return {
    original: lot.quantity,
    remaining,
    consumed: lot.consumedQuantity,
    split: lot.splitQuantity,
    remainingPct: Math.round(pct),
    inconsistency,
    label: `${remaining} of ${lot.quantity} ${lot.unit} remaining`,
  };
}

/** The one-line summary under a lot's title. */
export function lotSubtitle(lot: DeviceLotListItem): string {
  const parts = [lot.productCode];
  if (lot.productName) parts.push(lot.productName);
  if (lot.warehouseId) parts.push(lot.warehouseId);
  if (lot.expiryDate) parts.push(`expires ${lot.expiryDate}`);
  else parts.push('no expiry recorded');
  return parts.join(' · ');
}

/**
 * Why a lot is flagged, if it is. Returns null when there is nothing to say —
 * a badge that always appears stops being read.
 */
export function lotFlag(lot: DeviceLotListItem): { tone: Tone; text: string } | null {
  if (lot.status === 'recalled') {
    return { tone: 'bad', text: 'Recalled — trace forward to see everywhere this went' };
  }
  if (lot.expired && lot.status !== 'expired') {
    return { tone: 'warn', text: 'The expiry date has passed, but the lot has not been marked expired' };
  }
  if (lot.status === 'blocked') return { tone: 'bad', text: 'Blocked — material cannot be drawn' };
  if (lot.status === 'quarantined') return { tone: 'warn', text: 'Quarantined — release before use' };
  return null;
}

/* ── create form ──────────────────────────────────────────────────────────── */

export interface LotCreateDraft {
  lotNumber: string;
  productId: string;
  quantity: string;
  unit: string;
  manufactureDate: string;
  expiryDate: string;
  warehouseId: string;
  supplierId: string;
  manufacturingOrderId: string;
  notes: string;
}

export const EMPTY_LOT_DRAFT: LotCreateDraft = {
  lotNumber: '',
  productId: '',
  quantity: '',
  unit: 'unit',
  manufactureDate: '',
  expiryDate: '',
  warehouseId: '',
  supplierId: '',
  manufacturingOrderId: '',
  notes: '',
};

export interface DraftCheck {
  ok: boolean;
  errors: Partial<Record<keyof LotCreateDraft, string>>;
}

/**
 * Client-side check on the create form.
 *
 * This is a CONVENIENCE, not the guard. Every rule here is enforced again in
 * the service, which is the only place that can see the other lots. Duplicating
 * the whole rule set in the renderer would create two answers to the same
 * question, and the wrong one would win whenever they drifted.
 */
export function checkLotDraft(draft: LotCreateDraft): DraftCheck {
  const errors: DraftCheck['errors'] = {};
  if (!draft.lotNumber.trim()) errors.lotNumber = 'A lot number is required.';
  if (!draft.productId) errors.productId = 'Choose the product this batch is of.';
  const qty = Number(draft.quantity);
  if (!draft.quantity.trim()) errors.quantity = 'A quantity is required.';
  else if (!Number.isFinite(qty) || qty <= 0) errors.quantity = 'Quantity must be greater than zero.';
  if (draft.expiryDate && draft.manufactureDate) {
    const made = Date.parse(draft.manufactureDate);
    const expires = Date.parse(draft.expiryDate);
    if (Number.isFinite(made) && Number.isFinite(expires) && expires < made) {
      errors.expiryDate = 'The expiry date is before the manufacture date.';
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ── split form ───────────────────────────────────────────────────────────── */

export interface SplitPartDraft {
  lotNumber: string;
  quantity: string;
}

export interface SplitPreview {
  ok: boolean;
  reason: string | null;
  total: number;
  remainingAfter: number;
  parts: { lotNumber: string; quantity: number }[];
}

/**
 * Live preview of a split, shown while the user types.
 *
 * The point is that the arithmetic is visible BEFORE the button is pressed: a
 * split that would leave 3 units behind because someone typed 57 instead of 60
 * should be obvious on the form, not discovered afterwards in the lot list.
 */
export function previewSplit(lot: DeviceLotListItem, drafts: readonly SplitPartDraft[]): SplitPreview {
  const remaining = round6(lot.quantity - lot.consumedQuantity - lot.splitQuantity);
  const filled = drafts.filter((d) => d.lotNumber.trim() || d.quantity.trim());
  const parts = filled.map((d) => ({ lotNumber: d.lotNumber.trim(), quantity: Number(d.quantity) }));
  const base = { total: 0, remainingAfter: remaining, parts: [] as SplitPreview['parts'] };

  if (filled.length === 0) return { ok: false, reason: null, ...base };
  if (parts.some((p) => !p.lotNumber)) {
    return { ok: false, reason: 'Every part needs a lot number.', ...base };
  }
  if (parts.some((p) => !Number.isFinite(p.quantity) || p.quantity <= 0)) {
    return { ok: false, reason: 'Every part needs a quantity greater than zero.', ...base };
  }
  const numbers = parts.map((p) => p.lotNumber.toLowerCase());
  if (new Set(numbers).size !== numbers.length) {
    return { ok: false, reason: 'Two parts have the same lot number.', ...base };
  }
  if (numbers.includes(lot.lotNumber.trim().toLowerCase())) {
    return { ok: false, reason: 'A child lot cannot reuse the parent lot number.', ...base };
  }
  const total = round6(parts.reduce((n, p) => n + p.quantity, 0));
  if (total > remaining) {
    return {
      ok: false,
      reason: `That is ${round6(total - remaining)} ${lot.unit} more than the ${remaining} remaining in ${lot.lotNumber}.`,
      total,
      remainingAfter: round6(remaining - total),
      parts,
    };
  }
  if (parts.length === 1 && total === remaining) {
    return {
      ok: false,
      reason:
        'That would move everything into one new lot. Renumbering a lot is not a split — it breaks the link between this lot number and the material it identifies.',
      total,
      remainingAfter: 0,
      parts,
    };
  }
  return { ok: true, reason: null, total, remainingAfter: round6(remaining - total), parts };
}

/* ── traceability ─────────────────────────────────────────────────────────── */

export interface TraceRow extends TraceLine {
  /** Indentation depth, capped so a deep chain stays readable. */
  indent: number;
  /** The arrow shown before the line, by direction. */
  marker: string;
  text: string;
}

/** Turn trace lines into rows a person can read top to bottom. */
export function traceRows(lines: readonly TraceLine[], direction: 'forward' | 'backward'): TraceRow[] {
  return lines.map((line) => {
    const subject = direction === 'forward' ? line.to : line.from;
    const other = direction === 'forward' ? line.from : line.to;
    const qty = line.quantity ? ` · ${line.quantity}` : '';
    return {
      ...line,
      indent: Math.min(line.depth - 1, 6),
      marker: direction === 'forward' ? '↓' : '←',
      text: `${nodeLabel(subject.type)} ${subject.label} — ${line.verb} ${other.label}${qty}`,
    };
  });
}

const NODE_LABELS: Record<string, string> = {
  lot: 'Lot',
  product: 'Product',
  manufacturing_order: 'Manufacturing order',
  warehouse: 'Warehouse',
  shipment: 'Shipment',
  customer: 'Customer',
  order: 'Order',
  supplier: 'Supplier',
};

export function nodeLabel(type: string): string {
  return NODE_LABELS[type] ?? type;
}

/* ── empty states ─────────────────────────────────────────────────────────── */

/**
 * What to say when a list is empty.
 *
 * The distinction that matters: "you have not added any yet" and "your filter
 * matched nothing" are different situations, and telling someone to add their
 * first product when they have four hundred and a typo in the search box is how
 * a surface loses trust.
 */
export function emptyMessage(
  kind: 'products' | 'lots',
  filtered: boolean,
  view?: LotCenterView,
): { title: string; body: string } {
  if (filtered) {
    return {
      title: 'Nothing matches',
      body: 'No records match what you searched for. Clear the search or filters to see everything.',
    };
  }
  if (kind === 'products') {
    return {
      title: 'No products yet',
      body: 'Add your first device, or import your catalogue through Data — a product code and a name are all that is required.',
    };
  }
  if (view && view !== 'all') {
    return {
      title: `No ${LOT_CENTER_VIEW_LABELS[view].toLowerCase()}`,
      body: `No batch is currently ${LOT_CENTER_VIEW_LABELS[view].toLowerCase()}. That is a statement about your batches, not a missing feature.`,
    };
  }
  return {
    title: 'No batches yet',
    body: 'Create a batch against a product that has Batch / Lot Tracked turned on, or import your batch records through Data.',
  };
}

/** A failure the user can read. Never a stack, never a channel name. */
export function friendlyError(err: unknown): { title: string; detail: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (/permission/i.test(message)) {
    return {
      title: 'You do not have access to this',
      detail: 'Your role does not include the medical device scope this needs. An administrator can grant it.',
    };
  }
  return {
    title: 'That did not work',
    detail: message || 'No further detail was reported.',
  };
}

/** Human label for a lot status, used wherever one is rendered. */
export function statusLabel(status: LotStatus): string {
  return LOT_STATUS_LABELS[status];
}

/** Sort products for the list: code order, which is how a catalogue is read. */
export function sortProducts(products: readonly DeviceProductListItem[]): DeviceProductListItem[] {
  return [...products].sort((a, b) => a.productCode.localeCompare(b.productCode));
}
