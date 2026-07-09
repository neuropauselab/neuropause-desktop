/**
 * Schedule Proposal governance — the read-only-first, versioned, approval-gated path from a routing plan
 * to REAL Production Schedule records. It reuses the existing routing engine (`scheduleProductionOrderRouting`)
 * to MINE a plan, captures it as an inert proposal record, and only a human-APPROVED proposal may commit.
 * Commit persists the approved plan into the EXISTING Production Schedules module and stamps the order — it
 * never re-schedules, never overwrites a production order, and refuses if the order was already committed.
 * Recalculate supersedes the current proposal and mints the next version. Pure orchestration over the
 * framework — no store of its own; modeled on the Decision Execution Handoff governance.
 */
import type { EnterpriseEntity, EnterpriseModuleActionResult, Machine, Routing } from '@neuropause/shared';
import {
  MACHINES_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  PRODUCTION_SCHEDULES_MODULE_ID,
  ROUTINGS_MODULE_ID,
  SCHEDULE_PROPOSALS_MODULE_ID,
  buildScheduleProposalFields,
  deriveRecordTitle,
  machineFromRecord,
  productionOrderFromRecord,
  routingFromRecord,
  scheduleProductionOrderRouting,
  scheduleProposalFromRecord,
  scheduleRecordFieldsFromOperations,
  validateEnterpriseRecordInput,
  type ProductionSchedulePlan,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

interface Modules {
  routingModule: EnterpriseModule;
  machineModule: EnterpriseModule;
  ordersModule: EnterpriseModule;
  proposalsModule: EnterpriseModule;
  scheduleModule: EnterpriseModule;
}

function resolveModules(ctx: EnterpriseModuleActionContext): Modules | null {
  const routingModule = ctx.moduleFor(ROUTINGS_MODULE_ID);
  const machineModule = ctx.moduleFor(MACHINES_MODULE_ID);
  const ordersModule = ctx.moduleFor(PRODUCTION_ORDERS_MODULE_ID);
  const proposalsModule = ctx.moduleFor(SCHEDULE_PROPOSALS_MODULE_ID);
  const scheduleModule = ctx.moduleFor(PRODUCTION_SCHEDULES_MODULE_ID);
  if (!routingModule || !machineModule || !ordersModule || !proposalsModule || !scheduleModule) return null;
  return { routingModule, machineModule, ordersModule, proposalsModule, scheduleModule };
}

/** MINE a read-only plan for an order through its product's active routing. Reuses the shared engine. */
function planForOrder(orderRecord: EnterpriseEntity, m: Modules, nowMs: number): { ok: true; plan: ProductionSchedulePlan; orderNumber: string } | { ok: false; message: string } {
  const order = productionOrderFromRecord(orderRecord);
  if (!order.product || order.productionQuantity <= 0) {
    return { ok: false, message: 'Set a finished product and planned quantity before proposing a schedule.' };
  }
  const routing: Routing | undefined = m.routingModule.store
    .list()
    .map(routingFromRecord)
    .find((r) => r.product === order.product && r.status === 'active' && r.operations.length > 0);
  if (!routing) return { ok: false, message: `No active routing found for product ${order.product}.` };
  const machines: Machine[] = m.machineModule.store.list().map(machineFromRecord);
  const plan = scheduleProductionOrderRouting(
    { ref: order.orderNumber, product: order.product, quantity: order.productionQuantity, releaseDate: '', requiredDate: '', onCriticalPath: false },
    routing,
    machines,
    nowMs,
  );
  return { ok: true, plan, orderNumber: order.orderNumber };
}

/** The next proposal version for an order = 1 + the highest existing version. */
function nextVersion(orderNumber: string, m: Modules): number {
  let max = 0;
  for (const rec of m.proposalsModule.store.list()) {
    const p = scheduleProposalFromRecord(rec);
    if (p.productionOrder === orderNumber && p.version > max) max = p.version;
  }
  return max + 1;
}

async function createProposal(orderRecord: EnterpriseEntity, ctx: EnterpriseModuleActionContext, m: Modules): Promise<EnterpriseModuleActionResult> {
  ctx.authorize(m.proposalsModule.descriptor.permissions.write);
  const nowMs = Date.parse(ctx.now());
  const result = planForOrder(orderRecord, m, nowMs);
  if (!result.ok) return result;
  const version = nextVersion(result.orderNumber, m);
  const fields = buildScheduleProposalFields(result.plan, result.orderNumber, version, ctx.actor() ?? '', ctx.now());
  const validation = m.proposalsModule.hooks.validate({ fields });
  if (!validation.ok) return { ok: false, error: `Proposal: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
  const rec = m.proposalsModule.store.create({
    title: deriveRecordTitle(m.proposalsModule.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(m.proposalsModule, 'created', rec);
  const blocked = result.plan.operations.filter((o) => !o.scheduled).length;
  const suffix = blocked > 0 ? ` (${blocked} operation(s) blocked)` : '';
  return { ok: true, message: `Proposed schedule ${str(rec.fields.proposalNumber)} for ${result.orderNumber} — read-only, pending approval${suffix}.` };
}

/** Production Order → propose a read-only schedule (version N+1). Nothing is committed. */
export async function proposeScheduleForOrder(orderRecord: EnterpriseEntity, ctx: EnterpriseModuleActionContext): Promise<EnterpriseModuleActionResult> {
  const m = resolveModules(ctx);
  if (!m) return { ok: false, error: 'Scheduling modules are not available.' };
  return createProposal(orderRecord, ctx, m);
}

/** Recalculate a proposal: supersede it and mint the next version from the order's current routing/machines. */
export async function recalculateProposal(proposalRecord: EnterpriseEntity, ctx: EnterpriseModuleActionContext): Promise<EnterpriseModuleActionResult> {
  const m = resolveModules(ctx);
  if (!m) return { ok: false, error: 'Scheduling modules are not available.' };
  const proposal = scheduleProposalFromRecord(proposalRecord);
  const orderRecord = m.ordersModule.store.list().find((r) => str(r.fields.orderNumber) === proposal.productionOrder);
  if (!orderRecord) return { ok: false, message: `Production order ${proposal.productionOrder} not found.` };
  // Supersede the current proposal, then create the next version.
  const superseded = m.proposalsModule.store.update(proposalRecord.id, { fields: { status: 'superseded' }, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(m.proposalsModule, 'updated', superseded ?? proposalRecord);
  return createProposal(orderRecord, ctx, m);
}

/** Commit an APPROVED proposal: create real Production Schedule records from the approved plan + stamp. */
export async function commitProposal(proposalRecord: EnterpriseEntity, ctx: EnterpriseModuleActionContext): Promise<EnterpriseModuleActionResult> {
  const m = resolveModules(ctx);
  if (!m) return { ok: false, error: 'Scheduling modules are not available.' };
  // Human-approved write: assert the schedule module's own write permission (manufacturing:manage).
  ctx.authorize(m.scheduleModule.descriptor.permissions.write);

  const proposal = scheduleProposalFromRecord(proposalRecord);
  const orderRecord = m.ordersModule.store.list().find((r) => str(r.fields.orderNumber) === proposal.productionOrder);
  if (!orderRecord) return { ok: false, message: `Production order ${proposal.productionOrder} not found.` };
  if (str(orderRecord.fields.scheduleCommitted)) return { ok: false, message: 'A schedule has already been committed for this order.' };

  const fieldSets = scheduleRecordFieldsFromOperations(proposal.operations, proposal.productionOrder);
  if (fieldSets.length === 0) return { ok: false, message: 'The approved proposal has no schedulable operations to commit.' };

  const createdIds: string[] = [];
  for (const fields of fieldSets) {
    const validation = validateEnterpriseRecordInput(m.scheduleModule.descriptor, { fields });
    if (!validation.ok) return { ok: false, error: `Schedule: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
    const rec = m.scheduleModule.store.create({
      title: deriveRecordTitle(m.scheduleModule.descriptor, validation.values),
      fields: validation.values,
      actor: ctx.actor(),
      now: ctx.now(),
    });
    ctx.emit(m.scheduleModule, 'created', rec);
    createdIds.push(rec.id);
  }

  // Stamp the order (idempotency + audit) — never overwrites the order's own data.
  const updatedOrder = m.ordersModule.store.update(orderRecord.id, { fields: { scheduleCommitted: createdIds.join(',') }, actor: ctx.actor(), now: ctx.now() });
  ctx.emit(m.ordersModule, 'updated', updatedOrder ?? orderRecord);

  return { ok: true, createdIds } as EnterpriseModuleActionResult & { createdIds: string[] };
}
