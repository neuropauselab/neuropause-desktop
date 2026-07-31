/**
 * Workspace Assistant — the PURE model (Phase 6 Stage 4).
 *
 * Deterministic pieces only, mirroring the Founder AI v2 doctrine at workspace
 * scale: (1) a weighted-rule intent classifier over the eleven request classes,
 * with a confidence floor below which the assistant asks for clarification
 * instead of guessing; (2) the five mode configurations — one pipeline, five
 * deterministic parameterizations, never separate assistants; (3) plan
 * construction — per-intent templates whose steps declare purpose / reason /
 * expected output and whose side-effecting steps are structurally
 * approval-gated; (4) envelope scaffolding helpers. No LLM anywhere in this
 * file; no I/O; unit-tests electron-free.
 */
import type {
  AssistantEnvelope,
  AssistantIntentId,
  AssistantIntentResult,
  AssistantMode,
  AssistantPlan,
  AssistantPlanStep,
  AssistantTrace,
  AssistantWorkspaceSnapshot,
} from '@neuropause/shared';

/* ── Intent classification ─────────────────────────────────────────────────── */

interface IntentRule {
  intent: AssistantIntentId;
  /** Contribution when matched (strong 0.6 / medium 0.4 / weak 0.25). */
  weight: number;
  re: RegExp;
  signal: string;
}

/**
 * Ordered, weighted signals. Deliberately conservative: action intents
 * (automation/execution/workflow/connector-action) need explicit action
 * language; analysis/questions win otherwise. Unknown phrasing → 'unclear'.
 */
const INTENT_RULES: IntentRule[] = [
  // workflow / automation launching
  {
    intent: 'workflow',
    weight: 0.6,
    re: /\b(launch|start|kick ?off|trigger|begin)\b.{0,40}\b(workflow|onboarding|pipeline|playbook)\b/,
    signal: 'launch workflow',
  },
  { intent: 'workflow', weight: 0.4, re: /\bworkflows?\b/, signal: 'workflow' },
  {
    intent: 'automation',
    weight: 0.6,
    re: /\b(run|launch|start|trigger|execute|fire)\b.{0,40}\b(automation|rule)\b/,
    signal: 'run automation',
  },
  { intent: 'automation', weight: 0.4, re: /\bautomations?\b/, signal: 'automation' },
  // generic execution
  {
    intent: 'execution',
    weight: 0.6,
    re: /\b(run|execute|dispatch)\b.{0,40}\b(worker|job|skill|agent)\b/,
    signal: 'run worker',
  },
  {
    intent: 'execution',
    weight: 0.4,
    re: /\b(do it|go ahead and run|carry (this|it) out)\b/,
    signal: 'carry out',
  },
  // connector action
  {
    intent: 'connector-action',
    weight: 0.6,
    re: /\b(send|create|update|post|sync)\b.{0,40}\b(email|mail|calendar (event|invite)|teams message|slack message|connector)\b/,
    signal: 'connector action',
  },
  {
    intent: 'connector-action',
    weight: 0.4,
    re: /\bconnectors?\b.{0,30}\b(problem|failing|failure|broken|error)s?\b/,
    signal: 'connector problems',
  },
  // search
  {
    intent: 'search',
    weight: 0.6,
    re: /\b(find|locate|search( for)?|look for|where is|show me every|list all)\b/,
    signal: 'find',
  },
  { intent: 'search', weight: 0.25, re: /\bshow me\b/, signal: 'show me' },
  // analysis
  {
    intent: 'analysis',
    weight: 0.6,
    re: /\b(analy[sz]e|explain why|root cause|why (did|is|are|has|have)|diagnose|investigate|break down)\b/,
    signal: 'analyze',
  },
  {
    intent: 'analysis',
    weight: 0.4,
    re: /\b(summari[sz]e|sum up|recap|what happened (today|yesterday|this week))\b/,
    signal: 'summarize',
  },
  // planning
  {
    intent: 'planning',
    weight: 0.6,
    re: /\b(prepare|plan|draft a plan|organi[sz]e|schedule out|get ready for)\b.{0,50}\b(meeting|week|launch|review|briefing|quarter|tomorrow)\b/,
    signal: 'prepare/plan',
  },
  { intent: 'planning', weight: 0.4, re: /\bwhat should (i|we) (do|work on|focus on)\b/, signal: 'what to do' },
  // content creation
  {
    intent: 'content-creation',
    weight: 0.6,
    re: /\b(draft|write|compose|create)\b.{0,40}\b(email|reply|response|message|agenda|briefing|summary|report|memo)\b/,
    signal: 'draft content',
  },
  // decision support
  {
    intent: 'decision-support',
    weight: 0.6,
    re: /\b(should (i|we)|decide|decision|approve or reject|trade[- ]?offs?|recommend(ation)? (on|for))\b/,
    signal: 'decision support',
  },
  {
    intent: 'decision-support',
    weight: 0.4,
    re: /\b(pending approvals?|awaiting (my )?(approval|decision))\b/,
    signal: 'approvals',
  },
  // navigation
  {
    intent: 'navigation',
    weight: 0.6,
    re: /\b(open|go to|take me to|navigate to|switch to)\b.{0,40}\b(mission control|search|memory|settings|connectors?|workspace|timeline|organization|automation center|store|section)\b/,
    signal: 'navigate',
  },
  // question (weak catch-alls — only win when nothing stronger fires)
  {
    intent: 'question',
    weight: 0.4,
    // ^\s* because the classifier pads the text with a leading space.
    re: /^\s*(what|who|when|which|how (?:many|much)|is|are|does|do|did|can|has|have)\b/,
    signal: 'question form',
  },
  { intent: 'question', weight: 0.25, re: /\?\s*$/, signal: 'question mark' },
];

