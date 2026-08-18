/**
 * Workspace Assistant Service (Phase 6 Stage 4) — the turn pipeline.
 *
 *   Conversation → Context → Retrieval → Reasoning → Planning → Approval →
 *   Execution → Verification → Response
 *
 * A COMPOSITION over existing engines, all injected as ports: the Context
 * Builder retrieves, the AI Engine reasons (never without context), the
 * ExecuteEngine executes (only after an explicit human approval on a gated plan
 * step), the conversation store persists, and the platform event bus +
 * assistant broadcast carry progress. One Correlation ID (`asst_…`) is minted
 * per turn and propagated into every retrieval trace, AI invocation (→ the AI
 * audit record), approval, execution request (→ execution.* timeline events),
 * assistant timeline event, and memory-audit record.
 *
 * Honesty contract (Stage 2/3 doctrine): every context collector settles
 * independently — a failing subsystem becomes an explicit `unavailable`
 * reason, never a silent zero; with no model the deterministic findings still
 * answer (`aiOffline: true`); nothing side-effecting ever runs without an
 * approval recorded on the step. Pure orchestration: unit-tests electron-free.
 */
import type {
  AiContextItem,
  AiEngineRequest,
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantEvent,
  AssistantAskResult,
  AssistantFinding,
  AssistantIntentResult,
  AssistantMessage,
  AssistantMode,
  AssistantPhaseTiming,
  AssistantPlanStep,
  AssistantRetrievedItem,
  AssistantSourceRef,
  AssistantStructuredReport,
  AssistantToolCall,
  AssistantUiContext,
  AssistantUnavailable,
  AssistantWorkspaceSnapshot,
  ExecutionRequest,
  ExecutionSession,
  MemoryScreenResult,
} from '@neuropause/shared';
import {
  ASSISTANT_CONFIDENCE_FLOOR,
  baseEnvelope,
  buildPlan,
  classifyAssistantIntent,
  conversationTitle,
  emptyWorkspaceSnapshot,
  INTENT_QUERIES,
  MODE_CONFIG,
  nameMatches,
  parseTaskCommand,
  planStateFrom,
  renderHistory,
  renderWorkspaceSnapshot,
  resolveBriefRequest,
  resolveAnalyticsQuestion,
  resolveAutomationQuestion,
  resolveFederationQuestion,
  resolveInsightQuestion,
  resolveKnowledgeQuestion,
  resolveMeetingPrep,
  resolveOperationsQuestion,
  resolveStrategyQuestion,
  resolveTwinQuestion,
  resolveWorkSummary,
  type PlanTargets,
} from './assistantModel';
import { noModelRouting } from '@neuropause/shared';
import {
  resolveDeterministicAnswer,
  type DeterministicPorts,
} from './deterministicAnswers';
import { renderReportMaterial } from './productivity';
import { assistantMailSendIntent } from '../capabilities/assistantMailIntent';
import { servingDraftMailer } from '../ai/brain/mailDraftGateway';
import type { ConversationStore } from './conversationStore';
import type { CapabilityCatalogView } from '../capabilities/capabilityDiscoveryService';

/* ── Ports ─────────────────────────────────────────────────────────────────── */

export interface AssistantContextPorts {
  /** Local workspace contexts (id/name/active). */
  workspaces?: () => { active: { id: string; name: string } | null; count: number };
  connectors?: () => { id: string; connected: boolean; problem: string | null }[];
  /**
   * The live, tenant-scoped capability catalog — what this user's connected accounts can actually do (read/mutate,
   * consequential, approval, availability, governed-certified or not). Discovery metadata only: no credential, no
   * callable, no authority. Present so the assistant/AI knows the available capabilities before deciding anything;
   * it never grants execution.
   */
  capabilities?: () => CapabilityCatalogView;
  executions?: () => { active: number };
  pendingApprovals?: () => number;
  automations?: () => { id: string; name: string; actionCount: number; active: boolean }[];
  workers?: () => { id: string; name: string; role: string }[];
  timeline?: (limit: number) => { id: string; at: string; kind: string; title: string }[];
  memoryTotal?: () => number;
}

export interface AssistantServiceDeps {
  store: Pick<ConversationStore, 'get' | 'upsert' | 'list' | 'delete'>;
  context: AssistantContextPorts;
  /** The EXISTING Context Builder (worker 'assistant'). */
  buildContext: (req: {
    worker: 'assistant';
    query: string;
    maxItems?: number;
    maxChars?: number;
    perSourceLimit?: number;
    now?: string;
  }) => AiContextItem[];
  /** The EXISTING AI Engine. Never called without assembled context. */
  runAi: (req: AiEngineRequest) => Promise<AiEngineResponse>;
  /**
   * Deterministic-answer ports — the seam that answers lookup/aggregate
   * questions from records and system data WITHOUT invoking any model.
   * Optional: absent ports simply mean fewer questions resolve here.
   */
  deterministic?: DeterministicPorts;
  /**
   * Measured-intelligence sink for turns the AI ENGINE never saw ('none').
   * Engine-backed turns are measured by the engine itself — recording them
   * here too would double-count. Feeds the AI Usage / economics surface.
   */
  recordProcessing?: (location: 'none') => void;
  /** Audited executive-memory recall; the correlation id tags its audit event. */
  recallMemories?: (question: string, now: string, correlationId: string) => { title: string }[];
  /** Capture the exchange through the EXISTING conversation-memory governance. */
  captureMemory?: (args: {
    question: string;
    answerText: string | null;
    grounded: boolean;
    conversationId: string;
    correlationId: string;
    now: string;
  }) => { outcome: string; type: string } | null;
  /** Governance screen (secrets/PHI) applied BEFORE anything is stored or processed. */
  screen: (text: string) => MemoryScreenResult;
  /** The EXISTING ExecuteEngine — the ONLY execution path. */
  execute: (req: ExecutionRequest) => Promise<ExecutionSession>;
  cancelExecution?: (id: string) => unknown;
  /** Platform event bus (→ enterprise timeline). */
  publish?: (event: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
    correlationId?: string;
  }) => void;
  /** assistant:event broadcast toward the renderer. */
  broadcast?: (event: AssistantEvent) => void;
  newId?: () => string;
  now?: () => string;

  /* ── Phase 6 Stage 5 — productivity ports (all optional; an absent port makes
     its flow report an explicit unavailable reason — never a silent zero). ── */
  /** D-3: the memory-store task lens (kind 'task'; auto-run local writes). */
  tasks?: {
    create: (input: {
      title: string;
      due: string | null;
      priority: 'high' | 'normal';
      conversationId: string;
      correlationId: string;
      now: string;
    }) => { id: string; title: string };
    complete: (id: string, now: string, correlationId: string) => { id: string; title: string } | null;
    list: () => { id: string; title: string; status: string; due: string | null; priority: string; createdAt: string }[];
  };
  /** D-8: reminder via the EXISTING notificationScheduler.schedule (local, auto-run). */
  scheduleReminder?: (r: { title: string; at: string; correlationId: string }) => { id: string };
  /** D-2: the EXISTING briefing generator, shaped as a structured report. */
  briefing?: (
    period: 'morning' | 'afternoon' | 'evening' | 'weekly' | 'monthly',
    now: string,
  ) => AssistantStructuredReport;
  /** D-4: the deterministic meeting-prep collector (existing reads only). */
  meetingPrep?: (requestText: string, now: string, correlationId: string) => AssistantStructuredReport | null;
  /** Stage 5 addition #2: descriptive daily Work Summary over existing metrics. */
  workSummary?: (now: string) => AssistantStructuredReport;
  /** Phase 6 Stage 6 (D-5): the Enterprise Intelligence Layer's ten-question
   *  resolver — deterministic, evidence-cited, read-only. Null = unmatched. */
  intelligence?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 7 (D-8): the Knowledge Platform's ten-question resolver —
   *  deterministic, evidence-cited, authority-stating, read-only. Null = unmatched. */
  knowledge?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 8 (D-8): the Automation Platform's six-question resolver —
   *  deterministic, read-only; execution stays behind the existing gates. */
  automation?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 9 (D-8) — the Operations Platform port (ten questions). */
  operations?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 10 (D-8) — the Strategy Platform port (eleven questions:
   *  objectives, portfolio, value, planning, capabilities, risks, board brief).
   *  Read-only; recommendations point at existing governed surfaces. */
  strategy?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 11 (D-8) — the Federation Platform port (ten questions:
   *  partners, trust evidence, exchange, shared layers, governance, network,
   *  federation report). Read-only; composes RECORDS, never networking. */
  federation?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 12 (D-8) — the Analytics Platform port (ten questions:
   *  KPI catalog/health, trends, regressions, forecast capability, decision
   *  intelligence, benchmarks, coverage, analytics report). Read-only;
   *  COMPOSES the existing producers — computes no analytics of its own. */
  analytics?: (text: string, now: string) => AssistantStructuredReport | null;
  /** Phase 6 Stage 13 (D-8) — the Digital Twin Platform port (ten questions:
   *  twin status, runtime/execution twin, the S6–S12 platform twins, state
   *  coverage, simulation capability, recorded history, drift, dashboard,
   *  platform report). Read-only; COMPOSES the P15 Enterprise Digital Twin,
   *  which stays authoritative and untouched — nothing here mutates it, and
   *  an unreadable input is reported unreadable rather than composed as zero. */
  twin?: (text: string, now: string) => AssistantStructuredReport | null;
}

