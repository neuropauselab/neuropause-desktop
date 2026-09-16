/**
 * Inventory → Available-to-Promise (ATP) — a governed, immutable, point-in-time ATP snapshot
 * on the Enterprise Module Framework, modelled on the aging snapshot beside it. create =
 * generate a snapshot of on-hand / reserved / available / incoming / ATP per SKU + warehouse.
 *
 * SEMANTICS (see DECISION-MEMO-S81-INVENTORY-AGING-ATP.md):
 *   • on-hand, reserved, available come from the AUTHORITATIVE ledger — the SAME deltas the
 *     product master materializes; available = on-hand − reserved (its own definition).
 *   • incoming = outstanding quantity on OPEN purchase orders (status approved/sent) — not
 *     yet received, so never double-counted against on-hand.
 *   • ATP = available + incoming.
 * It reads the ledger + PO stores (injected, tenant-scoped) and mutates NOTHING.
 *
 * Electron-free (store paths + source stores injected), so it unit-tests without the runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import { movementFromRecord, purchaseOrderFromRecord, validateEnterpriseRecordInput } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import {
  assembleAtpInputs,
  deriveAtpSnapshot,
  incomingFromOpenOrders,
  type OpenOrderInput,
} from './inventoryIntelligenceModel';

export const ATP_MODULE_ID = 'inventory-atp';
export const ATP_KIND = 'atpReport';

export const ATP_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ATP_MODULE_ID,
  title: 'Available to Promise',
  singular: 'ATP Report',
  plural: 'ATP Reports',
  icon: 'database',
  description:
    'Point-in-time ATP snapshots — on-hand / reserved / available / incoming / ATP per SKU + warehouse (available = on-hand − reserved; ATP = available + incoming).',
  group: 'Inventory',
  titleField: 'reportNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'totalOnHand', label: 'On Hand', type: 'number', readOnly: true, default: 0 },
    { key: 'totalReserved', label: 'Reserved', type: 'number', readOnly: true, default: 0 },
    { key: 'totalAvailable', label: 'Available', type: 'number', readOnly: true, default: 0 },
    { key: 'totalIncoming', label: 'Incoming', type: 'number', readOnly: true, default: 0 },
    { key: 'totalAtp', label: 'ATP', type: 'number', readOnly: true, default: 0 },
    { key: 'lineCount', label: 'SKU·WH', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'shortfallCount', label: 'Shortfall Lines', type: 'number', readOnly: true, default: 0 },
    { key: 'rows', label: 'ATP Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the ATP module (stock-movement ledger + purchase-order stores injected, tenant-scoped). */
export function createAtpModule(
  storePath: string,
  movementStore: EnterpriseRecordStore,
  purchaseOrderStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ATP_MODULE_ID, ATP_KIND);
  return defineEnterpriseModule({
    descriptor: ATP_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(ATP_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'ATP reports are immutable snapshots — generate a new report instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        const movements = movementStore.list().map(movementFromRecord);
        const openOrders: OpenOrderInput[] = purchaseOrderStore.list().map((r) => {
          const po = purchaseOrderFromRecord(r);
          return {
            status: po.status,
            product: po.product,
            warehouse: po.warehouse,
            quantity: po.quantity,
            linesRaw: r.fields.lines,
          };
        });
        const incoming = incomingFromOpenOrders(openOrders);
        const atp = deriveAtpSnapshot(assembleAtpInputs(movements, incoming), asOfDate);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `ATP-${asOfDate}-${priorCount + 1}`;
        result.values.totalOnHand = atp.totalOnHand;
        result.values.totalReserved = atp.totalReserved;
        result.values.totalAvailable = atp.totalAvailable;
        result.values.totalIncoming = atp.totalIncoming;
        result.values.totalAtp = atp.totalAtp;
        result.values.lineCount = atp.rows.length;
        result.values.shortfallCount = atp.shortfallCount;
        result.values.rows = JSON.stringify(atp.rows);
        result.values.note =
          atp.rows.length === 0
            ? 'no on-hand, reserved or incoming stock at the as-of date — the report is empty, not fabricated'
            : `derived from the stock ledger + open purchase orders across ${atp.rows.length} SKU·warehouse line(s) at ${asOfDate}`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const shortfall = Number(f.shortfallCount ?? 0);
        return {
          moduleId: ATP_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ATP ${Number(f.totalAtp ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.totalAvailable ?? 0).toLocaleString('en-US')} available + ${Number(f.totalIncoming ?? 0).toLocaleString('en-US')} incoming = ${Number(f.totalAtp ?? 0).toLocaleString('en-US')} ATP across ${Number(f.lineCount ?? 0)} line(s); ${shortfall} shortfall line(s).`,
          risk: shortfall > 0 ? 'medium' : 'low',
          riskReason: shortfall > 0 ? 'Reserved demand exceeds available on-hand at some locations — promising leans on incoming stock.' : 'Available on-hand covers reserved demand at every location.',
          executiveExplanation:
            'Available = on-hand − reserved (the product master definition); incoming = outstanding open-PO quantity not yet received; ATP = available + incoming. Snapshots are immutable; the stock ledger is never modified.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