/** Below this the request is ambiguous → clarification, no retrieval, no model. */
export const ASSISTANT_CONFIDENCE_FLOOR = 0.34;

export function classifyAssistantIntent(text: string): AssistantIntentResult {
  const t = ` ${text.toLowerCase().trim()} `;
  const scores = new Map<AssistantIntentId, number>();
  const matched = new Map<AssistantIntentId, string[]>();
  for (const rule of INTENT_RULES) {
    if (!rule.re.test(t)) continue;
    scores.set(rule.intent, Math.min(1, (scores.get(rule.intent) ?? 0) + rule.weight));
    const list = matched.get(rule.intent) ?? [];
    list.push(rule.signal);
    matched.set(rule.intent, list);
  }
  let winner: AssistantIntentId = 'unclear';
  let best = 0;
  for (const [intent, score] of scores) {
    if (score > best) {
      best = score;
      winner = intent;
    }
  }
  if (best === 0) return { intent: 'unclear', confidence: 0, matched: [] };
  return { intent: winner, confidence: best, matched: matched.get(winner) ?? [] };
}

/* ── Modes — one pipeline, five deterministic configurations ───────────────── */

export interface AssistantModeConfig {
  /** Retrieval budget handed to the existing Context Builder. */
  retrieval: { maxItems: number; maxChars: number; perSourceLimit: number } | null;
  /** Whether the AI Engine narrative runs at all. */
  reason: boolean;
  /** Whether side-effecting plan steps may be offered (they still need approval). */
  allowSideEffects: boolean;
  /** Whether approved steps may actually dispatch (Plan mode builds but never runs). */
  dispatchOnApproval: boolean;
  /** Monitor: deterministic operational snapshot instead of reasoning. */
  operational: boolean;
  tier: 'fast' | 'balanced' | 'deep';
}

