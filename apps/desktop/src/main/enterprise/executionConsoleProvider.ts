/**
 * Operator Console provider — the READ-ONLY model the desktop Operator Console screen reads. It joins
 * the REAL Production Execution records to the immutable shop-floor event ledger and shapes the
 * executions / operators / machines / work-orders / quality / timeline / KPIs / narrative for the UI
 * via the shared `buildExecutionConsoleModel`. It writes nothing, dispatches nothing, and moves no
 * stock — every lifecycle mutation happens only through the RBAC-gated execution module actions. The
 * two stores are read the SAME way the Executive Center reads them (no second read path).
 */
import {
  buildExecutionConsoleModel,
  manufacturingEventFromRecord,
  mesExecutionFromRecord,
  type ExecutionConsoleModel,
} from '@neuropause/shared';
import { executionModule, manufacturingEventModule } from './modules/manufacturing/manufacturingInstances';

/** Assemble the read-only Operator Console model. Pure read over the existing stores; no writes. */
export function getExecutionConsoleModel(): ExecutionConsoleModel {
  const executions = executionModule.store.list({ status: 'active', limit: 5000 }).map(mesExecutionFromRecord);
  const events = manufacturingEventModule.store.list({ status: 'active', limit: 20000 }).map(manufacturingEventFromRecord);
  const nowMs = Date.now();
  return buildExecutionConsoleModel(executions, events, nowMs);
}
