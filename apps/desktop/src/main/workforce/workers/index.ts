/**
 * The built-in workforce: nine production workers, one per role. Each is a
 * governed, evidence-grounded composition of the intelligence layer (UDM, graph,
 * timeline, memory) — analysis skills that read, and proposal skills whose
 * side-effecting actions the Governance Runtime gates for human approval.
 *
 * `registerBuiltInWorkers` seeds the registry; `builtInSkills` produces the
 * skill lookup the Worker Runtime uses to execute them.
 */
import { createLogger } from '../../logger';
import type { WorkerRegistry } from '../registry/workerRegistry';
import type { SkillImpl, WorkerDefinition } from '../sdk';
import { buildFounderWorker } from './founder';
import { buildResearchWorker } from './research';
import { buildEngineeringWorker } from './engineering';
import { buildMarketingWorker } from './marketing';
import { buildSalesWorker } from './sales';
import { buildFinanceWorker } from './finance';
import { buildLegalWorker } from './legal';
import { buildOperationsWorker } from './operations';
import { buildSupportWorker } from './support';

const log = createLogger('workforce-workers');

const BUILDERS = [
  buildFounderWorker,
  buildResearchWorker,
  buildEngineeringWorker,
  buildMarketingWorker,
  buildSalesWorker,
  buildFinanceWorker,
  buildLegalWorker,
  buildOperationsWorker,
  buildSupportWorker,
];

/** Construct all built-in worker definitions (validated at construction). */
export function builtInWorkers(): WorkerDefinition[] {
  return BUILDERS.map((build) => build());
}

/** Register every built-in worker, preserving trust/health for already-known ids. */
export function registerBuiltInWorkers(registry: WorkerRegistry, now?: string): WorkerDefinition[] {
  const defs = builtInWorkers();
  for (const def of defs) registry.register(def, now);
  log.info('Registered built-in workers', { count: defs.length });
  return defs;
}

/** Build the worker-id → (skill-id → impl) lookup the runtime executes against. */
export function builtInSkills(defs: WorkerDefinition[]): Map<string, Map<string, SkillImpl>> {
  const map = new Map<string, Map<string, SkillImpl>>();
  for (const def of defs) map.set(def.worker.identity.id, def.skills);
  return map;
}
