/**
 * Procurement → RFQs — the multi-supplier quotation cycle on the Enterprise
 * Module Framework (W3.1). A descriptor + the framework's record store +
 * hooks; CRUD, RBAC (`procurement:read` / `procurement:manage`), audit,
 * timeline, search, offline persistence, and the entire list/detail/form UI
 * are all inherited — nothing re-implemented.
 *
 * DETERMINISTIC sourcing discipline:
 *   • Quote lines are JSON (the journal-lines convention), one per supplier,
 *     parsed and guarded at validate; every quoted supplier must exist by
 *     exact name in the injected Suppliers store — no phantom vendors.
 *   • The comparison stamps (`bestValueSupplier`, `bestLeadTimeSupplier`) are
 *     read-only engine output on every write — transparent arithmetic with
 *     stated tie rules, never judgment.
 *   • `Award` takes the BEST-VALUE quote and creates a DRAFT Purchase Order
 *     through the existing PO machinery (validated by the PO's own hooks) —
 *     which then walks its certified approve → send → receive chain. A buyer
 *     who wants a different winner edits the quote lines first, keeping the
 *     decision trail honest. After award (or cancel) the RFQ is immutable
 *     history (the W1 marker pattern).
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  PURCHASE_ORDERS_MODULE_ID,
  RFQS_MODULE_ID,
  RFQ_KIND,
  compareRfqQuotes,
  deriveRecordTitle,
  parseRfqQuotes,
  rfqFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys the RFQs module surfaces. */
export const AWARD_RFQ_ACTION = 'award';
export const CANCEL_RFQ_ACTION = 'cancel';

