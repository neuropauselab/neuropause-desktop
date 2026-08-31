/**
 * Manufacturing → BOM Explosions — immutable multi-level requirements
 * snapshots on the Enterprise Module Framework (W3.6), the Aging pattern
 * applied to the build tree: CREATING an explosion generates it. The validate
 * hook walks the injected BOMs + Products stores through the pure
 * `explodeBom` engine — sub-assemblies recurse, purchased items aggregate
 * into total requirements, the cost rollup prices leaves at standard cost,
 * and per-level quantities reuse the CERTIFIED `componentConsumption` rule
 * the execution module already consumes stock with. Cycles are detected,
 * flagged, and listed — never looped; the depth cap is reported, never
 * silent. CRUD, RBAC (`manufacturing:read` / `manufacturing:manage`), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * Explosions are IMMUTABLE — regenerate after a BOM revision; the snapshot
 * sequence is how the build tree evolved.
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
  BOM_EXPLOSIONS_MODULE_ID,
  BOM_EXPLOSION_KIND,
  activeBomFor,
  bomFromRecord,
  explodeBom,
  productFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

import { GENERATE_PLANNED_ORDERS_ACTION, generatePlannedOrders } from './plannedOrdersSeam';

/** The declarative description of a BOM explosion — drives store, CRUD, and the UI. */
export const BOM_EXPLOSION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BOM_EXPLOSIONS_MODULE_ID,
  title: 'BOM Explosions',
  singular: 'BOM Explosion',
  plural: 'BOM Explosions',
  icon: 'layers',
  description:
    'Immutable multi-level requirements — the whole build tree exploded, purchased items totalled, and material cost rolled up.',
  group: 'Manufacturing',
  titleField: 'reportNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  actions: [
    { key: GENERATE_PLANNED_ORDERS_ACTION, label: 'Generate Planned Orders', icon: 'shopping-cart' },
  ],
  fields: [
    { key: 'reportNumber', label: 'Explosion #', type: 'text', readOnly: true },
    { key: 'rootProduct', label: 'Finished Product (SKU)', type: 'text', required: true, placeholder: 'FG-0001' },
    { key: 'quantity', label: 'Build Quantity', type: 'number', required: true, min: 1, default: 1 },
    { key: 'maxDepth', label: 'Max Depth', type: 'number', min: 1, max: 12, default: 10, column: false },
    { key: 'levels', label: 'Levels', type: 'number', readOnly: true, default: 0 },
    { key: 'componentCount', label: 'Tree Nodes', type: 'number', readOnly: true, default: 0 },
    { key: 'totalMaterialCost', label: 'Material Cost', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'requirements', label: 'Requirements', type: 'textarea', readOnly: true, column: false },
    { key: 'rows', label: 'Tree', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the BOM Explosions module. BOMs + Products stores are injected so
 * generation reads the real build definitions and the real cost book.
 */
export function createBomExplosionModule(
  storePath: string,
  bomStore: EnterpriseRecordStore,
  productStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BOM_EXPLOSIONS_MODULE_ID, BOM_EXPLOSION_KIND);
  return defineEnterpriseModule({
    descriptor: BOM_EXPLOSION_DESCRIPTOR,
    store,
    hooks: {
      // Creating an explosion IS generating it; a generated explosion is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(BOM_EXPLOSION_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'BOM explosions are immutable snapshots — generate a new explosion instead.' },
            values: result.values,
          };
        }
        const rootSku = str(result.values.rootProduct).trim();
        const quantity = Number(result.values.quantity ?? 0);
        const maxDepth = Number(result.values.maxDepth ?? 10) || 10;
        const boms = bomStore.list().map(bomFromRecord);
        if (!activeBomFor(boms, rootSku)) {
          return {
            ok: false,
            errors: { rootProduct: `No ACTIVE BOM defines "${rootSku}" — activate one before exploding.` },
            values: result.values,
          };
        }
        const explosion = explodeBom(
          boms,
          productStore.list().map(productFromRecord),
          rootSku,
          quantity,
          maxDepth,
        );
        const priorCount = store.list().filter((r) => str(r.fields.rootProduct) === rootSku).length;
        result.values.rootProduct = rootSku;
        result.values.reportNumber = `BX-${rootSku}-${priorCount + 1}`;
        result.values.levels = explosion.maxLevel;
        result.values.componentCount = explosion.componentCount;
        result.values.totalMaterialCost = explosion.totalMaterialCost;
        result.values.requirements = JSON.stringify(explosion.requirements);
        result.values.rows = JSON.stringify(explosion.rows);
        result.values.note =
          `quantities via the certified componentConsumption rule; leaves priced at standard cost` +
          (explosion.unvaluedCount > 0 ? `; ${explosion.unvaluedCount} leaf item(s) uncosted — valued 0, counted` : '') +
          (explosion.cycles.length > 0 ? `; CYCLE(S) DETECTED: ${explosion.cycles.join(' | ')} — branches stopped` : '') +
          (explosion.depthCapped ? `; depth cap ${maxDepth} hit — deeper sub-assemblies treated as purchased, stated here` : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      // MRP → planned orders: draft a purchase request for every purchased
      // requirement of this explosion (idempotent; governed downstream).
      runAction: async (action, record, ctx) => {
        if (action === GENERATE_PLANNED_ORDERS_ACTION) return generatePlannedOrders(record, ctx);
        return { ok: false, error: `Unknown action "${action}".` };
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const hasCycles = str(f.note).includes('CYCLE');
        return {
          moduleId: BOM_EXPLOSIONS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${Number(f.levels ?? 0)} level(s) · material ${Number(f.totalMaterialCost ?? 0).toLocaleString('en-US')}`,
          summary: `${str(f.rootProduct)} ×${Number(f.quantity ?? 0)}: ${Number(f.componentCount ?? 0)} tree node(s) across ${Number(f.levels ?? 0)} level(s). ${str(f.note)}.`,
          risk: hasCycles ? 'high' : 'low',
          riskReason: hasCycles
            ? 'The BOM tree contains a cycle — a sub-assembly eventually contains itself; fix the BOM definitions.'
            : 'The build tree is acyclic and fully explodable.',
          executiveExplanation:
            'Explosions turn a finished product into its total purchased-material requirements and cost — the planning input for RFQs and reservations.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
