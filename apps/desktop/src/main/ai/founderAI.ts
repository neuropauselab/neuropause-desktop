/**
 * Founder AI v2 — the executive intelligence service behind the Founder tab.
 *
 * It is not a chatbot. The flow is: deterministically classify the founder's
 * question into an intent; if nothing matches confidently, ask for clarification
 * (no model call, no guessing). Otherwise gather deterministic KEY FINDINGS for
 * that intent and assemble supporting CONTEXT via the Context Builder, run the AI
 * Engine for the executive narrative (Executive Summary / Business Impact /
 * Recommendations), then run a governance gate before the answer is shown. When no
 * model is reachable (or a call errors) the engine's fallback yields grounded:false,
 * so the narrative fields are null/empty and `aiOffline` is set — the deterministic
 * findings still render. If there is no evidence at all, it says so plainly rather
 * than inventing an answer. Pure: every dependency is injected, so it unit-tests
 * electron-free.
 */
import type {
  AiContextItem,
  AiContextSource,
  AiEngineRequest,
  AiEngineResponse,
  Briefing,
  FounderFinding,
  FounderIntentResult,
  FounderIntentV2,
  FounderMemoryCapture,
  FounderResponse,
  FounderTimelineRef,
  GovernanceView,
  MemoryCaptureResult,
} from '@neuropause/shared';
import type { ContextRequest } from './contextBuilder';
import {
  captureFounderMemory,
  recallForAnswer,
  type ConversationMemoryDeps,
} from './conversationMemory';

export interface FounderAskRequestV2 {
  text: string;
  now?: string;
  /** Server-generated id grouping the exchange, stored as the memory's source. */
  conversationId?: string;
}

export interface FounderGovernanceInput {
  grounded: boolean;
  recommendations: string[];
  sourceSystems: AiContextSource[];
}

export interface FounderAIDeps {
  buildContext: (req: ContextRequest) => AiContextItem[];
  run: (req: AiEngineRequest) => Promise<AiEngineResponse>;
  /** Deterministic key findings for the classified intent (from the briefing, etc.). */
  deterministicFindings: (intent: FounderIntentV2) => FounderFinding[];
  /** Governance gate run before display; defaults to the read-only gate below. */
  governance?: (input: FounderGovernanceInput) => GovernanceView;
  /** Executive conversation memory (recall to ground, capture after). Omit to disable. */
  memory?: ConversationMemoryDeps;
  now?: () => string;
}

/* ── intent classification ───────────────────────────────────────────────── */

interface IntentRule {
  intent: FounderIntentV2;
  /** Contribution to the intent's score when matched (strong 0.6 / medium 0.4 / weak 0.25). */
  weight: number;
  re: RegExp;
  /** Human label for the matched signal. */
  signal: string;
}

