/**
 * Phase 6 Stage 12 — the forecast inventory (D-5): a REGISTER of the
 * predictive capability the repository already has — the seven Stage 6
 * deterministic heuristics (joined to their currently-firing instances), the
 * P14 scenario projection, and capacity pressure (registered precisely to say
 * it predicts nothing). Every entry states what it CAN and CANNOT predict.
 * Stage 12 adds zero forecasting math — this module computes counts, never
 * futures. Pure; reads injected.
 */
import type { EanaForecastInventory, EanaUnavailable } from '@neuropause/shared';
import { PREDICTION_REGISTRY } from './analyticsRegistry';

export const FORECAST_DISCLOSURE =
  'The platform’s predictive capability is deterministic heuristics and advisory scenario projection — no statistical or ML forecasting exists anywhere in the repository, and Stage 12 adds none. This inventory registers what exists, joins the currently-firing instances, and states what each capability cannot predict.';

export interface ForecastInput {
  nowIso: string;
  /** Live Stage 6 predictions this pass ({kind, likelihood}), or null. */
  predictions: { kind: string; likelihood: number }[] | null;
  /** The P14 simulation slice (scenario count), or null. */
  simulation: { scenarios: number } | null;
  /** The Stage 9 present-state capacity pressure, or null. */
  capacityPressure: string | null;
  failures: Record<string, string>;
}

export function buildForecastInventory(input: ForecastInput): EanaForecastInventory {
  const unavailable: EanaUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));

  const entries = PREDICTION_REGISTRY.map((def) => {
    if (def.kind === 'deterministic-heuristic') {
      if (input.predictions === null) {
        return { id: def.id, kind: def.kind, source: def.source, live: null, canPredict: def.canPredict, cannotPredict: def.cannotPredict, basis: def.basis };
      }
      const firing = input.predictions.filter((p) => p.kind === def.id);
      return {
        id: def.id,
        kind: def.kind,
        source: def.source,
        live: {
          count: firing.length,
          detail:
            firing.length === 0
              ? 'not firing — its condition does not hold on the current records (or history is insufficient)'
              : `${firing.length} instance(s) firing (likelihood ${firing.map((p) => p.likelihood.toFixed(2)).join(', ')})`,
        },
        canPredict: def.canPredict,
        cannotPredict: def.cannotPredict,
        basis: def.basis,
      };
    }
    if (def.id === 'p14-simulation') {
      return {
        id: def.id,
        kind: def.kind,
        source: def.source,
        live: input.simulation === null ? null : { count: input.simulation.scenarios, detail: `${input.simulation.scenarios} authored scenario(s) available for comparison` },
        canPredict: def.canPredict,
        cannotPredict: def.cannotPredict,
        basis: def.basis,
      };
    }
    // capacity-pressure — a present-state reading, registered to say so.
    return {
      id: def.id,
      kind: def.kind,
      source: def.source,
      live: input.capacityPressure === null ? null : { count: 1, detail: `present pressure: ${input.capacityPressure}` },
      canPredict: def.canPredict,
      cannotPredict: def.cannotPredict,
      basis: def.basis,
    };
  });

  return {
    generatedAt: input.nowIso,
    entries,
    totals: {
      registered: entries.length,
      liveInstances: entries.reduce((n, e) => n + (e.live && e.kind === 'deterministic-heuristic' ? e.live.count : 0), 0),
    },
    disclosure: FORECAST_DISCLOSURE,
    unavailable,
  };
}
