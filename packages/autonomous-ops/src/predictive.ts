/**
 * Module 10 — Predictive Operations. Capacity / resource / risk / SLA / maintenance forecasts,
 * computed ONLY from available evidence. With no history there is no forecast — the result says so
 * honestly rather than fabricating a number.
 */
import type { OperationsGovernance } from './governance';
import type { ForecastKind } from './constants';

export interface Forecast {
  kind: ForecastKind;
  forecast: number | null;
  basis: string;
  note: string;
}

export class PredictiveOperations {
  constructor(private readonly governance: OperationsGovernance) {}

  /** Forecast the next value from real history (simple trend). Null when there is no evidence. */
  async forecast(input: { kind: ForecastKind; history: number[]; org?: string }): Promise<Forecast> {
    const h = input.history;
    if (h.length === 0) {
      return { kind: input.kind, forecast: null, basis: 'no evidence', note: 'insufficient evidence — no forecast fabricated' };
    }
    let forecast: number;
    if (h.length === 1) {
      forecast = h[0]!;
    } else {
      const first = h[0]!;
      const last = h[h.length - 1]!;
      const step = (last - first) / (h.length - 1);
      forecast = Math.round((last + step) * 100) / 100;
    }
    await this.governance.record({ user: 'system', org: input.org ?? '_ops', mission: '_forecast', operation: `forecast.${input.kind}`, targetId: input.kind, evidence: 'live-verified', decision: `${h.length} data points` });
    return { kind: input.kind, forecast, basis: `${h.length} data point(s)`, note: 'trend extrapolated from real history only' };
  }
}
