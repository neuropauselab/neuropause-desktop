/**
 * AI Sandbox — Continuous Validation Platform (S6): the ports.
 *
 * S6 executes NOTHING itself. Every stage dispatches to an EXISTING executor — the S4
 * `QaExecutor` (→ S1 engine → S2/S3), an S4 AI QA session, or an S5 lab run — and it reuses
 * the existing scheduler (`taskScheduler`), notifications (`notificationScheduler`/event
 * bus), benchmark store (S5), memory (S4), and diagnostics/executive observers. All injected.
 */
import type { QaSessionResult } from '@neuropause/shared';
import type { QaExecutor } from '../agent';
import type { BenchmarkStore } from '../lab/benchmarkStore';
import type { LabRunConfig, LabRunOutput } from '../lab';
import type { ValidationNotification } from '@neuropause/shared';

export type { QaExecutor } from '../agent';

/** The three existing executors a pipeline stage can dispatch to. */
export interface StageExecutors {
  /** Scenario stages — S3 enterprise / S2 desktop specs through the S4 executor seam. */
  qaExecutor: QaExecutor;
  /** AI QA stages — a full S4 agent session. */
  runQaSession: (goalText: string) => Promise<QaSessionResult>;
  /** Lab stages — an S5 performance & security lab run. */
  runLab: (config: LabRunConfig) => Promise<LabRunOutput>;
}

/** Reuse of `taskScheduler` (the ONLY recurring scheduler) — never a new one. */
export interface SchedulerPort {
  every: (id: string, intervalMs: number, fn: () => void) => void;
  cancel: (id: string) => void;
}

/** Reuse of the existing notification path (`notificationScheduler` / event bus). */
export interface NotifierPort {
  notify: (event: ValidationNotification) => void;
}

/** Reuse of the existing memory for historical intelligence — never a new store. */
export interface HistoryPort {
  remember: (input: { title: string; content: string; tags: string[]; metadata?: Record<string, string | number | boolean | null> }) => void;
  recall: (query: { tag?: string; text?: string; limit?: number }) => { title: string; content: string }[];
}

/** Read-only observation through the EXISTING diagnostics / executive center. */
export interface ObserverPort {
  health?: () => Promise<{ level: string; cpuPercent: number; memoryUsedMb: number }>;
  kpis?: () => { key: string; value: number | null }[];
  queueDepth?: () => Promise<number>;
}

export interface ValidationDeps {
  executors: StageExecutors;
  /** The SAME S5 benchmark store — regression compares against it (never a duplicate). */
  benchmarks: BenchmarkStore;
  scheduler?: SchedulerPort;
  notifier?: NotifierPort;
  history?: HistoryPort;
  observers?: ObserverPort;
  now: () => number;
}

export type { LabRunConfig, LabRunOutput };
