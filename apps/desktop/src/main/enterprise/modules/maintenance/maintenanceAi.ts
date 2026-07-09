/**
 * Maintenance AI runners — bridges from work orders / assets / downtime events to the
 * EXISTING AI pipeline. Each hands deterministic facts to the model and asks only for
 * narrative; the model never computes a cost, downtime, or health. Returns null when
 * no model is configured → deterministic fallback.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  Asset,
  DowntimeEvent,
  WorkOrder,
} from '@neuropause/shared';
import { calculateAssetHealth, calculateMaintenanceCost } from '@neuropause/shared';
import type { WorkOrderAiNarrative } from './workOrderModule';
import type { AssetAiNarrative } from './assetModule';
import type { DowntimeAiNarrative } from './downtimeEventModule';

export interface MaintenanceAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

interface Narrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

async function run(
  engine: MaintenanceAiEngine,
  promptId: string,
  variables: Record<string, string>,
): Promise<Narrative | null> {
  const res = await engine.run({ worker: 'support', promptId, tier: 'fast', variables, maxOutputTokens: 380 });
  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation = typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}

export async function runWorkOrderAi(engine: MaintenanceAiEngine, wo: WorkOrder): Promise<WorkOrderAiNarrative | null> {
  const facts = [
    `Work order: ${wo.workOrderNumber}`,
    `Type: ${wo.type}`,
    `Machine: ${wo.machine || '(none)'}`,
    `Asset: ${wo.asset || '(none)'}`,
    `Technician: ${wo.technician || '(unassigned)'}`,
    `Priority: ${wo.priority}`,
    `Downtime: ${wo.downtimeHours}h`,
    `Deterministic cost: ${calculateMaintenanceCost([wo])}`,
    `Result: ${wo.result}`,
    `Status: ${wo.status}`,
  ].join('\n');
  return run(engine, 'maintenance.work-order-summary', { workOrder: facts, status: wo.status });
}

export async function runAssetAi(engine: MaintenanceAiEngine, asset: Asset): Promise<AssetAiNarrative | null> {
  const health = calculateAssetHealth(asset);
  const facts = [
    `Asset: ${asset.name} (${asset.assetTag})`,
    `Category: ${asset.category || '(none)'}`,
    `Location: ${asset.location || '(none)'}`,
    `Linked machine: ${asset.machine || '(none)'}`,
    `Criticality: ${asset.criticality}`,
    `Breakdowns: ${asset.breakdownCount}`,
    `Status: ${asset.status}`,
    `Deterministic health: ${health.level} — ${health.reason}`,
  ].join('\n');
  return run(engine, 'maintenance.asset-summary', { asset: facts, health: health.level, healthReason: health.reason });
}

export async function runDowntimeAi(engine: MaintenanceAiEngine, event: DowntimeEvent): Promise<DowntimeAiNarrative | null> {
  const facts = [
    `Event: ${event.eventNumber}`,
    `Machine: ${event.machine || '(none)'}`,
    `Type: ${event.type}`,
    `Cause: ${event.cause || '(none)'}`,
    `Duration: ${event.durationHours}h`,
    `Status: ${event.status}`,
  ].join('\n');
  return run(engine, 'maintenance.downtime-summary', { event: facts, type: event.type });
}