export const MODE_CONFIG: Record<AssistantMode, AssistantModeConfig> = {
  ask: {
    retrieval: { maxItems: 8, maxChars: 4000, perSourceLimit: 6 },
    reason: true,
    allowSideEffects: false,
    dispatchOnApproval: false,
    operational: false,
    tier: 'balanced',
  },
  analyze: {
    retrieval: { maxItems: 16, maxChars: 9000, perSourceLimit: 10 },
    reason: true,
    allowSideEffects: false,
    dispatchOnApproval: false,
    operational: false,
    tier: 'deep',
  },
  plan: {
    retrieval: { maxItems: 10, maxChars: 5000, perSourceLimit: 8 },
    reason: true,
    allowSideEffects: true,
    dispatchOnApproval: false,
    operational: false,
    tier: 'balanced',
  },
  execute: {
    retrieval: { maxItems: 10, maxChars: 5000, perSourceLimit: 8 },
    reason: true,
    allowSideEffects: true,
    dispatchOnApproval: true,
    operational: false,
    tier: 'balanced',
  },
  monitor: {
    retrieval: null,
    reason: false,
    allowSideEffects: false,
    dispatchOnApproval: false,
    operational: true,
    tier: 'fast',
  },
};

/* ── Retrieval phrasing per intent (mirrors the founder pattern) ───────────── */

export const INTENT_QUERIES: Record<AssistantIntentId, string> = {
  question: 'status overview priorities activity',
  search: 'find locate documents records items',
  analysis: 'root cause changes failures risk recent activity metrics',
  planning: 'upcoming meetings deadlines priorities blockers preparation',
  automation: 'automation rules runs history triggers',
  execution: 'workers jobs skills execution history',
  'decision-support': 'pending decisions approvals options risk impact',
  'content-creation': 'related documents messages history material',
  navigation: 'sections apps workspaces',
  'connector-action': 'connectors accounts sync status failures actions',
  workflow: 'workflows automation rules onboarding steps runs',
  unclear: 'status overview priorities',
};

/* ── Plan construction ─────────────────────────────────────────────────────── */

export interface PlanTargets {
  /** A located automation rule (id + name) for automation/workflow intents. */
  automation?: { id: string; name: string; actionCount: number; active: boolean } | null;
  /** A located worker (id + name + role) for execution/connector-action intents. */
  worker?: { id: string; name: string; role: string } | null;
  /** Navigation resolution for navigation intents. */
  navigate?: { section: string; query: string | null } | null;
  /** Search hand-off query. */
  searchQuery?: string | null;
}

let stepSeq = 0;
const stepId = (): string => `st_${(stepSeq++).toString(36)}`;

/** Reset the step counter (deterministic tests). */
export function resetPlanStepIds(): void {
  stepSeq = 0;
}

function step(partial: Omit<AssistantPlanStep, 'id' | 'state' | 'executionId' | 'resultSummary' | 'verification' | 'error' | 'decidedBy' | 'decidedAt'> & { state?: AssistantPlanStep['state']; note?: string | null }): AssistantPlanStep {
  return {
    id: stepId(),
    state: partial.state ?? 'pending',
    executionId: null,
    resultSummary: null,
    verification: null,
    error: null,
    decidedBy: null,
    decidedAt: null,
    ...partial,
    note: partial.note ?? null,
  };
}

const NO_ROLLBACK = 'No automatic rollback — review the target before approving.';

/**
 * Build the deterministic plan for an intent under a mode. Returns null when
 * the intent has no actionable steps (pure Q&A). Side-effecting steps are
 * ALWAYS `needsApproval: true`; in modes that disallow side effects they are
 * included as `skipped` with an explicit note, so nothing is hidden.
 */
