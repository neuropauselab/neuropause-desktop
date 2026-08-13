/**
 * AI Engine — shared types for the centralized reasoning layer.
 *
 * Every AI Worker and Executive Intelligence feature routes through the AI
 * Engine; no screen calls a model directly. These types describe the request
 * that goes in, the structured response that comes out, and the audit record
 * written for every call. Model-agnostic by design: callers never name a model.
 */
import type { AiRoutingMetadata } from './aiRouting';
import type { ExecutiveMemoryView, FounderMemoryCapture } from './memory';

/** Logical workers/features that may call the engine (the consumer ladder). */
export type AiWorkerId =
  | 'founder'
  | 'engineering'
  | 'research'
  | 'finance'
  | 'marketing'
  | 'support'
  | 'mission-brief'
  | 'diagnostic'
  // Phase 6 Stage 4 — the Workspace Assistant (additive).
  | 'assistant';

/** Provider-agnostic model tier the router maps to a concrete model. */
export type AiModelTier = 'fast' | 'balanced' | 'deep';

/** Where context came from — recorded on every request for auditability. */
export type AiContextSource =
  | 'knowledge-graph'
  | 'timeline'
  | 'mission-brief'
  | 'unified-model'
  | 'github'
  | 'notion'
  | 'calendar'
  | 'slack'
  | 'ai-memory'
  | 'previous-decisions'
  | 'governance-policies';

/** A single evidence reference backing a response (mirrors briefing evidence). */
export interface AiEvidence {
  kind: string;
  id: string;
}

/** A unit of context assembled by the Context Builder. */
export interface AiContextItem {
  source: AiContextSource;
  text: string;
  evidence?: AiEvidence[];
}

/** What a caller asks the engine to do. Model is never specified by the caller. */
export interface AiEngineRequest {
  worker: AiWorkerId;
  /** Versioned prompt id (e.g. 'engineering.summary'); resolved by Prompt Manager. */
  promptId: string;
  /** Variables interpolated into the prompt template. */
  variables?: Record<string, string>;
  /** Pre-built context items (the Context Builder produces these). */
  context?: AiContextItem[];
  /** Preferred tier; the router has the final say and may downgrade. */
  tier?: AiModelTier;
  /** Hard cap on output tokens. */
  maxOutputTokens?: number;
  /**
   * Phase 6 Stage 4 — end-to-end trace id (e.g. `asst_…`) propagated by the
   * caller; copied verbatim onto the call's audit record. Optional + additive.
   */
  correlationId?: string;
}

/** Token accounting for one call. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** USD, computed from the model's pricing. */
  costUsd: number;
}

/** How an engine call resolved. */
export type AiCallOutcome = 'ok' | 'error' | 'fallback';

/** The engine's structured answer. `data` is the parsed payload when JSON. */
export interface AiEngineResponse {
  /** Stable id for this response (echoes the provider response id when present). */
  responseId: string;
  worker: AiWorkerId;
  promptId: string;
  promptVersion: number;
  /** The concrete model that actually ran (callers may log but not depend on it). */
  model: string;
  /** Raw text the model produced. */
  text: string;
  /** Parsed structured payload when the prompt asked for JSON; otherwise null. */
  data: Record<string, unknown> | null;
  /** Evidence the answer is grounded in (carried from context + parsed output). */
  evidence: AiEvidence[];
  /** 0..1 self-reported/derived confidence. */
  confidence: number;
  usage: AiUsage;
  /** Wall-clock latency in ms. */
  latencyMs: number;
  contextSources: AiContextSource[];
  /** True when a real model ran; false when the deterministic fallback was used. */
  grounded: boolean;
  /**
   * Where this response's processing ACTUALLY ran — stamped by the executing
   * client (routed runs) or synthesized as `location: 'none'` (fallbacks).
   * Optional because responses predate the field; consumers treat absence as
   * "unknown", never as "local".
   */
  routing?: AiRoutingMetadata;
}

/** An immutable audit record written for every engine call. Never holds secrets. */
export interface AiAuditRecord {
  id: string;
  timestamp: string;
  worker: AiWorkerId;
  promptId: string;
  promptVersion: number;
  model: string;
  contextSources: AiContextSource[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  responseId: string;
  confidence: number;
  outcome: AiCallOutcome;
  /** Present only when outcome === 'error'; a redacted, human-readable reason. */
  error?: string;
  /** Phase 6 Stage 4 — the caller's end-to-end trace id, when supplied. */
  correlationId?: string;
}

/** Rolled-up usage for cost/budget surfaces. */
export interface AiUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  byWorker: Record<string, { calls: number; costUsd: number }>;
  byModel: Record<string, { calls: number; costUsd: number }>;
}