/** The declarative description of an RFQ — drives store, CRUD, and the UI. */
export const RFQ_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: RFQS_MODULE_ID,
  title: 'RFQs',
  singular: 'RFQ',
  plural: 'RFQs',
  icon: 'scale',
  description:
    'Request quotations from multiple suppliers, compare them deterministically, and award the winner into a draft purchase order.',
  group: 'Procurement',
  titleField: 'rfqNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  actions: [
    { key: AWARD_RFQ_ACTION, label: 'Award Best Value', icon: 'check' },
    { key: CANCEL_RFQ_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'rfqNumber', label: 'RFQ #', type: 'text', required: true, placeholder: 'RFQ-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0 },
    { key: 'warehouse', label: 'Warehouse', type: 'text', column: false, placeholder: 'WH-01' },
    /**
     * The currency the quotes are in.
     *
     * Added because the award previously created a purchase order with NO
     * currency, which fell back to the descriptor default (USD) regardless of
     * what the business actually buys in. That made the awarded order
     * incomparable with the orders it came from — and since price analysis
     * refuses to compare across currencies, awarding an RFQ could silently make
     * the very product it was raised for unmeasurable. An RFQ exists to compare
     * prices; a price without a currency is not one.
     */
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      column: false,
      default: 'USD',
      options: [
        { value: 'USD', label: 'USD' },
        { value: 'EUR', label: 'EUR' },
        { value: 'GBP', label: 'GBP' },
        { value: 'INR', label: 'INR' },
      ],
    },
    { key: 'neededBy', label: 'Needed By', type: 'date', format: 'date' },
    { key: 'sourceRequest', label: 'Source Request', type: 'text', column: false, placeholder: 'Purchase request id (optional)' },
    /**
     * The finding this RFQ was raised from, when it was raised by NeuroPause.
     *
     * A machine-readable link, not prose in the notes: outcome measurement has
     * to prove an execution belongs to the finding it is being measured for,
     * and "the notes mention it" is not proof.
     */
    { key: 'sourceOpportunity', label: 'Raised From', type: 'text', column: false, readOnly: true },
    {
      key: 'quotesJson',
      label: 'Quotes',
      type: 'textarea',
      column: false,
      placeholder: '{"supplier":"Acme Supplies","unitCost":12.5,"leadTimeDays":7} — one JSON quote per line',
    },
    { key: 'quoteCount', label: 'Quotes In', type: 'number', readOnly: true, default: 0 },
    { key: 'bestValueSupplier', label: 'Best Value', type: 'text', readOnly: true },
    { key: 'bestValueUnitCost', label: 'Best Unit Cost', type: 'number', readOnly: true, format: 'currency' },
    { key: 'bestLeadTimeSupplier', label: 'Fastest', type: 'text', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'open',
      badge: true,
      filterable: true,
      options: [
        { value: 'open', label: 'Open', tone: 'blue' },
        { value: 'awarded', label: 'Awarded', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'awardedSupplier', label: 'Awarded To', type: 'text', readOnly: true },
    { key: 'awardedAt', label: 'Awarded At', type: 'text', readOnly: true, column: false },
    { key: 'awardedOrder', label: 'Purchase Order', type: 'text', readOnly: true, column: false },
    { key: 'cancelledAt', label: 'Cancelled At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Build the RFQs module. The Suppliers store is injected so every quoted
 * supplier must resolve by exact name (the W2 injection pattern).
 */
export function createRfqModule(
  storePath: string,
  supplierStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, RFQS_MODULE_ID, RFQ_KIND);
  return defineEnterpriseModule({
    descriptor: RFQ_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(RFQ_DESCRIPTOR, input);
        if (!result.ok) return result;
        // Immutability: awarded/cancelled RFQs are sourcing history.
        if (str(input.fields?.awardedAt) || str(input.fields?.cancelledAt)) {
          return {
            ok: false,
            errors: { status: 'This RFQ is awarded or cancelled — closed RFQs are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        if (Number(result.values.quantity ?? 0) <= 0) {
          errors.quantity = 'Quantity must be greater than zero.';
        }
        const parsed = parseRfqQuotes(str(result.values.quotesJson));
        if (parsed.errors.length > 0) {
          errors.quotesJson = parsed.errors.join(' ');
        } else if (supplierStore) {
          // No phantom vendors: every quoted supplier must exist by exact name.
          const known = new Set(supplierStore.list().map((r) => str(r.fields.name)));
          const unknown = parsed.quotes.filter((q) => !known.has(q.supplier)).map((q) => q.supplier);
          if (unknown.length > 0) {
            errors.quotesJson = `Unknown supplier(s): ${unknown.join(', ')} — quotes must come from the Suppliers register.`;
          }
        }
        const comparison = compareRfqQuotes(parsed.quotes);
        result.values.quoteCount = parsed.quotes.length;
        result.values.bestValueSupplier = comparison.bestValue?.supplier ?? '';
        result.values.bestValueUnitCost = comparison.bestValue?.unitCost ?? 0;
        result.values.bestLeadTimeSupplier = comparison.bestLeadTime?.supplier ?? '';
        result.values.status = 'open';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const rfq = rfqFromRecord(record);
        const comparison = compareRfqQuotes(rfq.quotes);
        const best = comparison.bestValue;
        return {
          moduleId: RFQS_MODULE_ID,
          recordId: record.id,
          headline: `${rfq.rfqNumber} · ${rfq.status} · ${rfq.quotes.length} quote(s) · ${rfq.product} ×${rfq.quantity}`,
          summary:
            rfq.status === 'awarded'
              ? `Awarded to ${rfq.awardedSupplier} — purchase order drafted (${rfq.awardedOrder || '—'}).`
              : rfq.status === 'cancelled'
                ? 'Cancelled — no award made.'
                : best
                  ? `${rfq.quotes.length} quote(s) in: best value ${best.supplier} at ${best.unitCost}/unit` +
                    (comparison.bestLeadTime ? `, fastest ${comparison.bestLeadTime.supplier} (${comparison.bestLeadTime.leadTimeDays}d)` : '') +
                    '. Award takes best value — edit the quote lines to change the outcome.'
                  : 'No quotes collected yet — add supplier quote lines.',
          risk: rfq.status === 'open' && rfq.quotes.length === 0 ? 'medium' : 'low',
          riskReason:
            rfq.status === 'open' && rfq.quotes.length === 0
              ? 'An open RFQ with no quotes is not sourcing anything.'
              : 'Comparison is deterministic; the award trail is auditable.',
          executiveExplanation:
            'RFQs put one product to many suppliers; the engine compares transparently and the award drafts a purchase order that walks the certified PO approval chain.',
          grounded: false,
          model: 'none',
        };
      },
      // Award + cancel stamp markers through the store directly (the W1
      // pattern) — validate's refusal guards EDITS, not these audited actions.
      runAction: async (action, record, actionCtx) => {
        const rfq = rfqFromRecord(record);
        if (rfq.status !== 'open') {
          return { ok: false, error: 'This RFQ is already closed — closed RFQs are immutable.' };
        }
        if (action === AWARD_RFQ_ACTION) {
          const winner = compareRfqQuotes(rfq.quotes).bestValue;
          if (!winner) return { ok: false, error: 'No quotes to award — collect supplier quotes first.' };
          const poModule = actionCtx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
          if (!poModule) return { ok: false, error: 'The Purchase Orders module is not available for award.' };
          await poModule.store.load();
          const poFields = {
            poNumber: `PO-${rfq.rfqNumber}`,
            supplier: winner.supplier,
            product: rfq.product,
            warehouse: rfq.warehouse,
            quantity: rfq.quantity,
            unitCost: winner.unitCost,
            subtotal: round2(rfq.quantity * winner.unitCost),
            // Carried from the RFQ. Omitting it let the purchase order fall
            // back to the descriptor default (USD), so an award could produce
            // an order in a currency the business does not buy in — and price
            // comparison correctly refuses to compare across currencies, which
            // made the awarded order invisible to the analysis that asked for
            // it.
            currency: str(record.fields.currency) || 'USD',
            expectedDelivery: rfq.neededBy ?? '',
            sourceRequest: rfq.sourceRequest,
          };
          const validation = poModule.hooks.validate({ fields: poFields });
          if (!validation.ok) {
            const first = Object.values(validation.errors)[0] ?? 'invalid purchase order input';
            return { ok: false, error: `Award failed at the purchase order: ${first}` };
          }
          const po = poModule.store.create({
            title: deriveRecordTitle(poModule.descriptor, validation.values),
            fields: validation.values,
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          actionCtx.emit(poModule, 'created', po);
          store.update(record.id, {
            fields: {
              awardedSupplier: winner.supplier,
              awardedAt: actionCtx.now(),
              awardedOrder: po.id,
              status: 'awarded',
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message: `Awarded to ${winner.supplier} at ${winner.unitCost}/unit — draft ${poFields.poNumber} created; it now walks the PO approval chain.`,
          };
        }
        if (action === CANCEL_RFQ_ACTION) {
          store.update(record.id, {
            fields: { cancelledAt: actionCtx.now(), status: 'cancelled' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: 'RFQ cancelled — no award made.' };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
