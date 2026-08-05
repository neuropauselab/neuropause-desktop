/**
 * Phase 6 Stage 13 — the simulation inventory (G-4, simulation half).
 *
 * A REGISTER of the simulation capability the repository already has: P15's
 * advisory scenario projection, the manufacturing twin's fifteen deterministic
 * what-if scenarios, Stage 6's seven prediction heuristics, and Stage 12's
 * forecast-capability inventory (a register of registers, registered precisely
 * to say it forecasts nothing itself).
 *
 * Stage 13 adds no simulation and RUNS none: `invoked` is a constant false on
 * every entry, and there is no code path in this module or its callers that
 * could make it true. Each entry states what its capability can and cannot do.
 * Pure; reads injected.
 */
import type {
  EtwinSimulationEntry,
  EtwinSimulationInventory,
  EtwinUnavailable,
} from '@neuropause/shared';
import { SIMULATION_REGISTRY } from './twinRegistry';

export const SIMULATION_DISCLOSURE =
  'This is an inventory, not a simulator. Stage 13 invokes nothing — `invoked` is false on every entry by construction. The manufacturing twin’s fifteen scenarios are typed and authored but have no main-process importer, so the capability is declared rather than running. A null `live` reading means no instance count is observable, not that the count is zero.';

export interface SimulationInput {
  nowIso: string;
  /** Live Stage 6 predictions this pass ({kind}), or null. */
  predictions: { kind: string }[] | null;
  /** P15's scenario slice (authored scenario count), or null. */
  scenarios: { count: number } | null;
  /** Stage 12's forecast inventory slice (registered capabilities), or null. */
  forecasts: { registered: number } | null;
  failures: Record<string, string>;
}

function liveFor(
  id: string,
  kind: string,
  input: SimulationInput,
): { count: number; detail: string } | null {
  if (kind === 'deterministic-heuristic') {
    if (input.predictions === null) return null;
    const n = input.predictions.length;
    return {
      count: n,
      detail:
        n === 0
          ? 'no rule is firing — no condition holds on the current records'
          : `${n} prediction(s) firing across the seven rules`,
    };
  }
  if (id === 'p14-scenario-projection') {
    if (input.scenarios === null) return null;
    return { count: input.scenarios.count, detail: `${input.scenarios.count} scenario(s) available for comparison` };
  }
  if (id === 's12-forecast-inventory') {
    if (input.forecasts === null) return null;
    return { count: input.forecasts.registered, detail: `${input.forecasts.registered} forecasting capability(ies) registered` };
  }
  // manufacturing-what-if — typed and authored, with no main-process importer,
  // so there is nothing live to observe. Null says exactly that.
  return null;
}

export function buildSimulationInventory(input: SimulationInput): EtwinSimulationInventory {
  const unavailable: EtwinUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const entries: EtwinSimulationEntry[] = SIMULATION_REGISTRY.map((def) => ({
    id: def.id,
    label: def.label,
    kind: def.kind,
    module: def.module,
    scenarioCount: def.scenarioCount,
    live: liveFor(def.id, def.kind, input),
    canSimulate: def.canSimulate,
    cannotSimulate: def.cannotSimulate,
    // Structural, not conditional. Stage 13 has no simulation call site.
    invoked: false,
  }));

  return {
    generatedAt: input.nowIso,
    entries,
    totals: {
      registered: entries.length,
      withScenarios: entries.filter((e) => e.scenarioCount !== null).length,
      liveInstances: entries.reduce((n, e) => n + (e.live === null ? 0 : e.live.count), 0),
    },
    disclosure: SIMULATION_DISCLOSURE,
    unavailable,
  };
}
