/**
 * Sales → Orders — the Sales Order module, promoted from the minimal conversion
 * target into a full lifecycle module on the Enterprise Module Framework. Same
 * blueprint as Finance/CRM/Quotes: a descriptor + the framework's record store +
 * a `validate` hook + a `summarize` hook + lifecycle module actions. CRUD, RBAC
 * (`sales:read` / `sales:manage`), audit, timeline, search, offline persistence,
 * and the entire list/detail/form UI are all inherited — nothing is re-implemented.
 *
 * DETERMINISTIC fulfillment logic, never AI, never user-forged: a `validate` hook
 * stamps the read-only `fulfillmentPct`, `shipmentProgress`, and `recognizedRevenue`
 * on every write, and the ship/fulfill/close/cancel actions apply real, guarded
 * state transitions (stamping shipped/delivered dates) via `orderActionPatch`.
 * The `summarize` hook hands the model those signals to EXPLAIN — never to set.
 *
 * Electron-free (store path + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  OrderAction,
  OrderSignals,
  SalesOrder,
} from '@neuropause/shared';
import {
  ORDERS_MODULE_ID,
  ORDER_KIND,
  computeOrderSignals,
  orderActionPatch,
  orderComputedFields,
  orderFromRecord,
  orderStatusLabel,
  orderSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { CONVERT_TO_INVOICE_ACTION, convertOrderToInvoice } from './conversion';

/** The declarative description of a sales order — drives store, CRUD, and the UI. */
export const ORDER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ORDERS_MODULE_ID,
  title: 'Sales Orders',
  singular: 'Sales Order',
  plural: 'Sales Orders',
  icon: 'package',
  description: 'Fulfil, ship, and close sales orders raised from accepted quotes.',
  group: 'Sales',
  titleField: 'orderNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  actions: [
    { key: 'ship', label: 'Ship', icon: 'upload' },
    { key: 'fulfill', label: 'Fulfill', icon: 'check' },
    { key: 'close', label: 'Close', icon: 'lock' },
    { key: 'cancel', label: 'Cancel', icon: 'close' },
    { key: CONVERT_TO_INVOICE_ACTION, label: 'Generate Invoice', icon: 'doc' },
  ],
  fields: [
    { key: 'orderNumber', label: 'Order Number', type: 'text', required: true, placeholder: 'SO-0001' },
    { key: 'customer', label: 'Customer', type: 'text', required: true, placeholder: 'Acme Inc.' },
    { key: 'contact', label: 'Contact', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'pending',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'orange' },
        { value: 'shipped', label: 'Shipped', tone: 'blue' },
        { value: 'fulfilled', label: 'Fulfilled', tone: 'green' },
        { value: 'closed', label: 'Closed', tone: 'teal' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'orderDate', label: 'Order Date', type: 'date', column: false, format: 'date' },
    { key: 'expectedDeliveryDate', label: 'Expected Delivery', type: 'date', format: 'date' },
    { key: 'orderedQty', label: 'Ordered Qty', type: 'number', min: 0, column: false },
    { key: 'fulfilledQty', label: 'Fulfilled Qty', type: 'number', min: 0, column: false },
    { key: 'fulfillmentPct', label: 'Fulfilled %', type: 'number', readOnly: true },
    { key: 'shipmentProgress', label: 'Shipment %', type: 'number', column: false, readOnly: true },
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
        { value: 'AUD', label: 'AUD' },
      ],
    },
    { key: 'total', label: 'Total', type: 'number', min: 0, format: 'currency' },
    { key: 'recognizedRevenue', label: 'Recognized Rev.', type: 'number', format: 'currency', readOnly: true },
    { key: 'carrier', label: 'Carrier', type: 'text', column: false },
    { key: 'trackingNumber', label: 'Tracking #', type: 'text', column: false },
    { key: 'shippedDate', label: 'Shipped Date', type: 'date', column: false, format: 'date', readOnly: true },
    { key: 'deliveredDate', label: 'Delivered Date', type: 'date', column: false, format: 'date', readOnly: true },
    { key: 'salesRep', label: 'Sales Rep', type: 'text', column: false },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'text', column: false },
    { key: 'deliveryTerms', label: 'Delivery Terms', type: 'text', column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false },
    { key: 'sourceQuote', label: 'Source Quote', type: 'text', column: false, readOnly: true },
    { key: 'convertedInvoice', label: 'Invoice', type: 'text', column: false, readOnly: true },
  ],
};

