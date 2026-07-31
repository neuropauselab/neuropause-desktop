/**
 * Workspace Assistant — shared types (Phase 6 Stage 4).
 *
 * The assistant is a COMPOSITION over existing engines: the AI Engine reasons,
 * the Context Builder retrieves, the ExecuteEngine acts (behind approvals), the
 * conversation store persists. These types describe the conversational envelope
 * every response carries, the deterministic plan model, the five runtime modes,
 * the end-to-end correlation id, and the Session Inspector trace with its three
 * role-appropriate detail levels. Types + small pure constants only.
 */
import type { AiEvidence } from './aiEngine';
import type { ExecutionKind } from './executeEngine';
import type { MemoryRejection } from './memory';

/* ── Modes ─────────────────────────────────────────────────────────────────── */

/**
 * The five assistant modes. One orchestration pipeline; each mode is a
 * deterministic configuration of it — never a separate assistant.
 */
export type AssistantMode = 'ask' | 'analyze' | 'plan' | 'execute' | 'monitor';

export const ASSISTANT_MODES: readonly AssistantMode[] = [
  'ask',
  'analyze',
  'plan',
  'execute',
  'monitor',
] as const;

/** Human meta for the mode chips (shared so main + renderer agree). */
export const ASSISTANT_MODE_META: Record<AssistantMode, { label: string; hint: string }> = {
  ask: { label: 'Ask', hint: 'Quick grounded answers. No actions are offered.' },
  analyze: { label: 'Analyze', hint: 'Deep retrieval and reasoning. No actions are offered.' },
  plan: { label: 'Plan', hint: 'Builds an inspectable plan. Nothing runs — not even read steps.' },
  execute: {
    label: 'Execute',
    hint: 'Runs plans. Side-effecting steps always stop for your approval.',
  },
  monitor: {
    label: 'Monitor',
    hint: 'Deterministic operational snapshot — no AI narrative, no actions.',
  },
};

/* ── Intent ────────────────────────────────────────────────────────────────── */

/** The request classes the deterministic intent planner recognizes. */
export type AssistantIntentId =
  | 'question'
  | 'search'
  | 'analysis'
  | 'planning'
  | 'automation'
  | 'execution'
  | 'decision-support'
  | 'content-creation'
  | 'navigation'
  | 'connector-action'
  | 'workflow'
  // Phase 6 Stage 5 — task management verbs (create/update/complete/prioritize/
  // delegate) over the EXISTING memory store; additive twelfth class.
  | 'task'
  | 'unclear';

export interface AssistantIntentResult {
  intent: AssistantIntentId;
  /** 0..1 — how strongly the request matched the winning intent. */
  confidence: number;
  /** The signals that fired (for the transparency line + inspector). */
  matched: string[];
}

/* ── Plan ──────────────────────────────────────────────────────────────────── */

export type AssistantStepState =
  | 'pending'
  | 'waiting' // parked for human approval
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'skipped'; // deterministically not runnable in this mode (reason in `note`)

/** Which existing capability a plan step drives. Nothing here is a new engine. */
export type AssistantStepTool =
  | 'automation' // ExecuteEngine kind 'automation'
  | 'worker' // ExecuteEngine kind 'worker' (workforce job; its own governance still applies)
  | 'execution' // ExecuteEngine, other kinds (memory/executive/runtime)
  | 'navigate' // shell navigation (renderer resolves)
  | 'search' // Universal Search hand-off
  | 'draft' // review-only content generation
  // Phase 6 Stage 5 — additive productivity tools (local workspace operations).
  | 'task' // memory-store task lens (create/update/complete/prioritize)
  | 'reminder' // existing notificationScheduler.schedule
  | 'brief' // existing generateBriefing (deterministic daily intelligence)
  | 'meeting-prep'; // deterministic meeting collection over existing reads