export interface AssistantAskInput {
  text: string;
  mode?: AssistantMode;
  conversationId?: string;
  workspaceId?: string | null;
  uiContext?: AssistantUiContext;
  now?: string;
}

export interface AssistantDecideInput {
  conversationId: string;
  messageId: string;
  stepId: string;
  decision: 'approve' | 'reject';
  note?: string | null;
  now?: string;
}

const EVENT_SOURCE = 'workspace-assistant';

/** Phase 6 Stage 5 — outcome of the deterministic productivity resolutions. */
interface ProductivityOutcome {
  findings: AssistantFinding[];
  assumptions: string[];
  unavailable: AssistantUnavailable[];
  structured: AssistantStructuredReport | null;
  narrativePrompt: 'brief.executive-summary' | 'assistant.meeting-brief' | null;
}

let fallbackSeq = 0;

export class AssistantService {
  private readonly newId: () => string;
  private readonly clock: () => string;
  /** Correlation ids cancelled mid-flight (checked before late phases apply). */
  private readonly cancelled = new Set<string>();
  /** conversationId → the correlationId of its in-flight turn. */
  private readonly inflight = new Map<string, string>();

  constructor(private readonly deps: AssistantServiceDeps) {
    this.newId = deps.newId ?? ((): string => `${Date.now().toString(36)}${(fallbackSeq++).toString(36)}`);
    this.clock = deps.now ?? ((): string => new Date().toISOString());
  }

  /* ── The turn pipeline ─────────────────────────────────────────────────── */