/** The AI narrative half of a summary; fulfillment/revenue signals stay deterministic. */
export interface OrderAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

export type OrderAiRunner = (
  order: SalesOrder,
  signals: OrderSignals,
) => Promise<OrderAiNarrative | null>;

/** Past-tense confirmation for each lifecycle action. */
const ACTION_DONE: Record<OrderAction, string> = {
  ship: 'shipped',
  fulfill: 'fulfilled',
  close: 'closed',
  cancel: 'cancelled',
};

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Project already-validated field values into a typed order (for the stamps). */
function projectValues(values: EnterpriseRecordInput['fields']): SalesOrder {
  const record: EnterpriseEntity = {
    id: '',
    moduleId: ORDERS_MODULE_ID,
    kind: ORDER_KIND,
    title: '',
    status: 'active',
    fields: { ...(values ?? {}) },
    tags: [],
    rev: 0,
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    metadata: {},
  };
  return orderFromRecord(record);
}

/**
 * Build the full Sales Orders module. `fulfillmentPct`, `shipmentProgress`, and
 * `recognizedRevenue` are stamped deterministically by the validate hook on every
 * write; the lifecycle actions apply guarded state transitions. The AI runner is
 * optional (offline → deterministic fallback).
 */
export function createOrderModule(storePath: string, aiRunner?: OrderAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ORDERS_MODULE_ID, ORDER_KIND);
  return defineEnterpriseModule({
    descriptor: ORDER_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic, read-only fulfillment stamps — computed from the record's
      // own fields (time-independent), so they are always current and never
      // user-editable or AI-set. Delivery risk is time-dependent → computed live.
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(ORDER_DESCRIPTOR, input);
        if (result.ok) {
          Object.assign(result.values, orderComputedFields(projectValues(result.values)));
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const order = orderFromRecord(record);
        const signals = computeOrderSignals(order, Date.now());
        const ai = aiRunner ? await aiRunner(order, signals).catch(() => null) : null;
        const fallback = orderSummaryFallback(order, signals);
        return {
          moduleId: ORDERS_MODULE_ID,
          recordId: record.id,
          headline: `${order.orderNumber} · ${order.customer || '—'} · ${orderStatusLabel(order.status)} · ${money(Math.round(order.total))}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: signals.assessment.health,
          riskReason: signals.assessment.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // Lifecycle actions — ship / fulfill / close / cancel. Each applies a real,
      // guarded deterministic state transition (stamping dates + recomputing the
      // fulfillment metrics) and emits the change to audit + Timeline. Illegal
      // transitions return a deterministic message, never a mutation.
      runAction: async (action, record, actionCtx) => {
        // Cross-module: raise a Finance invoice from this order.
        if (action === CONVERT_TO_INVOICE_ACTION) return convertOrderToInvoice(record, actionCtx);
        const key = action as OrderAction;
        if (!ACTION_DONE[key]) return { ok: false, error: `Unknown action "${action}".` };
        const order = orderFromRecord(record);
        const patch = orderActionPatch(key, order, actionCtx.now());
        if (!patch) {
          return {
            ok: false,
            message: `Cannot ${action} an order that is ${orderStatusLabel(order.status).toLowerCase()}.`,
          };
        }
        // Recompute the deterministic metrics on the post-transition order.
        const merged = projectValues({ ...record.fields, ...patch });
        const updated = store.update(record.id, {
          fields: { ...patch, ...orderComputedFields(merged) },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        if (!updated) return { ok: false, error: 'Order not found.' };
        const self = actionCtx.moduleFor(ORDERS_MODULE_ID);
        if (self) actionCtx.emit(self, 'updated', updated);
        return { ok: true, message: `Order ${order.orderNumber} ${ACTION_DONE[key]}.` };
      },
    },
  });
}
