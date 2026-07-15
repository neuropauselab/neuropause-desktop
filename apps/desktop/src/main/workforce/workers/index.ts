/**
 * The built-in workforce: a production Enterprise AI Workforce. The original nine
 * function workers (founder, research, engineering, marketing, sales, finance,
 * legal, operations, support) are joined by the P8.4 archetypes — an Executive
 * tier (CEO, COO, CTO, CFO, CIO, CISO, CDO, CCO), an Infrastructure tier (Cloud,
 * Platform, DevOps, Kubernetes, Database, Network, Security, SRE), and the two
 * remaining departments (HR, Procurement). Each is a governed, evidence-grounded
 * composition of the intelligence layer; analysis skills read, proposal skills are
 * approval-gated, and executable skills run through the existing ExecuteEngine.
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
import {
  buildCeoWorker,
  buildCooWorker,
  buildCtoWorker,
  buildCfoWorker,
  buildCioWorker,
  buildCisoWorker,
  buildCdoWorker,
  buildCcoWorker,
} from './executive';
import {
  buildCloudEngineerWorker,
  buildPlatformEngineerWorker,
  buildDevOpsEngineerWorker,
  buildKubernetesEngineerWorker,
  buildDatabaseEngineerWorker,
  buildNetworkEngineerWorker,
  buildSecurityEngineerWorker,
  buildSreWorker,
} from './infrastructure';
import { buildHrWorker } from './hr';
import { buildProcurementWorker } from './procurement';

const log = createLogger('workforce-workers');

const BUILDERS = [
  // Original function workers.
  buildFounderWorker,
  buildResearchWorker,
  buildEngineeringWorker,
  buildMarketingWorker,
  buildSalesWorker,
  buildFinanceWorker,
  buildLegalWorker,
  buildOperationsWorker,
  buildSupportWorker,
  // P8.4 — Executive tier.
  buildCeoWorker,
  buildCooWorker,
  buildCtoWorker,
  buildCfoWorker,
  buildCioWorker,
  buildCisoWorker,
  buildCdoWorker,
  buildCcoWorker,
  // P8.4 — Infrastructure tier.
  buildCloudEngineerWorker,
  buildPlatformEngineerWorker,
  buildDevOpsEngineerWorker,
  buildKubernetesEngineerWorker,
  buildDatabaseEngineerWorker,
  buildNetworkEngineerWorker,
  buildSecurityEngineerWorker,
  buildSreWorker,
  // P8.4 — remaining departments.
  buildHrWorker,
  buildProcurementWorker,
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