export function buildPlan(
  intent: AssistantIntentId,
  mode: AssistantMode,
  correlationId: string,
  targets: PlanTargets,
  now: string,
): AssistantPlan | null {
  const cfg = MODE_CONFIG[mode];
  const steps: AssistantPlanStep[] = [];

  const gatedState = (): { state: AssistantPlanStep['state']; note: string | null } =>
    cfg.allowSideEffects
      ? { state: 'waiting', note: null }
      : {
          state: 'skipped',
          note: `Side-effecting steps are disabled in ${mode.charAt(0).toUpperCase() + mode.slice(1)} mode — switch to Execute mode to run this.`,
        };

  if ((intent === 'automation' || intent === 'workflow') && targets.automation) {
    const a = targets.automation;
    const gate = gatedState();
    steps.push(
      step({
        tool: 'automation',
        label: `Run automation “${a.name}”`,
        purpose: `Execute the saved automation rule ${a.name} (${a.actionCount} action${a.actionCount === 1 ? '' : 's'}).`,
        reason: 'You asked to launch it; it matches the request by name.',
        expectedOutput: 'An ExecuteEngine session with a per-action run record.',
        needsApproval: true,
        sideEffects: true,
        risk: 'high',
        rollback: NO_ROLLBACK,
        executionKind: 'automation',
        targetId: a.id,
        input: null,
        state: gate.state,
        note: a.active ? gate.note : 'This rule is inactive — activate it in the Automation Center first.',
      }),
    );
    if (!a.active) steps[steps.length - 1].state = 'skipped';
  }

  if ((intent === 'execution' || intent === 'connector-action') && targets.worker) {
    const w = targets.worker;
    const gate = gatedState();
    steps.push(
      step({
        tool: 'worker',
        label: `Run AI worker “${w.name}”`,
        purpose: `Dispatch ${w.name} (${w.role}) through the workforce runtime.`,
        reason: 'The request maps to this worker; its own governance still gates any proposal it makes.',
        expectedOutput:
          'A workforce job — read-only findings, and any side-effecting proposal parks in the Approval Center.',
        needsApproval: true,
        sideEffects: true,
        risk: 'high',
        rollback: NO_ROLLBACK,
        executionKind: 'worker',
        targetId: w.id,
        input: null,
        state: gate.state,
        note: gate.note,
      }),
    );
  }

  if (intent === 'navigation' && targets.navigate) {
    steps.push(
      step({
        tool: 'navigate',
        label: `Open ${targets.navigate.section}`,
        purpose: 'Take you to the requested surface.',
        reason: 'Navigation resolves through the existing shell — nothing else runs.',
        expectedOutput: 'The section opens.',
        needsApproval: false,
        sideEffects: false,
        risk: 'low',
        rollback: 'Not applicable (navigation only).',
        executionKind: null,
        targetId: targets.navigate.section,
        input: targets.navigate.query,
        state: 'completed',
        note: null,
      }),
    );
  }

  if (intent === 'search' && targets.searchQuery) {
    steps.push(
      step({
        tool: 'search',
        label: 'Open in Universal Search',
        purpose: 'Run the full query across every index with the Stage 3 pipeline.',
        reason: 'Search-shaped requests get the complete streaming experience there.',
        expectedOutput: 'Grouped, explainable results in the Search section.',
        needsApproval: false,
        sideEffects: false,
        risk: 'low',
        rollback: 'Not applicable (read-only).',
        executionKind: null,
        targetId: 'search',
        input: targets.searchQuery,
        state: 'completed',
        note: null,
      }),
    );
  }

  if (steps.length === 0) return null;
  const anyWaiting = steps.some((s) => s.state === 'waiting');
  return {
    id: `plan_${correlationId}`,
    correlationId,
    intent,
    mode,
    state: anyWaiting ? 'waiting' : 'ready',
    steps,
    createdAt: now,
    updatedAt: now,
  };
}

/** Recompute a plan's aggregate state from its steps. Pure. */
export function planStateFrom(steps: AssistantPlanStep[]): AssistantPlan['state'] {
  if (steps.some((s) => s.state === 'running')) return 'running';
  if (steps.some((s) => s.state === 'waiting')) return 'waiting';
  if (steps.some((s) => s.state === 'failed')) return 'failed';
  if (steps.some((s) => s.state === 'cancelled')) return 'cancelled';
  return 'completed';
}

/* ── Envelope scaffolding ──────────────────────────────────────────────────── */

export function emptyWorkspaceSnapshot(): AssistantWorkspaceSnapshot {
  return {
    workspace: null,
    workspaceCount: null,
    activeExecutions: null,
    pendingApprovals: null,
    connectors: null,
    automations: null,
    recentTimeline: [],
    memoryTotal: null,
    uiContext: null,
    unavailable: [],
  };
}