// --- Engineering AI -------------------------------------------------------

/** A deterministic engineering fact (from the briefing's engineering sections). */
export interface EngineeringFact {
  label: string;
  text: string;
  at: string | null;
  evidence: AiEvidence[];
}

/** The governance view shown alongside an AI recommendation before it is displayed. */
export interface GovernanceView {
  decision: 'allow' | 'blocked';
  /** True when acting on the recommendation would require human approval. */
  requiresApproval: boolean;
  reasoning: string;
  sourceSystems: AiContextSource[];
}

/**
 * The Engineering AI result. Deterministic facts are always present (and serve as
 * the offline fallback); the AI synthesis fields are populated only when a model
 * actually ran. `aiOffline` tells the UI to show a quiet "AI offline" note.
 */
export interface EngineeringAnalysis {
  rootCause: string | null;
  engineeringRisk: string | null;
  recommendedAction: string | null;
  businessImpact: string | null;
  facts: EngineeringFact[];
  grounded: boolean;
  aiOffline: boolean;
  model: string;
  confidence: number;
  evidence: AiEvidence[];
  contextSources: AiContextSource[];
  governance: GovernanceView;
  generatedAt: string;
}

/* ───────────────────────────── Founder AI v2 ───────────────────────────── */

/**
 * The deterministic intents the Founder AI classifier recognizes. `unclear` is
 * emitted when no intent matches with enough confidence — the service then asks
 * for clarification rather than guessing.
 */
export type FounderIntentV2 =
  | 'morning-brief'
  | 'release-status'
  | 'engineering'
  | 'projects'
  | 'approvals'
  | 'timeline'
  | 'search'
  | 'knowledge'
  | 'business-risk'
  | 'ai-workers'
  | 'enterprise-health'
  | 'general'
  | 'unclear';

/** The result of deterministic intent classification. */
export interface FounderIntentResult {
  intent: FounderIntentV2;
  /** 0..1 — how strongly the question matched the winning intent. */
  confidence: number;
  /** The signals that fired (for transparency / the reasoning surface). */
  matched: string[];
}

/**
 * A deterministic key finding — read directly from connected data, with evidence.
 * Never invented. These are the executive "what is true"; the model only narrates
 * over them.
 */
export interface FounderFinding {
  label: string;
  text: string;
  at: string | null;
  connectorId: string | null;
  evidence: AiEvidence[];
}

/**
 * The Founder AI v2 executive response. Key findings are deterministic and always
 * present (they are the offline fallback). The narrative fields — executiveSummary,
 * businessImpact, recommendations — are populated only when a model actually ran;
 * otherwise they are null/empty and `aiOffline` is set. When intent confidence is
 * too low, `needsClarification` is set and `clarification` carries a question — no
 * model is called and nothing is invented.
 */
/** A reference to a timeline event that informed the answer (Mission Brief v3). */
export interface FounderTimelineRef {
  id: string;
  kind: string;
  text: string;
}

export interface FounderResponse {
  question: string;
  intent: FounderIntentV2;
  intentConfidence: number;
  needsClarification: boolean;
  clarification: string | null;
  executiveSummary: string | null;
  keyFindings: FounderFinding[];
  businessImpact: string | null;
  recommendations: string[];
  grounded: boolean;
  aiOffline: boolean;
  model: string;
  confidence: number;
  evidence: AiEvidence[];
  sourceSystems: AiContextSource[];
  /** Timeline events that informed this answer (Mission Brief v3). */
  timelineReferences: FounderTimelineRef[];
  governance: GovernanceView;
  generatedAt: string;
  /** Executive memories recalled to ground this answer (relevant only). */
  recalledMemories: ExecutiveMemoryView[];
  /** What was done with this exchange afterward (stored / ignored / refused). */
  memoryCapture: FounderMemoryCapture | null;
}

/**
 * A suggested executive question, derived from current data (the Mission Brief and
 * optional live signals). `reason` explains why it surfaced; null for the evergreen
 * defaults that are always offered.
 */
export interface FounderSuggestedQuestion {
  text: string;
  intent: FounderIntentV2;
  reason: string | null;
}