const INTENT_RULES: IntentRule[] = [
  // morning brief
  {
    intent: 'morning-brief',
    weight: 0.6,
    re: /\b(morning brief|brief me|catch me up|start (my|the) day)\b/,
    signal: 'morning brief',
  },
  {
    intent: 'morning-brief',
    weight: 0.4,
    re: /\bwhat should i (work on|do|focus on)\b/,
    signal: 'what to work on',
  },
  {
    intent: 'morning-brief',
    weight: 0.25,
    re: /\b(overview|where (do|does) things stand|summari[sz]e (today|my day))\b/,
    signal: 'overview',
  },
  // release status
  {
    intent: 'release-status',
    weight: 0.6,
    re: /\b(release|rc\s?1|rc1|v?1\.0|version 1|ship(ping)?|launch)\b/,
    signal: 'release',
  },
  {
    intent: 'release-status',
    weight: 0.4,
    re: /\bwhat('?s| is) blocking\b/,
    signal: 'what is blocking',
  },
  // engineering
  {
    intent: 'engineering',
    weight: 0.6,
    re: /\b(engineering|ci|build fail(ed|ing|ure)|pull request|\bpr\b|repo(sitory)?|deploy(ment)?|merge)\b/,
    signal: 'engineering',
  },
  {
    intent: 'engineering',
    weight: 0.4,
    re: /\b(tests? (are )?failing|code health|what did engineering ai)\b/,
    signal: 'engineering health',
  },
  // projects
  { intent: 'projects', weight: 0.6, re: /\b(project|projects)\b/, signal: 'projects' },
  {
    intent: 'projects',
    weight: 0.4,
    re: /\b(unhealthy|stalled|at risk|behind schedule)\b/,
    signal: 'unhealthy',
  },
  // approvals
  {
    intent: 'approvals',
    weight: 0.6,
    re: /\b(approv(e|al|als)|sign[- ]?off|awaiting (my )?(approval|decision))\b/,
    signal: 'approvals',
  },
  {
    intent: 'approvals',
    weight: 0.4,
    re: /\bdecisions? (that )?(require|need)\b/,
    signal: 'decisions require',
  },
  // timeline / what changed
  {
    intent: 'timeline',
    weight: 0.6,
    re: /\b(what changed|overnight|last night|since (yesterday|last)|what happened)\b/,
    signal: 'what changed',
  },
  {
    intent: 'timeline',
    weight: 0.4,
    re: /\b(yesterday|this week|recently|past (day|week))\b/,
    signal: 'recent window',
  },
  // search
  {
    intent: 'search',
    weight: 0.6,
    re: /\b(find|locate|search for|look for|where is)\b/,
    signal: 'find',
  },
  { intent: 'search', weight: 0.25, re: /\bshow me\b/, signal: 'show me' },
  // knowledge
  {
    intent: 'knowledge',
    weight: 0.6,
    re: /\b(related to|connected to|depend(s|ency) on|relationship between|what do we know about)\b/,
    signal: 'knowledge graph',
  },
  // business risk
  {
    intent: 'business-risk',
    weight: 0.6,
    re: /\b(business risk|biggest risk|exposure|what could go wrong)\b/,
    signal: 'business risk',
  },
  { intent: 'business-risk', weight: 0.4, re: /\b(risk|threat|concern)\b/, signal: 'risk' },
  // ai workers
  {
    intent: 'ai-workers',
    weight: 0.6,
    re: /\b(ai workers?|which workers?|worker status|agents?)\b/,
    signal: 'ai workers',
  },
  {
    intent: 'ai-workers',
    weight: 0.4,
    re: /\bworkers? (need|needs|that need) attention\b/,
    signal: 'workers need attention',
  },
  // enterprise health
  {
    intent: 'enterprise-health',
    weight: 0.6,
    re: /\b(enterprise health|org(ani[sz]ation)? health|overall health|system health)\b/,
    signal: 'enterprise health',
  },
  { intent: 'enterprise-health', weight: 0.4, re: /\bhow healthy\b/, signal: 'how healthy' },
  // general
  {
    intent: 'general',
    weight: 0.25,
    re: /\b(tell me everything|general (overview|summary)|anything (i|we) should know)\b/,
    signal: 'general',
  },
];

/** Deterministically classify an executive question. Highest-scoring intent wins. */
export function classifyFounderIntent(text: string): FounderIntentResult {
  const t = ` ${text.toLowerCase()} `;
  const scores = new Map<FounderIntentV2, number>();
  const matched = new Map<FounderIntentV2, string[]>();

  for (const rule of INTENT_RULES) {
    if (!rule.re.test(t)) continue;
    scores.set(rule.intent, Math.min(1, (scores.get(rule.intent) ?? 0) + rule.weight));
    const list = matched.get(rule.intent) ?? [];
    list.push(rule.signal);
    matched.set(rule.intent, list);
  }

  let winner: FounderIntentV2 = 'unclear';
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

/** Below this, the question is treated as ambiguous and clarification is requested. */
export const FOUNDER_CONFIDENCE_FLOOR = 0.34;

/* ── governance ──────────────────────────────────────────────────────────── */

/** Verbs whose presence in a recommendation implies an external, side-effecting action. */
const ACTION_VERBS = [
  'approve',
  'merge',
  'deploy',
  'release',
  'send',
  'email',
  'delete',
  'revert',
  'rollback',
  'roll back',
  'disable',
  'pay',
  'purchase',
  'sign',
  'hire',
  'terminate',
  'publish',
  'push',
];

export function founderRequiresApproval(recommendations: string[]): boolean {
  return recommendations.some((r) => {
    const a = r.toLowerCase();
    return ACTION_VERBS.some((v) => a.includes(v));
  });
}

/**
 * Default governance gate. Founder AI output is read-only executive analysis —
 * nothing is executed — so display is always allowed; but if a recommendation
 * implies an external action, that is flagged as advisory-only and requiring
 * explicit human approval before anything is performed.
 */
export function defaultFounderGovernance(input: FounderGovernanceInput): GovernanceView {
  const requiresApproval = founderRequiresApproval(input.recommendations);
  const reasoning = !input.grounded
    ? 'No model was reachable; showing deterministic findings only. No external action is performed.'
    : requiresApproval
      ? 'Read-only executive analysis. A recommendation implies an external action, which is advisory only and requires explicit human approval before anything is performed.'
      : 'Read-only executive analysis. No external action is performed; recommendations are advisory.';
  return { decision: 'allow', requiresApproval, reasoning, sourceSystems: input.sourceSystems };
}

/* ── retrieval phrasing per intent ───────────────────────────────────────── */

const INTENT_QUERIES: Record<FounderIntentV2, string> = {
  'morning-brief': 'today priorities blockers risks recent activity status',
  'release-status': 'release status blockers CI pull requests milestones readiness',
  engineering: 'engineering health CI failures pull requests releases risk',
  projects: 'project health status blocked stalled at risk',
  approvals: 'pending approvals decisions awaiting sign-off proposals',
  timeline: 'recent changes activity events overnight yesterday this week',
  search: 'find locate documents projects items',
  knowledge: 'relationships dependencies connected entities knowledge graph',
  'business-risk': 'business risk exposure threats blockers critical',
  'ai-workers': 'ai workers status health trust attention proposals',
  'enterprise-health': 'enterprise health organization status overall risk',
  general: 'overview status priorities risks recent activity',
  unclear: 'overview status priorities',
};

/* ── orchestrator ────────────────────────────────────────────────────────── */

export async function answerFounder(
  deps: FounderAIDeps,
  req: FounderAskRequestV2,
): Promise<FounderResponse> {
  const now = (deps.now ?? ((): string => new Date().toISOString()))();
  const result = await answerFounderCore(deps, req, now);

  // Capture the exchange on EVERY path: a decision or preference stated while the
  // AI is asking for clarification is still worth remembering. The classifier
  // itself decides ignore-vs-store, and the governance screen runs before any write.
  if (deps.memory) {
    result.memoryCapture = summarizeCapture(
      captureFounderMemory(deps.memory, {
        question: req.text,
        response: result,
        conversationId: req.conversationId ?? null,
        now,
      }),
    );
  }
  return result;
}

async function answerFounderCore(
  deps: FounderAIDeps,
  req: FounderAskRequestV2,
  now: string,
): Promise<FounderResponse> {
  const cls = classifyFounderIntent(req.text);

  // Low confidence → ask for clarification. No model is called; nothing is invented.
  if (cls.intent === 'unclear' || cls.confidence < FOUNDER_CONFIDENCE_FLOOR) {
    return baseResponse(req.text, cls, now, {
      needsClarification: true,
      clarification:
        "I'm not sure what you're asking. Could you clarify — for example: what's blocking the release, which projects are unhealthy, what changed recently, what needs your approval, or the biggest business risk?",
    });
  }

  const findings = deps.deterministicFindings(cls.intent);
  const context = deps.buildContext({ worker: 'founder', query: INTENT_QUERIES[cls.intent], now });

  // No evidence at all → say so plainly rather than guessing.
  if (findings.length === 0 && context.length === 0) {
    return baseResponse(req.text, cls, now, {
      executiveSummary:
        "I don't have enough evidence to answer confidently. Connect more data or sync a connector, and ask again.",
    });
  }

  // Recall only the memories relevant to this question, to ground the answer
  // (the Context Builder also pulls AI Memory; this is the audited, exec-scoped lens).
  const recalled = deps.memory ? recallForAnswer(deps.memory, { question: req.text, now }) : [];

  const response = await deps.run({
    worker: 'founder',
    promptId: 'founder.executive',
    context,
    variables: { intent: cls.intent, question: req.text, findings: renderFindings(findings) },
    tier: 'balanced',
  });

  const data = response.grounded ? response.data : null;
  const recommendations = readStrArray(data, 'recommendations');
  const governanceFn = deps.governance ?? defaultFounderGovernance;
  const sourceSystems = mergeSourceSystems(response.contextSources, findings);
  const timelineReferences = timelineRefsFromContext(context);

  const result: FounderResponse = {
    question: req.text,
    intent: cls.intent,
    intentConfidence: cls.confidence,
    needsClarification: false,
    clarification: null,
    executiveSummary: readStr(data, 'executiveSummary'),
    keyFindings: findings,
    businessImpact: readStr(data, 'businessImpact'),
    recommendations,
    grounded: response.grounded,
    aiOffline: !response.grounded,
    model: response.model,
    confidence: response.confidence,
    evidence: response.evidence,
    sourceSystems,
    timelineReferences,
    governance: governanceFn({
      grounded: response.grounded,
      recommendations,
      sourceSystems,
    }),
    generatedAt: now,
    recalledMemories: recalled,
    memoryCapture: null,
  };

  return result;
}

/** Compact the full capture result down to what the answer surfaces. */
function summarizeCapture(c: MemoryCaptureResult): FounderMemoryCapture {
  return {
    outcome: c.outcome,
    type: c.classification.type,
    scope:
      c.outcome === 'stored' && c.classification.decision !== 'ignore'
        ? c.classification.decision
        : null,
    memoryId: c.memory?.id ?? null,
    rejections: c.rejections,
  };
}

/** Connector ids that map to a context-source label, so finding provenance surfaces. */
const CONNECTOR_SOURCE: Partial<Record<string, AiContextSource>> = {
  github: 'github',
  notion: 'notion',
  calendar: 'calendar',
  'google-workspace': 'calendar',
  gcal: 'calendar',
  slack: 'slack',
};

/**
 * The systems that informed the answer = the LLM's context sources plus the
 * connectors behind the deterministic findings (the findings come from the Mission
 * Brief, so without this their origin — e.g. GitHub — wouldn't otherwise show).
 */
function mergeSourceSystems(
  contextSources: AiContextSource[],
  findings: FounderFinding[],
): AiContextSource[] {
  const set = new Set<AiContextSource>(contextSources);
  for (const f of findings) {
    const mapped = f.connectorId ? CONNECTOR_SOURCE[f.connectorId] : undefined;
    if (mapped) set.add(mapped);
  }
  return [...set];
}

/**
 * Surface the timeline events among the assembled context as explicit references
 * (Mission Brief v3). These are the real timeline entries retrieved for this
 * answer, deduped by id — never invented.
 */
function timelineRefsFromContext(context: AiContextItem[]): FounderTimelineRef[] {
  const refs: FounderTimelineRef[] = [];
  const seen = new Set<string>();
  for (const item of context) {
    if (item.source !== 'timeline') continue;
    const ev = item.evidence?.[0];
    const id = ev?.id ?? '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    refs.push({ id, kind: ev?.kind ?? 'timeline', text: firstLine(item.text) });
  }
  return refs;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? text.trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/** A response shell used by the clarification / insufficient-evidence paths and as the field baseline. */
function baseResponse(
  question: string,
  cls: FounderIntentResult,
  now: string,
  overrides: Partial<FounderResponse> = {},
): FounderResponse {
  return {
    question,
    intent: cls.intent,
    intentConfidence: cls.confidence,
    needsClarification: false,
    clarification: null,
    executiveSummary: null,
    keyFindings: [],
    businessImpact: null,
    recommendations: [],
    grounded: false,
    aiOffline: true,
    model: 'none',
    confidence: 0,
    evidence: [],
    sourceSystems: [],
    timelineReferences: [],
    governance: defaultFounderGovernance({
      grounded: false,
      recommendations: [],
      sourceSystems: [],
    }),
    generatedAt: now,
    recalledMemories: [],
    memoryCapture: null,
    ...overrides,
  };
}

function renderFindings(findings: FounderFinding[]): string {
  if (findings.length === 0) return '(no deterministic findings)';
  return findings.map((f) => `- [${f.label}] ${f.text}`).join('\n');
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
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
}

/* ── deterministic findings from the Mission Brief ───────────────────────── */

/** Briefing sections that are specifically engineering/release facts. */
const ENGINEERING_SECTIONS = new Set([
  'engineering_risk',
  'ci_health',
  'pr_health',
  'release_health',
]);

/**
 * Select deterministic key findings from a computed briefing for the given intent.
 * Engineering and release-status questions draw from the engineering sections;
 * broader executive intents draw from every non-empty section. Capped so the
 * findings stay executive-level. Never invents — every finding carries evidence.
 */
export function founderFindingsFromBriefing(
  brief: Briefing,
  intent: FounderIntentV2,
  limit = 8,
): FounderFinding[] {
  const engineeringOnly = intent === 'engineering' || intent === 'release-status';
  const findings: FounderFinding[] = [];
  for (const section of brief.sections) {
    if (section.empty) continue;
    if (engineeringOnly && !ENGINEERING_SECTIONS.has(section.id)) continue;
    for (const item of section.items) {
      findings.push({
        label: section.title,
        text: item.detail ? `${item.text} — ${item.detail}` : item.text,
        at: item.at,
        connectorId: item.connectorId,
        evidence: item.evidence.map((e) => ({ kind: e.kind, id: e.id })),
      });
      if (findings.length >= limit) return findings;
    }
  }
  return findings;
}
