/**
 * AI Sandbox — AI QA Agent (S4): performance collector.
 *
 * Aggregates the QA session's latencies + counts (planning, reasoning, observation,
 * recovery, report, LLM tokens, QA efficiency) and exports them (Step 12). Pure over an
 * injected clock.
 */
export class QaPerfCollector {
  planningMs = 0;
  reasoningMs = 0;
  observationMs = 0;
  recoveryMs = 0;
  reportMs = 0;
  sessionMs = 0;
  tasksPlanned = 0;
  tasksExecuted = 0;
  tasksPassed = 0;
  tasksFailed = 0;
  tasksSkipped = 0;
  recoveries = 0;
  bugsFiled = 0;
  learningsStored = 0;
  llmCalls = 0;
  llmTokens = 0;

  metrics(): Record<string, number> {
    let rssBytes = 0;
    try {
      rssBytes = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage().rss : 0;
    } catch {
      rssBytes = 0;
    }
    const qaEfficiency = this.tasksExecuted ? Math.round((this.tasksPassed / this.tasksExecuted) * 100) : 0;
    return {
      planningMs: this.planningMs,
      reasoningMs: this.reasoningMs,
      observationMs: this.observationMs,
      recoveryMs: this.recoveryMs,
      reportMs: this.reportMs,
      sessionMs: this.sessionMs,
      tasksPlanned: this.tasksPlanned,
      tasksExecuted: this.tasksExecuted,
      tasksPassed: this.tasksPassed,
      tasksFailed: this.tasksFailed,
      tasksSkipped: this.tasksSkipped,
      recoveries: this.recoveries,
      bugsFiled: this.bugsFiled,
      learningsStored: this.learningsStored,
      llmCalls: this.llmCalls,
      llmTokens: this.llmTokens,
      rssBytes,
      qaEfficiency,
    };
  }
}