export function emptyTrace(
  correlationId: string,
  mode: AssistantMode,
  intent: AssistantIntentResult,
  now: string,
): AssistantTrace {
  return {
    correlationId,
    mode,
    intent,
    phases: [],
    workspace: emptyWorkspaceSnapshot(),
    retrieved: [],
    recalledMemories: 0,
    reasoning: null,
    toolCalls: [],
    audit: {
      permissionClass: 'local (sender-trust)',
      aiResponseId: null,
      executionIds: [],
      timelineEventTypes: [],
    },
    generatedAt: now,
  };
}

export function baseEnvelope(
  correlationId: string,
  mode: AssistantMode,
  intent: AssistantIntentResult,
  now: string,
  overrides: Partial<AssistantEnvelope> = {},
): AssistantEnvelope {
  return {
    correlationId,
    mode,
    intent,
    clarification: null,
    text: null,
    findings: [],
    recommendations: [],
    draft: null,
    navigation: null,
    plan: null,
    sources: [],
    toolCalls: [],
    confidence: 0,
    grounded: false,
    aiOffline: true,
    unavailable: [],
    assumptions: [],
    reasoningSummary: null,
    trace: emptyTrace(correlationId, mode, intent, now),
    memoryCapture: null,
    generatedAt: now,
    ...overrides,
  };
}

/** Human title for a new conversation, from its first user message. Pure. */
export function conversationTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length === 0) return 'New conversation';
  return t.length > 64 ? `${t.slice(0, 61)}…` : t;
}

/**
 * Fuzzy name match used to locate an automation rule / worker from free text.
 * Deterministic and conservative: every significant token of the candidate name
 * must appear in the request (so "launch the onboarding workflow" matches a
 * rule named "Onboarding"). Pure.
 */
export function nameMatches(requestText: string, candidateName: string): boolean {
  const req = ` ${requestText.toLowerCase()} `;
  const tokens = candidateName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.every((w) => req.includes(w));
}

/** Compact recent turns for the {{history}} prompt variable. Pure. */
export function renderHistory(
  turns: { role: 'user' | 'assistant'; text: string }[],
  maxTurns = 4,
  maxChars = 900,
): string {
  const recent = turns.slice(-maxTurns);
  if (recent.length === 0) return '(no prior turns)';
  let out = recent
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  if (out.length > maxChars) out = `…${out.slice(-maxChars)}`;
  return out;
}

/** Render the deterministic workspace snapshot for the {{workspace}} variable. Pure. */
export function renderWorkspaceSnapshot(s: AssistantWorkspaceSnapshot): string {
  const lines: string[] = [];
  if (s.workspace) lines.push(`Active workspace: ${s.workspace.name}`);
  if (s.workspaceCount !== null) lines.push(`Workspaces: ${s.workspaceCount}`);
  if (s.activeExecutions !== null) lines.push(`Active executions: ${s.activeExecutions}`);
  if (s.pendingApprovals !== null) lines.push(`Proposals awaiting approval: ${s.pendingApprovals}`);
  if (s.connectors) {
    lines.push(`Connectors: ${s.connectors.connected}/${s.connectors.total} connected`);
    for (const p of s.connectors.problems.slice(0, 5)) lines.push(`Connector problem — ${p.id}: ${p.reason}`);
  }
  if (s.automations) lines.push(`Automations: ${s.automations.active} active of ${s.automations.total}`);
  if (s.memoryTotal !== null) lines.push(`AI memories: ${s.memoryTotal}`);
  for (const t of s.recentTimeline.slice(0, 6)) lines.push(`Recent: [${t.kind}] ${t.title}`);
  if (s.uiContext?.section) lines.push(`User is currently on: ${s.uiContext.section}`);
  for (const u of s.unavailable) lines.push(`Unavailable — ${u.system}: ${u.reason}`);
  return lines.length > 0 ? lines.join('\n') : '(no workspace signals available)';
}
