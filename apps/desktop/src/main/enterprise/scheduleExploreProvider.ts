/**
 * Production Schedule Explorer provider — the READ-ONLY model the desktop Production Schedule screen reads.
 * It mines the routing-aware schedule ONCE via the existing `computeRoutingSchedule` (no new scheduler),
 * joins in the governance proposals + the production orders, and shapes the Gantt + KPIs + violations +
 * narrative for the UI. It writes nothing and schedules nothing — commit happens only through the
 * approved Schedule Proposal lifecycle. Reuses the shared planning model (the one read used across the
 * Executive Center) so nothing is read a second way.
 */
import {
  buildScheduleExploreModel,
  computeRoutingSchedule,
  productionOrderFromRecord,
  scheduleProposalFromRecord,
  type ScheduleExploreModel,
  type ScheduleOrderRow,
} from '@neuropause/shared';
import { collectPlanningModel } from './planningModel';
import { productionOrderModule, scheduleProposalModule } from './modules/manufacturing/manufacturingInstances';

/** Assemble the read-only Production Schedule model. Pure read over the existing stores; no writes. */
export function getScheduleExploreModel(): ScheduleExploreModel {
  const { input, routings } = collectPlanningModel();
  const nowMs = Date.now();
  const schedule = computeRoutingSchedule(input, routings, nowMs);

  const proposals = scheduleProposalModule.store
    .list({ status: 'active', limit: 5000 })
    .map(scheduleProposalFromRecord)
    .sort((a, b) => b.version - a.version || a.productionOrder.localeCompare(b.productionOrder));

  const activeRoutingProducts = new Set(routings.filter((r) => r.status === 'active' && r.operations.length > 0).map((r) => r.product));
  const orders: ScheduleOrderRow[] = productionOrderModule.store.list({ status: 'active', limit: 5000 }).map((rec) => {
    const o = productionOrderFromRecord(rec);
    return {
      id: rec.id,
      orderNumber: o.orderNumber,
      product: o.product,
      quantity: o.productionQuantity,
      hasRouting: activeRoutingProducts.has(o.product),
      committed: String(rec.fields.scheduleCommitted ?? '') !== '',
    };
  });

  return buildScheduleExploreModel(schedule, proposals, orders, nowMs);
}
