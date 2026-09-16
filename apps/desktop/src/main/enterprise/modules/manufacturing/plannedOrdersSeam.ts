/**
 * MRP → planned orders seam (ERP Session 3).
 *
 * A BOM explosion already computes a build's total purchased-material
 * requirements — but it "terminated in counts": nothing turned those
 * requirements into actionable paper. This seam drafts a Purchase Request for
 * every purchased requirement of an explosion, reusing the SAME pattern the
 * auto-reorder seam uses:
 *   • drafts through the Purchase Requests module's OWN validate hook, so it is a
 *     system-drafted DRAFT governed downstream by the existing human approval →
 *     PO conversion (and the budget control behind it) — nothing is ordered
 *     automatically; paper is drafted automatically;
 *   • idempotent — a deterministic PR number per (explosion, sku) means
 *     re-running the action never duplicates a request;
 *   • correlated — each draft inherits the explosion's transaction correlation
 *     (Session 1 spine), so a planned order traces back to the build that caused
 *     it.
 *
 * Pure orchestration over the framework (no persistence of its own); the
 * Purchase Requests module is resolved from the action context at runtime, so an
 * environment without Procurement degrades to an honest no-op.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleActionResult,
  ExplosionRequirement,
} from '@neuropause/shared';
import {
  BOM_EXPLOSIONS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  deriveRecordTitle,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { childCorrelationMeta } from '../../framework';

/** The BOM-Explosions action key that drafts planned orders. */
export const GENERATE_PLANNED_ORDERS_ACTION = 'generatePlannedOrders';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * The deterministic purchase-request number for one purchased requirement of an
 * explosion — this is the idempotency key: the same requirement always maps to
 * the same PR number, so a second run finds it already exists and skips it.
 */
export function mrpPurchaseRequestNumber(reportNumber: string, sku: string): string {
  return `PR-MRP-${reportNumber}-${sku}`;
}

/** One decided draft: a purchased requirement that has no request yet. */
export interface MrpDraftRequest {
  requestNumber: string;
  sku: string;
  quantity: number;
}

/**
 * Pure decision: which purchased requirements still need a draft purchase
 * request. Skips zero/blank lines and any requirement whose deterministic PR
 * number already exists (in any non-deleted state) — the idempotency guard.
 */
export function deriveMrpDraftRequests(
  reportNumber: string,
  requirements: readonly ExplosionRequirement[],
  existingRequestNumbers: ReadonlySet<string>,
): MrpDraftRequest[] {
  const out: MrpDraftRequest[] = [];
  for (const r of requirements) {
    const sku = str(r.sku).trim();
    const quantity = Math.max(0, Math.round(Number(r.totalQuantity ?? 0)));
    if (!sku || quantity <= 0) continue;
    const requestNumber = mrpPurchaseRequestNumber(reportNumber, sku);
    if (existingRequestNumbers.has(requestNumber)) continue;
    out.push({ requestNumber, sku, quantity });
  }
  return out;
}

/**
 * Draft a purchase request for every purchased requirement of a BOM explosion.
 * Returns an honest summary (drafted vs already-open). Never orders anything —
 * every request is a DRAFT for the human approval → PO flow to govern.
 */
export async function generatePlannedOrders(
  explosion: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  const requestsModule = ctx.moduleFor(PURCHASE_REQUESTS_MODULE_ID);
  if (!requestsModule) {
    return { ok: false, error: 'The Purchase Requests module is not available — planning needs Procurement.' };
  }
  ctx.authorize(requestsModule.descriptor.permissions.write);
  await requestsModule.store.load();

  let requirements: ExplosionRequirement[];
  try {
    requirements = JSON.parse(str(explosion.fields.requirements) || '[]') as ExplosionRequirement[];
  } catch {
    return { ok: false, error: 'This explosion has no readable requirements to plan.' };
  }
  if (!Array.isArray(requirements)) {
    return { ok: false, error: 'This explosion has no readable requirements to plan.' };
  }

  const reportNumber = str(explosion.fields.reportNumber);
  const purchasedCount = requirements.filter(
    (r) => str(r.sku) && Math.round(Number(r.totalQuantity ?? 0)) > 0,
  ).length;
  const existing = new Set(
    requestsModule.store.list().filter((r) => r.status !== 'deleted').map((r) => str(r.fields.requestNumber)),
  );
  const drafts = deriveMrpDraftRequests(reportNumber, requirements, existing);
  if (drafts.length === 0) {
    return {
      ok: true,
      message:
        purchasedCount === 0
          ? `${reportNumber} has no purchased requirements to plan.`
          : `All ${purchasedCount} purchased requirement(s) for ${reportNumber} already have a draft request.`,
    };
  }

  // Each planned order is caused by the explosion — it joins the explosion's
  // transaction (Session 1 spine). The explosion is immutable, so it is never
  // stamped back; the trace resolves it as the root from the correlation ref.
  const correlation = childCorrelationMeta(explosion, BOM_EXPLOSIONS_MODULE_ID);
  let drafted = 0;
  for (const d of drafts) {
    const validation = requestsModule.hooks.validate({
      fields: {
        requestNumber: d.requestNumber,
        department: 'Planning',
        requester: 'mrp-planning',
        product: d.sku,
        quantity: d.quantity,
        priority: 'high',
        status: 'draft',
        reason: `MRP planned order from BOM explosion ${reportNumber}.`,
      },
    });
    if (!validation.ok) continue; // an unplannable line is skipped, never a bad draft
    const rec = requestsModule.store.create({
      title: deriveRecordTitle(requestsModule.descriptor, validation.values),
      fields: validation.values,
      metadata: correlation,
      actor: ctx.actor(),
      now: ctx.now(),
    });
    ctx.emit(requestsModule, 'created', rec);
    drafted += 1;
  }

  const skipped = purchasedCount - drafted;
  return {
    ok: true,
    message: `Drafted ${drafted} purchase request(s) from ${reportNumber}${skipped > 0 ? ` (${skipped} already open)` : ''}.`,
  };
}
