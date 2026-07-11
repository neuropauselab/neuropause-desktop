/**
 * AI Sandbox — Performance & Security Lab (S5): the ports.
 *
 * The lab causes NO platform action itself. It runs scenarios through the SAME executor
 * seam S4 uses (`QaExecutor` → S1 engine → S2/S3/S4) and OBSERVES through the existing
 * diagnostics / executive / observability surfaces, injected as read-only closures. No new
 * diagnostics, monitoring, or metrics — everything is reused.
 */
import type { QaExecutor, QaRunResult } from '../agent';

export type { QaExecutor, QaRunResult };

/** Read-only observation through the EXISTING systems (NeuroCore health, executive KPIs,
 *  gateway audit, sandbox queue). All optional so the lab unit-tests without them. */
export interface LabObservers {
  /** NeuroCore.snapshot() mapped to the fields the lab reads. */
  health?: () => Promise<{ level: string; cpuPercent: number; memoryUsedMb: number }>;
  /** executiveCenter.snapshot().kpis */
  kpis?: () => { key: string; value: number | null }[];
  /** gatewayAuditEntries(limit).length — the real audit trail depth. */
  auditCount?: () => number;
  /** engine.queueState().depth — the real sandbox queue depth. */
  queueDepth?: () => Promise<number>;
}

export interface LabDeps {
  executor: QaExecutor;
  observers?: LabObservers;
  /** Optional S4 AI QA session runner, for the `ai-qa` performance target. */
  qaSession?: (goalText: string) => Promise<{ ms: number; ok: boolean }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Current process RSS (real OS memory), 0 when unavailable. */
export function rssBytes(): number {
  try {
    return typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage().rss : 0;
  } catch {
    return 0;
  }
}