  async ask(input: AssistantAskInput): Promise<AssistantAskResult> {
    const now = input.now ?? this.clock();
    const mode: AssistantMode = input.mode ?? 'ask';
    const correlationId = `asst_${this.newId()}`;
    const phases: AssistantPhaseTiming[] = [];
    const toolCalls: AssistantToolCall[] = [];
    const timelineEventTypes: string[] = [];

    const conversation = this.loadOrCreateConversation(input, now);
    this.inflight.set(conversation.id, correlationId);
    this.cancelled.delete(correlationId);

    const emitPhase = (phase: AssistantEvent['phase']): void => {
      this.deps.broadcast?.({
        kind: 'phase',
        correlationId,
        conversationId: conversation.id,
        at: this.clock(),
        phase,
      });
    };
    const publish = (type: string, metadata: Record<string, string | number | boolean | null>): void => {
      timelineEventTypes.push(type);
      this.deps.publish?.({
        type,
        category: 'runtime',
        source: EVENT_SOURCE,
        metadata,
        correlationId,
      });
    };

    publish('assistant.turn.started', { mode, conversationId: conversation.id });

    // ── Governance screen FIRST: refuse to process or store secrets. ──
    const screened = this.deps.screen(input.text);
    if (!screened.allowed) {
      const intent: AssistantIntentResult = { intent: 'unclear', confidence: 0, matched: [] };
      const envelope = baseEnvelope(correlationId, mode, intent, now, {
        clarification:
          'That message appears to contain sensitive data (' +
          screened.rejections.map((r) => r.category).join(', ') +
          "). I won't store or process credentials or sensitive identifiers — remove them and ask again.",
        assumptions: [],
      });
      envelope.trace.phases = phases;
      const redactedText = `[redacted — refused: ${screened.rejections.map((r) => r.category).join(', ')}]`;
      const messageId = this.appendTurn(conversation, redactedText, screened.rejections, envelope, now);
      publish('assistant.turn.refused', { reason: 'sensitive-data' });
      emitPhase('done');
      this.inflight.delete(conversation.id);
      await this.deps.store.upsert(conversation);
      return { conversation, messageId };
    }

    // ── Intent (deterministic; below the floor → clarification, nothing invented). ──
    const intent = classifyAssistantIntent(input.text);
    const cfg = MODE_CONFIG[mode];
    // Phase 6 Stage 5: a matched productivity resolver (brief / work summary /
    // meeting prep) IS a clear request even when the intent rules score low
    // (e.g. the bare "morning brief") — those turns proceed deterministically.
    const productivityResolved =
      !cfg.operational &&
      (resolveBriefRequest(input.text) !== null ||
        resolveWorkSummary(input.text) ||
        resolveMeetingPrep(input.text) ||
        // Phase 6 Stage 6 — the ten enterprise intelligence questions are clear
        // requests even when the generic intent rules score low.
        resolveInsightQuestion(input.text) !== null ||
        // Phase 6 Stage 7 — the ten knowledge questions likewise.
        resolveKnowledgeQuestion(input.text) !== null ||
        // Phase 6 Stage 8 — the six automation questions likewise.
        resolveAutomationQuestion(input.text) !== null ||
        // Phase 6 Stage 9 — the ten operations questions likewise.
        resolveOperationsQuestion(input.text) !== null ||
        // Phase 6 Stage 10 — the eleven strategy questions likewise.
        resolveStrategyQuestion(input.text) !== null ||
        // Phase 6 Stage 11 — the ten federation questions likewise.
        resolveFederationQuestion(input.text) !== null ||
        // Phase 6 Stage 12 — the ten analytics questions likewise.
        resolveAnalyticsQuestion(input.text) !== null ||
        // Phase 6 Stage 13 — the ten digital-twin questions likewise.
        resolveTwinQuestion(input.text) !== null);

    // ── Wave-2 Slice-13 — an explicit mail.send request becomes a schema-constrained candidate via the trusted,
    // deterministic generator: recipients are extracted LITERALLY from THIS live turn (never resolved from names,
    // contacts, or synced content), and the untrusted model only drafts subject/body. On a clear INTENT we hand the
    // params to the renderer through `envelope.mailIntent` + a deep link to the Connector Center, where the EXISTING
    // M365WritePanel renders the proposal via the Slice-12 feed (one surface). The AI gains NO authority; the human
    // still confirms downstream through the certified path. Only the user's explicit live turn reaches here. ──
    if (!cfg.operational) {
      // BRAIN-1 ③ — the draft lane goes through the gateway's serving selector.
      // Today it serves the deterministic referenceDrafter (zero-model); flipping
      // to a real model is eval-gated (DECISIONS D-13). The deterministic guards
      // in assistantMailSendIntent own `to`/action regardless of the drafter.
      const mail = assistantMailSendIntent(input.text, {}, servingDraftMailer());
      if (mail.kind === 'INTENT') {
        const envelope = baseEnvelope(correlationId, mode, intent, now);
        envelope.text = `I've prepared an email to ${mail.params.to.join(', ')} for your review. Open the Microsoft 365 panel in the Connector Center — nothing is sent without your explicit confirmation.`;
        envelope.mailIntent = { to: [...mail.params.to], subject: mail.params.subject, body: mail.params.body };
        envelope.navigation = { section: 'connectors', query: null };
        envelope.grounded = true;
        envelope.confidence = 0.9;
        envelope.trace.phases = phases;
        const messageId = this.appendTurn(conversation, input.text, [], envelope, now);
        publish('assistant.turn.mail-intent', { recipients: mail.params.to.length });
        emitPhase('done');
        this.inflight.delete(conversation.id);
        await this.deps.store.upsert(conversation);
        return { conversation, messageId };
      }
      // A send-shaped turn with an UNRESOLVED recipient (a name/alias, or none) never guesses an address (rule 1) —
      // the assistant ASKS. No mailIntent, no proposal, no execution.
      if (mail.kind === 'NEEDS_CLARIFICATION') {
        const envelope = baseEnvelope(correlationId, mode, intent, now, { clarification: mail.question });
        envelope.trace.phases = phases;
        const messageId = this.appendTurn(conversation, input.text, [], envelope, now);
        publish('assistant.turn.clarification', { intent: 'mail-send' });
        emitPhase('done');
        this.inflight.delete(conversation.id);
        await this.deps.store.upsert(conversation);
        return { conversation, messageId };
      }
    }

    if (
      !cfg.operational &&
      !productivityResolved &&
      (intent.intent === 'unclear' || intent.confidence < ASSISTANT_CONFIDENCE_FLOOR)
    ) {
      const envelope = baseEnvelope(correlationId, mode, intent, now, {
        clarification:
          "I'm not sure what you're asking. Try, for example: “summarize today's work”, “find overdue invoices”, “show connector problems”, “launch the onboarding automation”, or “draft a customer response”.",
      });
      envelope.trace.phases = phases;
      const messageId = this.appendTurn(conversation, input.text, [], envelope, now);
      publish('assistant.turn.clarification', { intent: intent.intent });
      emitPhase('done');
      this.inflight.delete(conversation.id);
      await this.deps.store.upsert(conversation);
      return { conversation, messageId };
    }

    // ── Phase 6 Stage 5 (D-3): task turns parse deterministically FIRST; an
    // unparseable task request asks for clarification instead of guessing. ──
    const taskCmd =
      intent.intent === 'task' && !cfg.operational ? parseTaskCommand(input.text, now) : null;
    if (
      intent.intent === 'task' &&
      !cfg.operational &&
      (taskCmd === null || (taskCmd.action !== 'list' && taskCmd.title === null))
    ) {
      const envelope = baseEnvelope(correlationId, mode, intent, now, {
        clarification:
          'Tell me what to do with the task — for example: “add a task to send the Q3 deck tomorrow”, “remind me in 2 hours to call Sam”, “mark the deck task done”, or “show my open tasks”.',
      });
      envelope.trace.phases = phases;
      const messageId = this.appendTurn(conversation, input.text, [], envelope, now);
      publish('assistant.turn.clarification', { intent: intent.intent });
      emitPhase('done');
      this.inflight.delete(conversation.id);
      await this.deps.store.upsert(conversation);
      return { conversation, messageId };
    }

    // ── Deterministic-first (the intelligence planner's first branch). A
    // question with exactly one computable answer — arithmetic, the clock, a
    // record aggregate — is answered HERE, from the owning service, and the
    // AI engine is never invoked for it. A permission refusal is an answer
    // too: falling through would let the model answer over data the records
    // layer just refused to show.
    if (this.deps.deterministic) {
      const det = resolveDeterministicAnswer(input.text, this.deps.deterministic, now);
      if (det) {
        const envelope = baseEnvelope(correlationId, mode, intent, now);
        envelope.text = det.answer;
        envelope.reasoningSummary = det.reason;
        envelope.findings = det.findings;
        envelope.sources = det.sources;
        envelope.grounded = true;
        envelope.aiOffline = false;
        envelope.confidence = 0.98;
        envelope.processing = noModelRouting(
          'private_first',
          `${det.reason} (resolver: ${det.resolver})`,
          now,
        );
        envelope.trace.phases = phases;
        this.deps.recordProcessing?.('none');
        const messageId = this.appendTurn(conversation, input.text, [], envelope, now);
        publish('assistant.turn.deterministic', { resolver: det.resolver });
        emitPhase('done');
        this.inflight.delete(conversation.id);
        await this.deps.store.upsert(conversation);
        return { conversation, messageId };
      }
    }

    // ── Context collection (Stage 2 isolation: per-collector settle). ──
    emitPhase('context');
    const t0 = Date.now();
    const snapshot = this.collectWorkspaceSnapshot(input.uiContext ?? null);
    phases.push({ phase: 'context', durationMs: Date.now() - t0 });

    // ── Retrieval (retrieve first — the model never answers without it). ──
    emitPhase('retrieval');
    const t1 = Date.now();
    const retrieval = cfg.retrieval
      ? this.retrieve(input.text, intent, cfg.retrieval, now, correlationId, toolCalls)
      : { items: [] as AiContextItem[], unavailable: [] as AssistantUnavailable[] };
    const recall =
      cfg.retrieval && this.deps.recallMemories
        ? this.safeRecall(input.text, now, correlationId)
        : { memories: [] as { title: string }[], unavailable: [] as AssistantUnavailable[] };
    const recalled = recall.memories;
    phases.push({ phase: 'retrieval', durationMs: Date.now() - t1 });

    // ── Deterministic findings (always present; the offline floor). ──
    const findings = this.assembleFindings(snapshot, retrieval.items);

    // ── Planning (deterministic templates; locate targets from live records). ──
    emitPhase('planning');
    const t2 = Date.now();
    const targets = this.locateTargets(input.text, intent);
    const plan = cfg.operational
      ? null
      : buildPlan(intent.intent, mode, correlationId, targets, now);
    phases.push({ phase: 'planning', durationMs: Date.now() - t2 });

    // ── Phase 6 Stage 5 — deterministic productivity flows (D-2/D-3/D-4 +
    // Work Summary). Auto-run LOCAL operations recorded as tool calls; the
    // structured report carries computed sections (grounded:false = honest
    // empty). Precedence: meeting prep → work summary → brief (most specific
    // first); tasks are handled on their own intent. ──
    const productivity: ProductivityOutcome = cfg.operational
      ? { findings: [], assumptions: [], unavailable: [], structured: null, narrativePrompt: null }
      : this.runProductivityFlows(input.text, intent, taskCmd, conversation.id, correlationId, now, toolCalls);
    findings.push(...productivity.findings);

    // ── Reasoning (mode-gated; grounded narrative over verified facts only). ──
    emitPhase('reasoning');
    const t3 = Date.now();
    let ai: AiEngineResponse | null = null;
    if (cfg.reason && productivity.structured && productivity.narrativePrompt) {
      ai = await this.reasonOverReport(input.text, productivity.structured, productivity.narrativePrompt, cfg.tier, correlationId);
    } else if (cfg.reason) {
      ai = await this.reason(input.text, mode, intent, conversation, snapshot, findings, retrieval.items, cfg.tier, correlationId);
    }
    phases.push({ phase: 'reasoning', durationMs: Date.now() - t3 });

    if (this.cancelled.has(correlationId)) {
      return this.finishCancelled(conversation, input.text, correlationId, mode, intent, now, phases, publish, emitPhase);
    }

    // ── Drafting (content-creation: review-only, never sent). ──
    let draft: AssistantEnvelope['draft'] = null;
    if (intent.intent === 'content-creation' && cfg.reason) {
      draft = await this.draft(input.text, findings, retrieval.items, correlationId, toolCalls);
    }

    // ── Envelope assembly (explainability is structural). ──
    const envelope = baseEnvelope(correlationId, mode, intent, now);
    envelope.plan = plan;
    envelope.draft = draft;
    envelope.findings = findings;
    envelope.structured = productivity.structured;
    envelope.unavailable = [
      ...snapshot.unavailable,
      ...retrieval.unavailable,
      // Round 36 — Gate 15: a failed memory recall is reported, not silent.
      ...recall.unavailable,
      ...productivity.unavailable,
    ];
    envelope.navigation = targets.navigate ?? (intent.intent === 'search' && targets.searchQuery ? { section: 'search', query: targets.searchQuery } : null);
    envelope.sources = this.assembleSources(snapshot, retrieval.items, recalled.length);
    if (productivity.structured) {
      envelope.sources.push({
        id: 'productivity-report',
        label: productivity.structured.title,
        kind: 'briefing',
        count: productivity.structured.sections.length,
      });
    }
    envelope.toolCalls = toolCalls;
    envelope.assumptions = this.assembleAssumptions(intent, mode, targets, snapshot);
    envelope.assumptions.push(...productivity.assumptions);
    if (ai) {
      envelope.grounded = ai.grounded;
      envelope.aiOffline = !ai.grounded;
      envelope.confidence = ai.grounded ? ai.confidence : 0;
      envelope.text = readStr(ai.data, 'answer') ?? readStr(ai.data, 'executiveSummary');
      envelope.recommendations = readStrArray(ai.data, 'recommendations');
      envelope.assumptions.push(...readStrArray(ai.data, 'assumptions'));
      envelope.reasoningSummary = ai.grounded
        ? `Narrative synthesized by ${ai.model} strictly over ${findings.length} deterministic finding${findings.length === 1 ? '' : 's'} and ${retrieval.items.length} retrieved item${retrieval.items.length === 1 ? '' : 's'}.`
        : 'No model was reachable — showing deterministic findings only.';
      envelope.trace.reasoning = {
        promptId: ai.promptId,
        promptVersion: ai.promptVersion,
        model: ai.model,
        grounded: ai.grounded,
        confidence: ai.confidence,
        latencyMs: ai.latencyMs,
        contextSources: ai.contextSources,
        inputTokens: ai.usage.inputTokens,
        outputTokens: ai.usage.outputTokens,
        costUsd: ai.usage.costUsd,
        responseId: ai.responseId,
      };
      envelope.trace.audit.aiResponseId = ai.responseId;
      // Where this turn's AI processing ACTUALLY ran — copied from the
      // engine response, which carries the executing client's own stamp.
      envelope.processing = ai.routing ?? null;
    } else {
      envelope.reasoningSummary = cfg.operational
        ? 'Monitor mode — deterministic operational snapshot; no model narrative by design.'
        : 'Reasoning disabled for this mode.';
      envelope.grounded = findings.length > 0;
      envelope.aiOffline = !cfg.reason;
      envelope.confidence = findings.length > 0 ? 0.9 : 0;
      if (cfg.operational) envelope.text = this.monitorText(snapshot);
      // No model was invoked for this turn — an answer, not an absence: the
      // findings were computed deterministically on this device.
      envelope.processing = noModelRouting(
        'private_first',
        cfg.operational
          ? 'No AI model ran — monitor mode computes its snapshot deterministically on this device.'
          : 'No AI model ran for this turn — the result was computed deterministically on this device.',
        now,
      );
      this.deps.recordProcessing?.('none');
    }
    // A grounded structured report keeps the turn grounded even when the model
    // is offline — the sections themselves are computed evidence (Stage 5).
    if (productivity.structured?.grounded) {
      envelope.grounded = true;
      if (envelope.confidence === 0) envelope.confidence = 0.9;
    }
    envelope.trace.phases = phases;
    envelope.trace.workspace = snapshot;
    envelope.trace.retrieved = retrieval.items.map(
      (it): AssistantRetrievedItem => ({ source: it.source, text: it.text, evidence: it.evidence ?? [] }),
    );
    envelope.trace.recalledMemories = recalled.length;
    envelope.trace.toolCalls = toolCalls;
    envelope.trace.audit.timelineEventTypes = timelineEventTypes;

    // ── Workspace memory capture (existing governance; correlation-tagged). ──
    if (this.deps.captureMemory) {
      envelope.memoryCapture = this.deps.captureMemory({
        question: input.text,
        answerText: envelope.text,
        grounded: envelope.grounded,
        conversationId: conversation.id,
        correlationId,
        now,
      });
    }

    // ── Persist + respond. ──
    const t4 = Date.now();
    const messageId = this.appendTurn(conversation, input.text, [], envelope, now);
    await this.deps.store.upsert(conversation);
    phases.push({ phase: 'persistence', durationMs: Date.now() - t4 });
    publish('assistant.turn.completed', {
      intent: intent.intent,
      grounded: envelope.grounded,
      planSteps: plan ? plan.steps.length : 0,
    });
    emitPhase('done');
    this.inflight.delete(conversation.id);
    return { conversation, messageId };
  }

