/**
 * AI Sandbox — AI QA Agent (S4): the ports.
 *
 * The boundaries between the reasoning layer and everything it REUSES. The AI never
 * touches the platform — it submits scenario specs to a {@link QaExecutor} (backed by the
 * S1 engine, which routes to the S2/S3 executors), reads results, and optionally consults
 * a {@link Reasoner} (deterministic by default, LLM-augmented when a model is present) and
 * the existing memory via {@link QaMemory}. Same injected-boundary pattern as S1/S2/S3.
 */
import type {
  QaAgentCategory,
  QaAgentDefinition,
  QaGoal,
  QaObservation,
  QaReflection,
  ScenarioSpec,
} from '@neuropause/shared';

/** The outcome of running one scenario through the existing executors. */
export interface QaRunResult {
  executionId: string | null;
  status: string;
  outcome: 'pass' | 'fail' | 'error' | null;
  assertions: { total: number; passed: number; failed: number };
  metrics: Record<string, number>;
  artifacts: { name: string; kind: string; ref: string | null }[];
  timelinePhases: string[];
  knowledgeGraphRefs: string[];
  error: string | null;
}

export interface QaExecutorTask {
  id: string;
  name: string;
  spec: ScenarioSpec;
}

/**
 * The ONLY way the agent causes actions. Its implementation submits a scenario to the S1
 * engine (→ S2 desktop / S3 enterprise executors) and returns the real outcome. The agent
 * cannot bypass this seam, so it cannot touch the UI, ERP, or RBAC directly.
 */
export interface QaExecutor {
  readonly kind: string;
  run(task: QaExecutorTask): Promise<QaRunResult>;
}

export interface QaReasonerResult {
  text: string;
  confidence: number;
  tokens: number;
  grounded: boolean;
}

/**
 * Optional AI augmentation over the deterministic policies. The default deterministic
 * reasoner needs no model; the LLM reasoner wraps the existing AI engine and degrades to
 * the deterministic path when no model is configured (the engine's own fallback).
 */
export interface Reasoner {
  readonly kind: string;
  /** Interpret a goal into extra planning hints (deterministic default: keyword-derived). */
  interpretGoal(goal: QaGoal, agent: QaAgentDefinition): Promise<string[]>;
  /** A natural-language root-cause narrative for a failure. */
  explainFailure(observation: QaObservation, reflection: QaReflection): Promise<QaReasonerResult>;
}

export interface QaMemoryEntry {
  title: string;
  content: string;
  tags: string[];
  entityRefs?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

/** Reuse of the EXISTING memory — never a new store. */
export interface QaMemory {
  readonly kind: string;
  /** Recall known issues relevant to an agent + targets (for planning). */
  recallKnownIssues(agent: QaAgentCategory, targets: string[]): Promise<string[]>;
  /** Store a QA learning (regression / recovery / known-issue). Returns the memory id. */
  store(entry: QaMemoryEntry): Promise<string | null>;
}
