/**
 * Manufacturing → Quality Inspection — incoming / in-process / final inspection of a
 * production order. A `validate` hook stamps the deterministic `qualityScore`
 * (passed + half-credit rework, over total inspected); the AI explains it but never
 * computes it. No stock effect.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  QualityInspection,
} from '@neuropause/shared';
import {
  PRODUCTION_ORDERS_MODULE_ID,
  QUALITY_INSPECTIONS_MODULE_ID,
  QUALITY_INSPECTION_KIND,
  calculateQualityScore,
  qualityInspectionFromRecord,
  qualityInspectionSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { postStockMovement } from '../inventory/postMovement';

/** The QA action that disposes a FINAL-stage failure as scrap (ERP #99 Option 1a). */
export const POST_DISPOSITION_ACTION = 'postDisposition';
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? '')) || 0);

export const QUALITY_INSPECTION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: QUALITY_INSPECTIONS_MODULE_ID,
  title: 'Quality Inspection',
  singular: 'Inspection',
  plural: 'Inspections',
  icon: 'shield',
  description: 'Inspect production quality and score pass / fail / rework / reject.',
  group: 'Manufacturing',
  titleField: 'inspectionNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  actions: [{ key: POST_DISPOSITION_ACTION, label: 'Post Disposition', icon: 'shield' }],
  fields: [
    { key: 'inspectionNumber', label: 'Inspection #', type: 'text', required: true, placeholder: 'QC-0001' },
    { key: 'scrapMovement', label: 'Scrap Movement', type: 'text', column: false, readOnly: true },
    { key: 'productionOrder', label: 'Production Order', type: 'text', placeholder: 'MO-0001' },
    {
      key: 'stage',
      label: 'Stage',
      type: 'select',
      required: true,
      default: 'final',
      badge: true,
      filterable: true,
      options: [
        { value: 'incoming', label: 'Incoming', tone: 'blue' },
        { value: 'in_process', label: 'In-Process', tone: 'purple' },
        { value: 'final', label: 'Final', tone: 'teal' },
      ],
    },
    { key: 'inspectedQuantity', label: 'Inspected', type: 'number', min: 0 },
    { key: 'passedQuantity', label: 'Passed', type: 'number', min: 0 },
    { key: 'failedQuantity', label: 'Failed', type: 'number', min: 0 },
    { key: 'reworkQuantity', label: 'Rework', type: 'number', min: 0, column: false },
    {
      key: 'result',
      label: 'Result',
      type: 'select',
      required: true,
      default: 'pass',
      badge: true,
      filterable: true,
      options: [
        { value: 'pass', label: 'Pass', tone: 'green' },
        { value: 'fail', label: 'Fail', tone: 'orange' },
        { value: 'rework', label: 'Rework', tone: 'blue' },
        { value: 'reject', label: 'Reject', tone: 'orange' },
      ],
    },
    { key: 'qualityScore', label: 'Quality Score', type: 'number', readOnly: true },
    { key: 'inspector', label: 'Inspector', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'inspected', label: 'Inspected', tone: 'green' },
      ],
    },
  ],
};

export interface QualityAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type QualityAiRunner = (inspection: QualityInspection) => Promise<QualityAiNarrative | null>;

export function createQualityModule(storePath: string, aiRunner?: QualityAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, QUALITY_INSPECTIONS_MODULE_ID, QUALITY_INSPECTION_KIND);
  return defineEnterpriseModule({
    descriptor: QUALITY_INSPECTION_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(QUALITY_INSPECTION_DESCRIPTOR, input);
        if (result.ok) {
          result.values.qualityScore = calculateQualityScore({
            passedQuantity: num(result.values.passedQuantity),
            failedQuantity: num(result.values.failedQuantity),
            reworkQuantity: num(result.values.reworkQuantity),
          });
        }
        return result;
      },
      // ERP #99 Option 1a — a FINAL-stage QA FAIL becomes scrap: post a negative
      // stock adjustment (Session 5-Fix standard cost → Dr 5010 / Cr 1300 via seam
      // #1) for the failed quantity, resolving product/warehouse from the linked
      // production order. Intermediate stages are NOT scrapped. Idempotent (a
      // deterministic scrap movement, guarded by `scrapMovement`).
      runAction: async (action, record, ctx) => {
        if (action !== POST_DISPOSITION_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const insp = qualityInspectionFromRecord(record);
        if (insp.stage !== 'final') {
          return { ok: true, message: `Disposition recorded — ${insp.stage.replace('_', '-')} stage does not scrap.` };
        }
        if (insp.result !== 'fail' && insp.result !== 'reject') {
          return { ok: true, message: `Disposition ${insp.result} — no scrap.` };
        }
        if (insp.failedQuantity <= 0) return { ok: true, message: 'No failed quantity to scrap.' };
        if (str(record.fields.scrapMovement)) return { ok: false, message: 'This inspection has already been scrapped.' };

        const ordersModule = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
        if (!ordersModule) return { ok: false, error: 'Production Orders module unavailable — cannot resolve what to scrap.' };
        await ordersModule.store.load();
        const orderRec = ordersModule.store.list().find((r) => str(r.fields.orderNumber) === insp.productionOrder && r.status !== 'deleted');
        if (!orderRec) return { ok: false, error: `Production order "${insp.productionOrder}" not found — cannot resolve product/warehouse.` };
        const product = str(orderRec.fields.product);
        const warehouse = str(orderRec.fields.warehouse);
        if (!product || !warehouse) return { ok: false, message: 'The production order has no product/warehouse to scrap.' };

        const scrap = await postStockMovement(ctx, {
          movementNumber: `MV-QA-${insp.inspectionNumber}-SCRAP`,
          type: 'adjustment',
          product,
          warehouse,
          quantity: -insp.failedQuantity, // negative → write-down → Dr 5010 / Cr 1300
          referenceModule: QUALITY_INSPECTIONS_MODULE_ID,
          referenceRecord: record.id,
          reason: `QA scrap — inspection ${insp.inspectionNumber} (final ${insp.result})`,
        });
        if (!scrap) return { ok: false, error: 'Could not post the scrap movement.' };
        const updated = store.update(record.id, { fields: { scrapMovement: scrap.id }, actor: ctx.actor(), now: ctx.now() });
        const self = ctx.moduleFor(QUALITY_INSPECTIONS_MODULE_ID);
        if (updated && self) ctx.emit(self, 'updated', updated);
        return { ok: true, message: `Scrapped ${insp.failedQuantity} of ${product} from inspection ${insp.inspectionNumber}.` };
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const inspection = qualityInspectionFromRecord(record);
        const ai = aiRunner ? await aiRunner(inspection).catch(() => null) : null;
        const fallback = qualityInspectionSummaryFallback(inspection);
        const score = calculateQualityScore(inspection);
        return {
          moduleId: QUALITY_INSPECTIONS_MODULE_ID,
          recordId: record.id,
          headline: `${inspection.inspectionNumber} · ${inspection.stage.replace('_', '-')} · ${score}% · ${inspection.result}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: inspection.result === 'reject' || inspection.result === 'fail' ? 'high' : score < 80 ? 'medium' : 'low',
          riskReason: `Inspection ${inspection.result} (${score}%).`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}