  /* ── Approval → dispatch (the ONLY execution path; ExecuteEngine only). ──── */

  async decideStep(input: AssistantDecideInput): Promise<AssistantConversation | null> {
    const now = input.now ?? this.clock();
    const conversation = this.deps.store.get(input.conversationId);
    if (!conversation) return null;
    const message = conversation.messages.find((m) => m.id === input.messageId);
    const plan = message?.envelope?.plan ?? null;
    if (!message || !plan) return conversation;
    const step = plan.steps.find((s) => s.id === input.stepId);
    if (!step) return conversation;
    // Idempotent: only a step still waiting for a human can be decided.
    if (step.state !== 'waiting' || !step.needsApproval) return conversation;

    const correlationId = plan.correlationId;
    step.decidedBy = 'user';
    step.decidedAt = now;
    if (input.note) step.note = input.note;

    const publish = (type: string, metadata: Record<string, string | number | boolean | null>): void => {
      this.deps.publish?.({ type, category: 'runtime', source: EVENT_SOURCE, metadata, correlationId });
    };
    const emitStep = (state: AssistantPlanStep['state'], note?: string): void => {
      this.deps.broadcast?.({
        kind: 'step',
        correlationId,
        conversationId: conversation.id,
        at: this.clock(),
        stepId: step.id,
        stepState: state,
        ...(note ? { note } : {}),
      });
    };

    if (input.decision === 'reject') {
      step.state = 'rejected';
      plan.state = planStateFrom(plan.steps);
      plan.updatedAt = now;
      publish('assistant.approval.rejected', { stepId: step.id, label: step.label });
      emitStep('rejected');
      await this.deps.store.upsert(conversation);
      return conversation;
    }

    publish('assistant.approval.granted', { stepId: step.id, label: step.label });

    // Plan mode: approvals are recorded but nothing dispatches by design.
    if (!MODE_CONFIG[plan.mode].dispatchOnApproval) {
      step.state = 'completed';
      step.resultSummary = 'Approved (Plan mode) — nothing was dispatched by design.';
      step.verification = 'No execution occurred; switch to Execute mode to run this step.';
      plan.state = planStateFrom(plan.steps);
      plan.updatedAt = now;
      emitStep('completed', 'Plan mode: recorded, not dispatched');
      await this.deps.store.upsert(conversation);
      return conversation;
    }

    if (!step.executionKind || !step.targetId) {
      step.state = 'failed';
      step.error = 'Step carries no execution binding.';
      plan.state = planStateFrom(plan.steps);
      plan.updatedAt = now;
      emitStep('failed');
      await this.deps.store.upsert(conversation);
      return conversation;
    }

    step.state = 'running';
    plan.state = planStateFrom(plan.steps);
    plan.updatedAt = now;
    emitStep('running');
    await this.deps.store.upsert(conversation);

    try {
      const session = await this.deps.execute({
        kind: step.executionKind,
        targetId: step.targetId,
        ...(step.input ? { input: step.input } : {}),
        label: step.label,
        correlationId,
      });
      const ok = session.state === 'completed';
      step.executionId = session.id;
      step.state = ok ? 'completed' : 'failed';
      step.resultSummary = session.resultSummary ?? (ok ? 'Completed' : null);
      step.error = ok ? null : (session.error ?? `Execution ${session.state}`);
      // Verification is read from the REAL session — never assumed.
      step.verification = `ExecuteEngine session ${session.id} → ${session.state}${
        session.durationMs !== null ? ` in ${session.durationMs}ms` : ''
      }${session.resultSummary ? ` — ${session.resultSummary}` : ''}`;
      if (message.envelope) {
        message.envelope.trace.audit.executionIds.push(session.id);
      }
      publish(ok ? 'assistant.step.completed' : 'assistant.step.failed', {
        stepId: step.id,
        executionId: session.id,
        ok,
      });
      emitStep(step.state);
    } catch (err) {
      step.state = 'failed';
      step.error = err instanceof Error ? err.message : String(err);
      publish('assistant.step.failed', { stepId: step.id, ok: false });
      emitStep('failed');
    }
    plan.state = planStateFrom(plan.steps);
    plan.updatedAt = this.clock();
    await this.deps.store.upsert(conversation);
    return conversation;
  }

  /* ── Interrupt / branch ────────────────────────────────────────────────── */

  cancel(conversationId: string): { cancelled: boolean } {
    const correlationId = this.inflight.get(conversationId);
    if (!correlationId) return { cancelled: false };
    this.cancelled.add(correlationId);
    this.deps.publish?.({
      type: 'assistant.turn.cancelled',
      category: 'runtime',
      source: EVENT_SOURCE,
      metadata: { conversationId },
      correlationId,
    });
    return { cancelled: true };
  }

  async branch(conversationId: string, messageId: string, now = this.clock()): Promise<AssistantConversation | null> {
    const source = this.deps.store.get(conversationId);
    if (!source) return null;
    const idx = source.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;
    const branched: AssistantConversation = {
      id: `conv_${this.newId()}`,
      workspaceId: source.workspaceId,
      title: `${source.title} (branch)`,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      parent: { conversationId, messageId },
      messages: source.messages.slice(0, idx + 1).map((m) => ({ ...m })),
    };
    await this.deps.store.upsert(branched);
    return branched;
  }

  /* ── Pipeline internals ────────────────────────────────────────────────── */

  private loadOrCreateConversation(input: AssistantAskInput, now: string): AssistantConversation {
    if (input.conversationId) {
      const existing = this.deps.store.get(input.conversationId);
      if (existing) return existing;
    }
    return {
      id: `conv_${this.newId()}`,
      workspaceId: input.workspaceId ?? null,
      title: conversationTitle(input.text),
      pinned: false,
      createdAt: now,
      updatedAt: now,
      parent: null,
      messages: [],
    };
  }