export interface AssistantPlanStep {
  id: string;
  tool: AssistantStepTool;
  label: string;
  /** Spec 4.5 — every tool call declares purpose / reason / expected output. */
  purpose: string;
  reason: string;
  expectedOutput: string;
  /** True ⇒ the step can never run without an explicit human approval. */
  needsApproval: boolean;
  sideEffects: boolean;
  risk: 'low' | 'medium' | 'high';
  /** Honest rollback statement shown on the approval card. */
  rollback: string;
  state: AssistantStepState;
  /** ExecuteEngine dispatch details (approval-gated tools only). */
  executionKind: ExecutionKind | null;
  targetId: string | null;
  input: string | null;
  /** Set after the step ran. */
  executionId: string | null;
  resultSummary: string | null;
  /** What was verified about the outcome (real session state — never assumed). */
  verification: string | null;
  error: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export type AssistantPlanState =
  | 'ready'
  | 'waiting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AssistantPlan {
  id: string;
  correlationId: string;
  intent: AssistantIntentId;
  mode: AssistantMode;
  state: AssistantPlanState;
  steps: AssistantPlanStep[];
  createdAt: string;
  updatedAt: string;
}

/* ── Explainability + Session Inspector ────────────────────────────────────── */

export interface AssistantUnavailable {
  system: string;
  reason: string;
}

export interface AssistantSourceRef {
  id: string;
  label: string;
  kind: 'index' | 'records' | 'memory' | 'briefing' | 'operational' | 'ui';
  count: number | null;
}

export interface AssistantRetrievedItem {
  source: string;
  text: string;
  evidence: AiEvidence[];
}

export interface AssistantToolCall {
  id: string;
  tool: string;
  label: string;
  purpose: string;
  reason: string;
  expectedOutput: string;
  outcome: 'ok' | 'error' | 'skipped';
  detail: string | null;
  durationMs: number;
  correlationId: string;
}

export interface AssistantReasoningTrace {
  promptId: string;
  promptVersion: number;
  model: string;
  grounded: boolean;
  confidence: number;
  latencyMs: number;
  contextSources: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Joins to the AI Engine's immutable audit record. */
  responseId: string;
}

export interface AssistantWorkspaceSnapshot {
  workspace: { id: string; name: string } | null;
  workspaceCount: number | null;
  activeExecutions: number | null;
  pendingApprovals: number | null;
  connectors: { total: number; connected: number; problems: { id: string; reason: string }[] } | null;
  automations: { total: number; active: number } | null;
  recentTimeline: { id: string; at: string; kind: string; title: string }[];
  memoryTotal: number | null;
  uiContext: AssistantUiContext | null;
  unavailable: AssistantUnavailable[];
}

export interface AssistantPhaseTiming {
  phase: 'context' | 'retrieval' | 'reasoning' | 'planning' | 'execution' | 'persistence';
  durationMs: number;
}

/** Session Inspector detail levels (role-appropriate views over ONE trace). */
export type AssistantTraceLevel = 'user' | 'developer' | 'administrator';

export const ASSISTANT_TRACE_LEVELS: readonly AssistantTraceLevel[] = [
  'user',
  'developer',
  'administrator',
] as const;

/**
 * What each inspector level reveals. One deterministic mapping shared by main
 * and renderer — no hidden extra data outside these fields.
 */
export const ASSISTANT_TRACE_LEVEL_DETAIL: Record<
  AssistantTraceLevel,
  {
    label: string;
    audience: string;
    showRetrievedItems: boolean;
    showReasoningInternals: boolean;
    showPhaseTimings: boolean;
    showAuditReferences: boolean;
  }
> = {
  user: {
    label: 'User',
    audience: 'What informed this answer and what ran.',
    showRetrievedItems: false,
    showReasoningInternals: false,
    showPhaseTimings: false,
    showAuditReferences: false,
  },
  developer: {
    label: 'Developer',
    audience: 'Retrieval items, prompt/model internals, per-phase timings.',
    showRetrievedItems: true,
    showReasoningInternals: true,
    showPhaseTimings: true,
    showAuditReferences: false,
  },
  administrator: {
    label: 'Administrator',
    audience: 'Everything, plus audit joins, permission classes, and correlation chain.',
    showRetrievedItems: true,
    showReasoningInternals: true,
    showPhaseTimings: true,
    showAuditReferences: true,
  },
};

export interface AssistantTrace {
  correlationId: string;
  mode: AssistantMode;
  intent: AssistantIntentResult;
  phases: AssistantPhaseTiming[];
  workspace: AssistantWorkspaceSnapshot;
  retrieved: AssistantRetrievedItem[];
  recalledMemories: number;
  reasoning: AssistantReasoningTrace | null;
  toolCalls: AssistantToolCall[];
  /** Administrator-level joins: how this turn was authorized + audited. */
  audit: {
    permissionClass: string;
    aiResponseId: string | null;
    executionIds: string[];
    timelineEventTypes: string[];
  };
  generatedAt: string;
}

