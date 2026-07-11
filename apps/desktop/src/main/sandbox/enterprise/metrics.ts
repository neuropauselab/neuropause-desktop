/**
 * AI Sandbox — Enterprise Scenario Runner (S3): performance collector.
 *
 * Aggregates per-channel latency + counts across a scenario run and exports them into
 * the S1 result metrics (Step 11). Pure over an injected clock; no timers of its own.
 */
export class EnterprisePerfCollector {
  scenarioMs = 0;
  stepsRun = 0;
  stepsFailed = 0;
  stepsSkipped = 0;
  assertionsTotal = 0;
  assertionsPassed = 0;
  assertionsFailed = 0;
  sdkCalls = 0;
  cliCalls = 0;
  desktopActions = 0;
  automationRuns = 0;
  connectorSyncs = 0;
  recoveries = 0;
  private readonly restMs: number[] = [];
  private readonly stepMs: number[] = [];

  rest(ms: number): void {
    this.restMs.push(ms);
  }
  step(ms: number): void {
    this.stepMs.push(ms);
  }

  metrics(): Record<string, number> {
    const avg = (a: number[]): number => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
    let rssBytes = 0;
    try {
      // Real RSS when available (production); 0 under environments without process memory.
      rssBytes = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage().rss : 0;
    } catch {
      rssBytes = 0;
    }
    return {
      scenarioMs: this.scenarioMs,
      stepsRun: this.stepsRun,
      stepsFailed: this.stepsFailed,
      stepsSkipped: this.stepsSkipped,
      assertionsTotal: this.assertionsTotal,
      assertionsPassed: this.assertionsPassed,
      assertionsFailed: this.assertionsFailed,
      restCalls: this.restMs.length,
      restMsAvg: avg(this.restMs),
      sdkCalls: this.sdkCalls,
      cliCalls: this.cliCalls,
      desktopActions: this.desktopActions,
      automationRuns: this.automationRuns,
      connectorSyncs: this.connectorSyncs,
      stepMsAvg: avg(this.stepMs),
      stepMsMax: this.stepMs.length ? Math.max(...this.stepMs) : 0,
      recoveries: this.recoveries,
      rssBytes,
    };
  }
}