  private appendTurn(
    conversation: AssistantConversation,
    userText: string,
    redactions: AssistantMessage['redactions'],
    envelope: AssistantEnvelope,
    now: string,
  ): string {
    const userMsg: AssistantMessage = {
      id: `msg_${this.newId()}`,
      role: 'user',
      at: now,
      text: userText,
      envelope: null,
      redactions,
    };
    const assistantMsg: AssistantMessage = {
      id: `msg_${this.newId()}`,
      role: 'assistant',
      at: this.clock(),
      text: envelope.clarification ?? envelope.text ?? this.fallbackText(envelope),
      envelope,
      redactions: [],
    };
    conversation.messages.push(userMsg, assistantMsg);
    conversation.updatedAt = this.clock();
    return assistantMsg.id;
  }

  private fallbackText(envelope: AssistantEnvelope): string {
    if (envelope.structured) {
      return envelope.structured.grounded
        ? `${envelope.structured.title} — ${envelope.structured.sections.length} section${envelope.structured.sections.length === 1 ? '' : 's'} (details below).`
        : `${envelope.structured.title} — nothing to report yet (no evidence found).`;
    }
    if (envelope.findings.length > 0)
      return `${envelope.findings.length} verified finding${envelope.findings.length === 1 ? '' : 's'} (AI narrative offline).`;
    if (envelope.plan) return 'Plan prepared — review the steps below.';
    if (envelope.navigation) return `Opening ${envelope.navigation.section}.`;
    return 'No evidence available to answer confidently.';
  }

  /** Every collector settles independently; failures become explicit reasons. */
  private collectWorkspaceSnapshot(uiContext: AssistantUiContext | null): AssistantWorkspaceSnapshot {
    const s = emptyWorkspaceSnapshot();
    s.uiContext = uiContext;
    const c = this.deps.context;
    const tryCollect = (system: string, fn: (() => void) | undefined, missing: string): void => {
      if (!fn) {
        s.unavailable.push({ system, reason: missing });
        return;
      }
      try {
        fn();
      } catch (err) {
        s.unavailable.push({ system, reason: err instanceof Error ? err.message : String(err) });
      }
    };
    tryCollect(
      'workspaces',
      c.workspaces
        ? (): void => {
            const w = c.workspaces!();
            s.workspace = w.active;
            s.workspaceCount = w.count;
          }
        : undefined,
      'workspace port not wired',
    );
    tryCollect(
      'connectors',
      c.connectors
        ? (): void => {
            const list = c.connectors!();
            s.connectors = {
              total: list.length,
              connected: list.filter((x) => x.connected).length,
              problems: list
                .filter((x) => x.problem !== null)
                .slice(0, 8)
                .map((x) => ({ id: x.id, reason: x.problem as string })),
            };
          }
        : undefined,
      'connector port not wired',
    );
    tryCollect(
      'executions',
      c.executions
        ? (): void => {
            s.activeExecutions = c.executions!().active;
          }
        : undefined,
      'execution port not wired',
    );
    tryCollect(
      'approvals',
      c.pendingApprovals
        ? (): void => {
            s.pendingApprovals = c.pendingApprovals!();
          }
        : undefined,
      'workforce port not wired',
    );
    tryCollect(
      'automations',
      c.automations
        ? (): void => {
            const rules = c.automations!();
            s.automations = { total: rules.length, active: rules.filter((r) => r.active).length };
          }
        : undefined,
      'automation port not wired',
    );
    tryCollect(
      'timeline',
      c.timeline
        ? (): void => {
            s.recentTimeline = c.timeline!(6);
          }
        : undefined,
      'timeline port not wired',
    );
    tryCollect(
      'memory',
      c.memoryTotal
        ? (): void => {
            s.memoryTotal = c.memoryTotal!();
          }
        : undefined,
      'memory port not wired',
    );
    return s;
  }

  private retrieve(
    text: string,
    intent: AssistantIntentResult,
    budget: { maxItems: number; maxChars: number; perSourceLimit: number },
    now: string,
    correlationId: string,
    toolCalls: AssistantToolCall[],
  ): { items: AiContextItem[]; unavailable: AssistantUnavailable[] } {
    const started = Date.now();
    const query = `${text} ${INTENT_QUERIES[intent.intent]}`.trim();
    try {
      const items = this.deps.buildContext({
        worker: 'assistant',
        query,
        maxItems: budget.maxItems,
        maxChars: budget.maxChars,
        perSourceLimit: budget.perSourceLimit,
        now,
      });
      toolCalls.push({
        id: `tc_${this.newId()}`,
        tool: 'retrieval',
        label: 'Enterprise retrieval (Context Builder)',
        purpose: 'Gather the evidence the answer must be grounded in.',
        reason: 'Retrieve first, reason second — the model never answers without context.',
        expectedOutput: `Up to ${budget.maxItems} evidence-tagged context items.`,
        outcome: 'ok',
        detail: `${items.length} item(s) across ${new Set(items.map((i) => i.source)).size} source(s)`,
        durationMs: Date.now() - started,
        correlationId,
      });
      return { items, unavailable: [] };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toolCalls.push({
        id: `tc_${this.newId()}`,
        tool: 'retrieval',
        label: 'Enterprise retrieval (Context Builder)',
        purpose: 'Gather the evidence the answer must be grounded in.',
        reason: 'Retrieve first, reason second.',
        expectedOutput: 'Evidence-tagged context items.',
        outcome: 'error',
        detail: reason,
        durationMs: Date.now() - started,
        correlationId,
      });
      return { items: [], unavailable: [{ system: 'retrieval', reason }] };
    }
  }

  /**
   * P13C ROUND 36 — GATE 15. This was the ONE exception to this file's stated
   * contract ("a failing subsystem becomes an explicit `unavailable` — never a
   * silent zero", line 17): a memory-recall throw returned `[]` with no
   * report, so the assistant answered ungrounded and told the user nothing.
   * Same shape as the sibling `retrieve` catch, now with the same honesty.
   */
  private safeRecall(
    text: string,
    now: string,
    correlationId: string,
  ): { memories: { title: string }[]; unavailable: AssistantUnavailable[] } {
    try {
      return { memories: this.deps.recallMemories!(text, now, correlationId), unavailable: [] };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { memories: [], unavailable: [{ system: 'memory', reason }] };
    }
  }

  /** Deterministic findings: operational facts + top retrieved evidence. */
  private assembleFindings(
    snapshot: AssistantWorkspaceSnapshot,
    items: AiContextItem[],
  ): AssistantFinding[] {
    const findings: AssistantFinding[] = [];
    if (snapshot.connectors && snapshot.connectors.problems.length > 0) {
      for (const p of snapshot.connectors.problems.slice(0, 4)) {
        findings.push({
          label: 'Connector problem',
          text: `${p.id}: ${p.reason}`,
          at: null,
          connectorId: p.id,
          evidence: [{ kind: 'connector', id: p.id }],
        });
      }
    }
    if (snapshot.pendingApprovals !== null && snapshot.pendingApprovals > 0) {
      findings.push({
        label: 'Approvals',
        text: `${snapshot.pendingApprovals} proposal(s) awaiting your approval in the workforce.`,
        at: null,
        connectorId: null,
        evidence: [{ kind: 'workforce', id: 'awaiting_approval' }],
      });
    }
    for (const item of items.slice(0, 8)) {
      findings.push({
        label: item.source,
        text: item.text.length > 220 ? `${item.text.slice(0, 217)}…` : item.text,
        at: null,
        connectorId: null,
        evidence: item.evidence ?? [],
      });
    }
    return findings;
  }

  /* ── Phase 6 Stage 5 — productivity flows (D-2/D-3/D-4 + Work Summary) ──── */

  private toolCall(
    toolCalls: AssistantToolCall[],
    correlationId: string,
    started: number,
    fields: {
      tool: string;
      label: string;
      purpose: string;
      reason: string;
      expectedOutput: string;
      outcome: 'ok' | 'error' | 'skipped';
      detail: string | null;
    },
  ): void {
    toolCalls.push({
      id: `tc_${this.newId()}`,
      ...fields,
      durationMs: Date.now() - started,
      correlationId,
    });
  }