/* ── Envelope ──────────────────────────────────────────────────────────────── */

export interface AssistantFinding {
  label: string;
  text: string;
  at: string | null;
  connectorId: string | null;
  evidence: AiEvidence[];
}

export interface AssistantDraft {
  kind: 'email' | 'agenda' | 'summary';
  text: string;
  note: string;
}

/**
 * Phase 6 Stage 5 — a structured deterministic report carried on the envelope
 * (daily/weekly briefs, meeting preparation). Sections are computed from real
 * evidence by the EXISTING generators; `grounded:false` renders the honest
 * empty state. Optional + additive.
 */
export interface AssistantStructuredReport {
  kind: 'brief' | 'meeting-brief' | 'work-summary';
  title: string;
  sections: { title: string; lines: string[] }[];
  grounded: boolean;
}

/** Renderer-only situation passed with an ask (`| undefined` matches the zod
 *  contract's inference under exactOptionalPropertyTypes). */
export interface AssistantUiContext {
  section?: string | undefined;
  workspaceLabel?: string | undefined;
  tabCount?: number | undefined;
  query?: string | undefined;
}

/** Every assistant response carries this — explainability is structural. */
export interface AssistantEnvelope {
  correlationId: string;
  mode: AssistantMode;
  intent: AssistantIntentResult;
  /** Set when the request was too ambiguous — nothing was retrieved or invented. */
  clarification: string | null;
  /** The narrative answer (null when the model is offline — findings still render). */
  text: string | null;
  findings: AssistantFinding[];
  recommendations: string[];
  draft: AssistantDraft | null;
  /** A navigation resolution the renderer executes (deep link into the shell). */
  navigation: { section: string; query: string | null } | null;
  /** Phase 6 Stage 5 — structured deterministic report (brief / meeting prep). */
  structured?: AssistantStructuredReport | null;
  plan: AssistantPlan | null;
  sources: AssistantSourceRef[];
  toolCalls: AssistantToolCall[];
  confidence: number;
  grounded: boolean;
  aiOffline: boolean;
  unavailable: AssistantUnavailable[];
  assumptions: string[];
  reasoningSummary: string | null;
  trace: AssistantTrace;
  memoryCapture: { outcome: string; type: string } | null;
  generatedAt: string;
}

/* ── Conversations ─────────────────────────────────────────────────────────── */

export type AssistantRole = 'user' | 'assistant';

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  at: string;
  /** User text (possibly redacted) or the assistant's short text. */
  text: string;
  /** Present on assistant messages only. */
  envelope: AssistantEnvelope | null;
  /** Governance screen refusals applied before this user text was stored. */
  redactions: MemoryRejection[];
}

export interface AssistantConversation {
  id: string;
  workspaceId: string | null;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** Branch lineage: the conversation + message this one forked from. */
  parent: { conversationId: string; messageId: string } | null;
  messages: AssistantMessage[];
}

export interface AssistantConversationSummary {
  id: string;
  workspaceId: string | null;
  title: string;
  pinned: boolean;
  updatedAt: string;
  messageCount: number;
  lastIntent: AssistantIntentId | null;
  /** Phase 6 Stage 5 — plan steps still parked for approval (follow-up signal). */
  waitingSteps?: number;
}

/* ── Streaming events (assistant:event broadcast) ──────────────────────────── */

export interface AssistantEvent {
  kind: 'phase' | 'step' | 'turn';
  correlationId: string;
  conversationId: string;
  at: string;
  /** kind 'phase': which pipeline phase changed. */
  phase?: AssistantPhaseTiming['phase'] | 'done';
  /** kind 'step': the plan step + its new state. */
  stepId?: string;
  stepState?: AssistantStepState;
  note?: string;
}

/* ── Response shells for the IPC surface ───────────────────────────────────── */

export interface AssistantAskResult {
  conversation: AssistantConversation;
  /** The assistant message this turn produced. */
  messageId: string;
}

export interface AssistantConversationsResult {
  conversations: AssistantConversationSummary[];
}