  /**
   * Run the deterministic productivity resolutions for this turn. Local task
   * writes AUTO-RUN (workspace data, not external side effects — D-3) and are
   * recorded as inspectable tool calls; briefs/meeting prep/work summary are
   * read-only compositions returned as a structured report. Every failure or
   * absent port becomes an explicit unavailable/assumption — never a guess.
   */
  private runProductivityFlows(
    text: string,
    intent: AssistantIntentResult,
    taskCmd: ReturnType<typeof parseTaskCommand>,
    conversationId: string,
    correlationId: string,
    now: string,
    toolCalls: AssistantToolCall[],
  ): ProductivityOutcome {
    const findings: AssistantFinding[] = [];
    const assumptions: string[] = [];
    const unavailable: AssistantUnavailable[] = [];
    let structured: AssistantStructuredReport | null = null;
    let narrativePrompt: 'brief.executive-summary' | 'assistant.meeting-brief' | null = null;

    // ── D-3: task commands (own intent). ──
    if (intent.intent === 'task' && taskCmd) {
      this.runTaskCommand(taskCmd, conversationId, correlationId, now, toolCalls, findings, assumptions, unavailable);
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // ── Read-only report resolutions (most specific first). ──

    // Phase 6 Stage 6 (D-5): the ten enterprise questions resolve through the
    // Enterprise Intelligence Layer — deterministic, evidence-cited, read-only.
    // Suggested recoveries stay suggestions; anything that acts still goes
    // through a gated plan step, exactly like every other flow.
    if (resolveInsightQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.intelligence) {
        unavailable.push({ system: 'intelligence', reason: 'intelligence port not wired' });
      } else {
        try {
          const reportOut = this.deps.intelligence(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from enterprise intelligence',
              purpose: 'Resolve the question against the composed intelligence report (signals → correlation → evidence).',
              reason: 'The question matches an enterprise intelligence resolver; the answer cites real records with a confidence breakdown.',
              expectedOutput: 'An evidence-cited intelligence report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'intelligence', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'intelligence', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 7 (D-8): the ten knowledge questions resolve through the
    // Knowledge Platform — deterministic, evidence-cited, authority-stating,
    // read-only. Answers ride the existing 'intelligence' structured-report
    // kind; anything that would CHANGE knowledge stays a gated plan step.
    if (resolveKnowledgeQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.knowledge) {
        unavailable.push({ system: 'knowledge', reason: 'knowledge port not wired' });
      } else {
        try {
          const reportOut = this.deps.knowledge(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the knowledge platform',
              purpose: 'Resolve the question against the composed knowledge inventory (assets → authority → evidence).',
              reason: 'The question matches a knowledge resolver; the answer cites real records, states its authority, and declares uncertainty.',
              expectedOutput: 'An evidence-cited knowledge report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'knowledge', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'knowledge', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 8 (D-8): the six automation questions resolve through the
    // Automation Platform — deterministic, read-only. Building saves through
    // the EXISTING automations:save as a gated plan step; running a playbook
    // stays behind the EXISTING workflow/approval flow. Nothing executes here.
    if (resolveAutomationQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.automation) {
        unavailable.push({ system: 'automation', reason: 'automation port not wired' });
      } else {
        try {
          const reportOut = this.deps.automation(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the automation platform',
              purpose: 'Resolve the question against the composed automation catalog/plan/monitor (orchestration reads only).',
              reason: 'The question matches an automation resolver; plans expose why/evidence/conditions/outcome/rollback/confidence/affected systems.',
              expectedOutput: 'An evidence-cited automation report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'automation', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'automation', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 9 (D-8): the ten operations questions resolve through the
    // Operations Platform — deterministic, read-only. Recommendations POINT to
    // the existing gated flow; nothing executes here.
    if (resolveOperationsQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.operations) {
        unavailable.push({ system: 'operations', reason: 'operations port not wired' });
      } else {
        try {
          const reportOut = this.deps.operations(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the operations platform',
              purpose: 'Resolve the question against the composed service catalog / SLA / readiness / incidents / continuity (reads only).',
              reason: 'The question matches an operations resolver; recommendations carry evidence, reasoning, confidence, affected systems, operational impact, expected outcome, and rollback implications.',
              expectedOutput: 'An evidence-cited operations report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'operations', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'operations', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 10 (D-8): the eleven strategy questions resolve through the
    // Enterprise Strategy Platform — deterministic, read-only. Objectives,
    // portfolio state, business value, capability analysis, and risks are all
    // COMPUTED from live composed views; focus items are Principle-C
    // recommendations that POINT at existing gated flows. Nothing executes here.
    if (resolveStrategyQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.strategy) {
        unavailable.push({ system: 'strategy', reason: 'strategy port not wired' });
      } else {
        try {
          const reportOut = this.deps.strategy(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the strategy platform',
              purpose: 'Resolve the question against the composed objectives / portfolio / value / capability map / risks (reads only).',
              reason: 'The question matches a strategy resolver; answers cite computed views, declare unavailability, and never invent measures.',
              expectedOutput: 'An evidence-cited strategy report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'strategy', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'strategy', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 11 (D-8): the ten federation questions resolve through the
    // Enterprise Federation Platform — deterministic, read-only. Partners,
    // trust evidence, the exchange, and shared layers are COMPUTED from the
    // records the federation stores already hold (never live networking);
    // recommendations POINT at the existing governed fed:* surfaces. Nothing
    // executes here.
    if (resolveFederationQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.federation) {
        unavailable.push({ system: 'federation', reason: 'federation port not wired' });
      } else {
        try {
          const reportOut = this.deps.federation(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the federation platform',
              purpose: 'Resolve the question against the composed partners / trust evidence / exchange / shared layers (reads only).',
              reason: 'The question matches a federation resolver; answers cite recorded federation state, declare unavailability, and never claim live connectivity.',
              expectedOutput: 'An evidence-cited federation report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'federation', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'federation', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 12 (D-8): the ten analytics questions resolve through the
    // Enterprise Analytics Platform — deterministic, read-only. The KPI
    // catalog, trends, forecast inventory, and decision rollup are COMPOSED
    // from the producers the platform already runs (never recomputed, never
    // extrapolated); recommendations POINT at the existing governed surfaces.
    // Nothing executes here.
    if (resolveAnalyticsQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.analytics) {
        unavailable.push({ system: 'analytics', reason: 'analytics port not wired' });
      } else {
        try {
          const reportOut = this.deps.analytics(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the analytics platform',
              purpose: 'Resolve the question against the composed KPI catalog / trends / forecast inventory / decision rollup (reads only).',
              reason: 'The question matches an analytics resolver; answers cite the producers verbatim, declare unavailability, and never extrapolate.',
              expectedOutput: 'An evidence-cited analytics report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'analytics', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'analytics', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    // Phase 6 Stage 13 (D-8): the ten digital-twin questions resolve through
    // the Enterprise Digital Twin Platform — deterministic, read-only. The
    // runtime/execution twin, the S6–S12 platform twins, the state-coverage
    // map, the simulation inventory and the recorded history are COMPOSED over
    // the P15 twin and the engines it already runs; P15 stays authoritative and
    // is never modified. A read that fails is reported unreadable — never
    // formatted as a zero — and every simulation is described as registered,
    // never invoked. Nothing executes here.
    if (resolveTwinQuestion(text) !== null) {
      const started = Date.now();
      if (!this.deps.twin) {
        unavailable.push({ system: 'twin', reason: 'twin platform port not wired' });
      } else {
        try {
          const reportOut = this.deps.twin(text, now);
          if (reportOut) {
            structured = reportOut;
            narrativePrompt = 'brief.executive-summary';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'brief',
              label: 'Answer from the digital twin platform',
              purpose:
                'Resolve the question against the composed runtime twin / platform twins / state-coverage map / simulation inventory / recorded history (reads only).',
              reason:
                'The question matches a twin resolver; answers compose the authoritative P15 twin without modifying it, report unreadable inputs as unreadable rather than as zeros, and never claim a simulation was invoked.',
              expectedOutput: 'An evidence-cited digital twin report.',
              outcome: 'ok',
              detail: `${reportOut.sections.length} section(s) for “${reportOut.title}”`,
            });
          } else {
            unavailable.push({ system: 'twin', reason: 'resolver matched but produced no report' });
          }
        } catch (err) {
          unavailable.push({ system: 'twin', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    if (resolveMeetingPrep(text)) {
      const started = Date.now();
      if (!this.deps.meetingPrep) {
        unavailable.push({ system: 'meeting-prep', reason: 'meeting-prep port not wired' });
      } else {
        try {
          const report = this.deps.meetingPrep(text, now, correlationId);
          if (report) {
            structured = report;
            narrativePrompt = 'assistant.meeting-brief';
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'meeting-prep',
              label: 'Prepare meeting brief',
              purpose: 'Collect participants, related material, activity, decisions, and memory for the meeting.',
              reason: 'You asked to be prepared; the collector reads existing systems only.',
              expectedOutput: 'A sectioned meeting brief from real records.',
              outcome: 'ok',
              detail: `${report.sections.length} section(s) for “${report.title}”`,
            });
          } else {
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'meeting-prep',
              label: 'Prepare meeting brief',
              purpose: 'Collect meeting material.',
              reason: 'You asked to be prepared.',
              expectedOutput: 'A sectioned meeting brief.',
              outcome: 'skipped',
              detail: 'No upcoming meeting found in the calendar (next 48 h).',
            });
            assumptions.push('No upcoming meeting was found in your calendar (next 48 h) — nothing was prepared.');
          }
        } catch (err) {
          unavailable.push({ system: 'meeting-prep', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    if (resolveWorkSummary(text)) {
      const started = Date.now();
      if (!this.deps.workSummary) {
        unavailable.push({ system: 'work-summary', reason: 'work-summary port not wired' });
      } else {
        try {
          structured = this.deps.workSummary(now);
          narrativePrompt = 'brief.executive-summary';
          this.toolCall(toolCalls, correlationId, started, {
            tool: 'brief',
            label: 'Compose work summary',
            purpose: 'Aggregate today’s completed work, meetings, AI assistance, and open risks.',
            reason: 'Descriptive overview of existing operational metrics — nothing is scored or invented.',
            expectedOutput: 'A sectioned daily work summary.',
            outcome: 'ok',
            detail: `${structured.sections.length} section(s)`,
          });
        } catch (err) {
          unavailable.push({ system: 'work-summary', reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return { findings, assumptions, unavailable, structured, narrativePrompt };
    }

    const briefPeriod = resolveBriefRequest(text);
    if (briefPeriod) {
      const started = Date.now();
      if (!this.deps.briefing) {
        unavailable.push({ system: 'briefing', reason: 'briefing port not wired' });
      } else {
        try {
          structured = this.deps.briefing(briefPeriod, now);
          narrativePrompt = 'brief.executive-summary';
          this.toolCall(toolCalls, correlationId, started, {
            tool: 'brief',
            label: `Generate ${briefPeriod} brief`,
            purpose: 'Compute the deterministic daily-intelligence brief for the requested period.',
            reason: 'Brief requests resolve to the EXISTING briefing generator — same facts as the delivered brief.',
            expectedOutput: 'Sectioned brief from real workspace data.',
            outcome: 'ok',
            detail: `${structured.sections.length} section(s)`,
          });
        } catch (err) {
          unavailable.push({ system: 'briefing', reason: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return { findings, assumptions, unavailable, structured, narrativePrompt };
  }

  /** D-3: execute one parsed task command through the memory-store lens. */
  private runTaskCommand(
    cmd: NonNullable<ReturnType<typeof parseTaskCommand>>,
    conversationId: string,
    correlationId: string,
    now: string,
    toolCalls: AssistantToolCall[],
    findings: AssistantFinding[],
    assumptions: string[],
    unavailable: AssistantUnavailable[],
  ): void {
    if (cmd.action === 'delegate') {
      findings.push({
        label: 'Delegation',
        text: `Delegation prepared${cmd.title ? ` for “${cmd.title}”` : ''} — approve the worker step to dispatch it.`,
        at: null,
        connectorId: null,
        evidence: [],
      });
      return; // the plan's gated worker step (built by buildPlan) carries the dispatch
    }
    if (!this.deps.tasks) {
      unavailable.push({ system: 'tasks', reason: 'task port not wired' });
      return;
    }
    const started = Date.now();
    try {
      if (cmd.action === 'create') {
        const created = this.deps.tasks.create({
          title: cmd.title as string,
          due: cmd.due,
          priority: cmd.priority,
          conversationId,
          correlationId,
          now,
        });
        this.toolCall(toolCalls, correlationId, started, {
          tool: 'task',
          label: `Create task “${created.title}”`,
          purpose: 'Record the task in the workspace memory store (kind: task).',
          reason: 'Local workspace data write — auto-run, screened, audited, correlation-tagged.',
          expectedOutput: 'A durable task visible in the Work Hub.',
          outcome: 'ok',
          detail: `${created.id}${cmd.due ? ` · due ${cmd.due}` : ''}${cmd.priority === 'high' ? ' · high priority' : ''}`,
        });
        findings.push({
          label: 'Task created',
          text: `“${created.title}”${cmd.due ? ` — due ${cmd.due.slice(0, 16).replace('T', ' ')}` : ''}${cmd.priority === 'high' ? ' (high priority)' : ''}`,
          at: now,
          connectorId: null,
          evidence: [{ kind: 'memory', id: created.id }],
        });
        if (cmd.remind) {
          if (!cmd.due) {
            assumptions.push(
              'No reminder time could be parsed — the task was created without a reminder (try “in 2 hours” or “tomorrow”).',
            );
          } else if (!this.deps.scheduleReminder) {
            unavailable.push({ system: 'reminders', reason: 'reminder port not wired' });
          } else {
            const r = this.deps.scheduleReminder({ title: created.title, at: cmd.due, correlationId });
            this.toolCall(toolCalls, correlationId, started, {
              tool: 'reminder',
              label: `Schedule reminder for “${created.title}”`,
              purpose: 'Schedule a local reminder through the existing notification scheduler.',
              reason: 'You asked to be reminded; the scheduler is the one notification path.',
              expectedOutput: `A notification at ${cmd.due}.`,
              outcome: 'ok',
              detail: r.id,
            });
            findings.push({
              label: 'Reminder scheduled',
              text: `You'll be notified at ${cmd.due.slice(0, 16).replace('T', ' ')}.`,
              at: now,
              connectorId: null,
              evidence: [],
            });
          }
        }
        return;
      }
      if (cmd.action === 'complete') {
        const open = this.deps.tasks.list().filter((t) => t.status !== 'done');
        const match = open.find((t) => nameMatches(cmd.title as string, t.title) || nameMatches(t.title, cmd.title as string));
        if (!match) {
          this.toolCall(toolCalls, correlationId, started, {
            tool: 'task',
            label: 'Complete task',
            purpose: 'Mark the named task done.',
            reason: 'Completion resolves by name against your open tasks.',
            expectedOutput: 'The task marked done.',
            outcome: 'skipped',
            detail: `No open task matched “${cmd.title}”.`,
          });
          assumptions.push(`No open task matched “${cmd.title}” — nothing was changed.`);
          return;
        }
        const done = this.deps.tasks.complete(match.id, now, correlationId);
        this.toolCall(toolCalls, correlationId, started, {
          tool: 'task',
          label: `Complete task “${match.title}”`,
          purpose: 'Mark the task done in the workspace memory store.',
          reason: 'Local workspace data write — auto-run, audited, correlation-tagged.',
          expectedOutput: 'The task marked done.',
          outcome: done ? 'ok' : 'error',
          detail: done ? match.id : 'The store did not return the updated task.',
        });
        if (done)
          findings.push({
            label: 'Task completed',
            text: `“${match.title}” marked done.`,
            at: now,
            connectorId: null,
            evidence: [{ kind: 'memory', id: match.id }],
          });
        return;
      }
      // list
      const tasks = this.deps.tasks.list();
      const open = tasks.filter((t) => t.status !== 'done');
      this.toolCall(toolCalls, correlationId, started, {
        tool: 'task',
        label: 'List tasks',
        purpose: 'Read your assistant tasks from the memory store.',
        reason: 'Read-only.',
        expectedOutput: 'Your open tasks.',
        outcome: 'ok',
        detail: `${open.length} open / ${tasks.length} total`,
      });
      if (open.length === 0) {
        assumptions.push('You have no open assistant tasks. (Connector tasks live in the Work Hub.)');
      }
      for (const t of open.slice(0, 10)) {
        findings.push({
          label: 'Open task',
          text: `${t.title}${t.due ? ` — due ${t.due.slice(0, 16).replace('T', ' ')}` : ''}${t.priority === 'high' ? ' (high)' : ''}`,
          at: t.createdAt,
          connectorId: null,
          evidence: [{ kind: 'memory', id: t.id }],
        });
      }
    } catch (err) {
      unavailable.push({ system: 'tasks', reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Narrative over a structured report — the report's sections ARE the context. */
  private async reasonOverReport(
    text: string,
    report: AssistantStructuredReport,
    promptId: 'brief.executive-summary' | 'assistant.meeting-brief',
    tier: 'fast' | 'balanced' | 'deep',
    correlationId: string,
  ): Promise<AiEngineResponse> {
    return this.deps.runAi({
      worker: 'assistant',
      promptId,
      context: [
        {
          // The computed report IS deterministic daily-intelligence material —
          // the same provenance class as the Mission Brief context source.
          source: 'mission-brief',
          text: renderReportMaterial(report),
          evidence: [],
        },
      ],
      variables: promptId === 'assistant.meeting-brief' ? { question: text } : {},
      tier,
      correlationId,
    });
  }

  private locateTargets(text: string, intent: AssistantIntentResult): PlanTargets {
    const targets: PlanTargets = {};
    if (intent.intent === 'automation' || intent.intent === 'workflow') {
      try {
        const rules = this.deps.context.automations?.() ?? [];
        targets.automation = rules.find((r) => nameMatches(text, r.name)) ?? null;
      } catch {
        targets.automation = null;
      }
    }
    if (intent.intent === 'execution' || intent.intent === 'connector-action' || intent.intent === 'task') {
      try {
        const workers = this.deps.context.workers?.() ?? [];
        // Phase 6 Stage 5 (D-3): a task DELEGATION locates its worker the same
        // way — by name containment in the request text. Non-delegate task
        // turns simply won't mention a worker, so nothing matches (no step).
        targets.worker = workers.find((w) => nameMatches(text, w.name)) ?? null;
      } catch {
        targets.worker = null;
      }
    }
    if (intent.intent === 'navigation') {
      targets.navigate = resolveNavigation(text);
    }
    if (intent.intent === 'search') {
      targets.searchQuery = text.trim();
    }
    return targets;
  }

  private async reason(
    text: string,
    mode: AssistantMode,
    intent: AssistantIntentResult,
    conversation: AssistantConversation,
    snapshot: AssistantWorkspaceSnapshot,
    findings: AssistantFinding[],
    items: AiContextItem[],
    tier: 'fast' | 'balanced' | 'deep',
    correlationId: string,
  ): Promise<AiEngineResponse> {
    const history = renderHistory(
      conversation.messages.map((m) => ({ role: m.role, text: m.text })),
    );
    return this.deps.runAi({
      worker: 'assistant',
      promptId: 'assistant.workspace',
      context: items,
      variables: {
        mode,
        intent: intent.intent,
        question: text,
        findings: findings.length
          ? findings.map((f) => `- [${f.label}] ${f.text}`).join('\n')
          : '(no deterministic findings)',
        history,
        workspace: renderWorkspaceSnapshot(snapshot),
      },
      tier,
      correlationId,
    });
  }

  private async draft(
    text: string,
    findings: AssistantFinding[],
    items: AiContextItem[],
    correlationId: string,
    toolCalls: AssistantToolCall[],
  ): Promise<AssistantEnvelope['draft']> {
    const wantsAgenda = /\b(agenda|meeting)\b/i.test(text);
    const promptId = wantsAgenda ? 'm365.draft.agenda' : 'm365.draft.email';
    const material = [
      ...findings.map((f) => `- ${f.text}`),
      ...items.slice(0, 6).map((i) => `- ${i.text}`),
    ].join('\n');
    const started = Date.now();
    const resp = await this.deps.runAi({
      worker: 'assistant',
      promptId,
      variables: { instruction: text, material: material || '(no material)' },
      tier: 'balanced',
      correlationId,
    });
    toolCalls.push({
      id: `tc_${this.newId()}`,
      tool: 'draft',
      label: wantsAgenda ? 'Draft meeting agenda' : 'Draft email body',
      purpose: 'Produce review-only content from the retrieved material.',
      reason: 'Content requests generate drafts; nothing is ever sent by the assistant.',
      expectedOutput: 'A draft for your review.',
      outcome: resp.grounded ? 'ok' : 'skipped',
      detail: resp.grounded ? null : 'AI offline — no draft produced.',
      durationMs: Date.now() - started,
      correlationId,
    });
    const draftText = readStr(resp.data, 'text');
    if (!resp.grounded || !draftText) return null;
    return {
      kind: wantsAgenda ? 'agenda' : 'email',
      text: draftText,
      note: 'Draft only — review before using. The assistant never sends anything.',
    };
  }

  private assembleSources(
    snapshot: AssistantWorkspaceSnapshot,
    items: AiContextItem[],
    recalledCount: number,
  ): AssistantSourceRef[] {
    const sources: AssistantSourceRef[] = [];
    const bySource = new Map<string, number>();
    for (const it of items) bySource.set(it.source, (bySource.get(it.source) ?? 0) + 1);
    for (const [id, count] of bySource) {
      sources.push({ id, label: id, kind: id === 'mission-brief' ? 'briefing' : 'index', count });
    }
    if (recalledCount > 0)
      sources.push({ id: 'executive-memory', label: 'Executive memory', kind: 'memory', count: recalledCount });
    if (snapshot.unavailable.length < 7)
      sources.push({ id: 'workspace-snapshot', label: 'Workspace snapshot', kind: 'operational', count: null });
    if (snapshot.uiContext)
      sources.push({ id: 'ui-context', label: 'Current screen', kind: 'ui', count: null });
    return sources;
  }

  private assembleAssumptions(
    intent: AssistantIntentResult,
    mode: AssistantMode,
    targets: PlanTargets,
    snapshot: AssistantWorkspaceSnapshot,
  ): string[] {
    const assumptions: string[] = [];
    if ((intent.intent === 'automation' || intent.intent === 'workflow') && !targets.automation) {
      assumptions.push('No saved automation matched the request by name — nothing was selected to run.');
    }
    if ((intent.intent === 'execution' || intent.intent === 'connector-action') && !targets.worker) {
      assumptions.push('No AI worker matched the request by name — nothing was selected to run.');
    }
    if (/\b(me|my|mine)\b/i.test(intent.matched.join(' '))) {
      // conservative: only when a matched signal carried a personal pronoun
      assumptions.push('“me/my” is not yet resolved to your account — results are not person-filtered.');
    }
    if (snapshot.unavailable.length > 0) {
      assumptions.push(
        `${snapshot.unavailable.length} context source(s) were unavailable — the answer does not include them.`,
      );
    }
    if (!MODE_CONFIG[mode].allowSideEffects && (intent.intent === 'automation' || intent.intent === 'workflow' || intent.intent === 'execution' || intent.intent === 'connector-action')) {
      assumptions.push(`${mode.charAt(0).toUpperCase() + mode.slice(1)} mode offers no actions — switch to Execute mode to run things.`);
    }
    return assumptions;
  }

  private monitorText(s: AssistantWorkspaceSnapshot): string {
    const bits: string[] = [];
    bits.push(`${s.activeExecutions ?? 0} active execution(s)`);
    if (s.pendingApprovals !== null) bits.push(`${s.pendingApprovals} pending approval(s)`);
    if (s.connectors) bits.push(`${s.connectors.connected}/${s.connectors.total} connectors connected${s.connectors.problems.length > 0 ? ` (${s.connectors.problems.length} with problems)` : ''}`);
    if (s.automations) bits.push(`${s.automations.active} active automation(s)`);
    return `Operational snapshot: ${bits.join(' · ')}.`;
  }

  private async finishCancelled(
    conversation: AssistantConversation,
    text: string,
    correlationId: string,
    mode: AssistantMode,
    intent: AssistantIntentResult,
    now: string,
    phases: AssistantPhaseTiming[],
    publish: (type: string, metadata: Record<string, string | number | boolean | null>) => void,
    emitPhase: (phase: AssistantEvent['phase']) => void,
  ): Promise<AssistantAskResult> {
    const envelope = baseEnvelope(correlationId, mode, intent, now, {
      clarification: 'Stopped — this turn was interrupted before it completed.',
    });
    envelope.trace.phases = phases;
    const messageId = this.appendTurn(conversation, text, [], envelope, now);
    publish('assistant.turn.interrupted', { conversationId: conversation.id });
    emitPhase('done');
    this.inflight.delete(conversation.id);
    await this.deps.store.upsert(conversation);
    return { conversation, messageId };
  }
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */

const NAV_TARGETS: { re: RegExp; section: string }[] = [
  { re: /\bmission control\b/, section: 'mission-control' },
  { re: /\bsearch\b/, section: 'search' },
  { re: /\bmemory\b/, section: 'memory' },
  { re: /\bconnectors?|connections\b/, section: 'connections' },
  { re: /\btimeline|ops ?center\b/, section: 'opscenter' },
  { re: /\borganization\b/, section: 'organization' },
  { re: /\bworkspaces?\b/, section: 'workspace' },
  { re: /\bstore|apps\b/, section: 'store' },
  { re: /\bsettings\b/, section: 'settings' },
];

export function resolveNavigation(text: string): { section: string; query: string | null } | null {
  const t = text.toLowerCase();
  for (const target of NAV_TARGETS) {
    if (target.re.test(t)) return { section: target.section, query: null };
  }
  return null;
}

function readStr(data: Record<string, unknown> | null, key: string): string | null {
  if (!data) return null;
  const v = data[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function readStrArray(data: Record<string, unknown> | null, key: string): string[] {
  if (!data) return [];
  const v = data[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}
