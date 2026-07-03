/**
 * Executive Conversation Memory — the engine.
 *
 * Founder AI uses this to remember executive exchanges. Three deterministic
 * pieces, no LLM (so nothing is fabricated and everything is testable):
 *
 *   1. classifyMemory  — decide what an exchange is (decision/action/preference/
 *      project/conversation) and how long to keep it (ignore/temporary/today/
 *      project/longterm).
 *   2. screenMemory    — a governance gate that refuses to store secrets
 *      (passwords, API keys, tokens, private keys, payment cards, SSNs) and,
 *      best-effort, obvious medical information.
 *   3. the service     — capture (classify → screen → remember), recall (for an
 *      answer), search (for the Memory panel), and forget. Persistence and
 *      retrieval are the *existing* AI Memory store, injected as deps; this file
 *      adds only the executive semantics on top.
 *
 * Secrets screening is strong for patterned credentials and deliberately
 * conservative (when in doubt, refuse). It is NOT a comprehensive PHI/financial
 * classifier — free-form medical or financial prose beyond recognizable patterns
 * is not guaranteed to be caught. See FOUNDER-AI-V2 / memory docs.
 */
import type {
  ExecutiveMemoryQuery,
  ExecutiveMemoryStatus,
  ExecutiveMemoryType,
  ExecutiveMemoryView,
  FounderResponse,
  MemoryAuditAction,
  MemoryAuditEvent,
  MemoryCaptureResult,
  MemoryClassification,
  MemoryDecision,
  MemoryItem,
  MemoryKind,
  MemoryMeta,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryRejection,
  MemoryScreenResult,
  MemoryWriteInput,
} from '@neuropause/shared';

/* ── Dependencies (the live AI Memory store + an audit sink, injected) ─────── */

export interface ConversationMemoryDeps {
  remember: (input: MemoryWriteInput, now?: string) => MemoryItem;
  recall: (q: MemoryRecallQuery) => MemoryRecallResult;
  get: (id: string) => MemoryItem | null;
  forget: (ids: string[]) => number;
  /** Patch an existing item's metadata (pin / resolve). Optional: omit to disable those ops. */
  update?: (id: string, patch: { metadata?: MemoryMeta }, now?: string) => MemoryItem | null;
  audit: (event: MemoryAuditEvent) => void;
  now?: () => string;
}

export interface CaptureInput {
  question: string;
  response: FounderResponse;
  conversationId?: string | null;
  now?: string;
}

/* ── 1. Classifier ─────────────────────────────────────────────────────────
 * Ordered rules; first match wins. Decision/action/preference/project fire on
 * the founder's statement regardless of how the model answered — an approval is
 * worth keeping even if the reply was thin. The default "conversation" case only
 * stores when the answer actually carried substance.
 */

const IGNORE_RE =
  /^\s*(?:ignore(?:\s+(?:this|that|it))?|forget(?:\s+(?:this|that|it))?|never\s?mind|disregard(?:\s+(?:this|that|it))?|scratch that|don'?t\s+(?:remember|save|store)\b)/i;

const DECISION_RE =
  /\b(?:i|we)\s+(?:have\s+)?(?:approved|decided|authoriz(?:ed|e)|ratified|signed[- ]?off|green[- ]?lit)\b|\bapproved\b|\b(?:go ahead with|ship it|sign off on|let'?s (?:go with|ship|proceed with))\b/i;

const PREFERENCE_RE =
  /\b(?:top|highest|main|number[- ]?one)\s+priorit(?:y|ies)\b|\b(?:our|my)\s+(?:priorit(?:y|ies)|policy|preference|standard|focus|rule)\b|\b(?:i|we)\s+(?:prefer|always|never)\b|\b(?:going forward|from now on|as a (?:rule|policy))\b/i;

const ACTION_RE =
  /\b(?:postpon(?:e|ed)|defer(?:red)?|delay(?:ed)?|reschedul(?:e|ed)|push(?:ed)?\s+(?:back|to)|mov(?:e|ed)\s+\w+\s+to)\b|\b(?:we'?ll|i'?ll|we will|i will|we'?re going to|plan(?:ned)?\s+to|scheduled\s+to)\b[^?]{0,40}\b(?:on|by|until|next|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|week|month)\b/i;

const PROJECT_RE =
  /\b(?:our|my)\s+(?:flagship|main|primary|core)\s+(?:project|product|focus)\b|\b(?:we'?re|we are|i'?m)\s+(?:focus(?:ed|ing)\s+on|building|prioritizing)\b/i;

const IMPORTANCE: Record<ExecutiveMemoryType, number> = {
  decision: 0.9,
  preference: 0.85,
  action: 0.8,
  project: 0.65,
  conversation: 0.45,
};

function mk(
  decision: MemoryDecision,
  type: ExecutiveMemoryType,
  confidence: number,
  reason: string,
): MemoryClassification {
  return { decision, type, importance: IMPORTANCE[type], confidence, reason };
}

/** Best-effort project reference from the statement (release/version/repo token). */
function extractProject(text: string): string | null {
  const rel = text.match(/\bRelease\s+[\w.]+/i) ?? text.match(/\bv\d+\.\d+(?:\.\d+)?\b/);
  if (rel) return rel[0];
  const repo = text.match(/\b[\w.-]+\/[\w.-]+\b/);
  if (repo) return repo[0];
  return null;
}

/** Best-effort worker reference from the answer's intent. */
function extractWorker(response: FounderResponse): string | null {
  if (response.intent === 'engineering' || response.intent === 'release-status')
    return 'engineering';
  return null;
}

/** The connector an exchange is about, derived from the answer's source systems. */
const CONNECTOR_SOURCES = new Set(['github', 'notion', 'calendar', 'slack']);
function extractConnector(response: FounderResponse): string | null {
  return response.sourceSystems.find((s) => CONNECTOR_SOURCES.has(s)) ?? null;
}

export function classifyMemory(
  question: string,
  response: FounderResponse,
  _now = new Date().toISOString(),
): MemoryClassification {
  const q = question.trim();
  if (q.length < 3 || IGNORE_RE.test(q))
    return mk('ignore', 'conversation', 0.95, 'Explicit ignore or empty input.');

  const projectRef = extractProject(q);

  if (DECISION_RE.test(q))
    return mk('longterm', 'decision', 0.9, 'States an executive decision or approval.');
  if (PREFERENCE_RE.test(q))
    return mk('longterm', 'preference', 0.85, 'States a standing priority or preference.');
  if (ACTION_RE.test(q))
    return mk(
      projectRef ? 'project' : 'longterm',
      'action',
      0.82,
      'Commits to or reschedules an action.',
    );
  if (PROJECT_RE.test(q)) return mk('longterm', 'project', 0.7, 'Declares project-level context.');

  // Default: a conversation — only worth keeping if the answer had substance.
  const substantive = response.grounded || response.keyFindings.length > 0;
  if (response.needsClarification || !substantive)
    return mk('ignore', 'conversation', 0.8, 'No substantive answer to remember.');
  return mk(
    projectRef ? 'project' : 'today',
    'conversation',
    0.6,
    'Substantive executive question and answer.',
  );
}

/* ── 2. Governance screen (refuse to store secrets) ────────────────────────── */

interface SecretPattern {
  category: MemoryRejection['category'];
  detail: string;
  re: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    category: 'private-key',
    detail: 'Looks like a private key block.',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  },
  {
    category: 'token',
    detail: 'Looks like a JSON Web Token.',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  { category: 'api-key', detail: 'Looks like an AWS access key id.', re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    category: 'api-key',
    detail: 'Looks like a GitHub token.',
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  },
  {
    category: 'api-key',
    detail: 'Looks like a Slack token.',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  { category: 'api-key', detail: 'Looks like a Google API key.', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    category: 'api-key',
    detail: 'Looks like a Stripe-style secret key.',
    re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  { category: 'api-key', detail: 'Looks like an OpenAI-style key.', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { category: 'api-key', detail: 'Looks like an npm token.', re: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  {
    category: 'token',
    detail: 'Looks like a bearer token.',
    re: /\bbearer\s+[A-Za-z0-9._-]{16,}/i,
  },
  {
    category: 'password',
    detail: 'Contains a password value.',
    re: /\b(?:pass(?:word|wd)?|pwd)\b\s*[:=]\s*\S{3,}/i,
  },
  {
    category: 'secret',
    detail: 'Contains a named secret or credential value.',
    re: /\b(?:client[_\-\s]?secret|secret[_\-\s]?key|api[_\-\s]?key|access[_\-\s]?token|auth[_\-\s]?token|refresh[_\-\s]?token)\b\s*[:=]\s*\S{6,}/i,
  },
  {
    category: 'financial-credential',
    detail: 'Looks like a US Social Security Number.',
    re: /\b\d{3}-\d{2}-\d{4}\b/,
  },
  {
    category: 'financial-credential',
    detail: 'Looks like an IBAN.',
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/,
  },
];

const MEDICAL_RE =
  /\b(?:diagnos(?:is|ed)|prescri(?:bed|ption)|medical record|patient (?:id|record|name)|blood (?:test|pressure)|HbA1c|mg\/dl|tested? positive for|positive for (?:hiv|covid|cancer))\b/i;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text: string): boolean {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  return candidates.some((c) => {
    const d = c.replace(/[ -]/g, '');
    return d.length >= 13 && d.length <= 19 && luhnValid(d);
  });
}

export function screenMemory(text: string): MemoryScreenResult {
  const rejections: MemoryRejection[] = [];
  const seen = new Set<string>();
  const add = (r: MemoryRejection): void => {
    const key = `${r.category}:${r.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      rejections.push(r);
    }
  };
  for (const p of SECRET_PATTERNS)
    if (p.re.test(text)) add({ category: p.category, detail: p.detail });
  if (hasCardNumber(text))
    add({ category: 'financial-credential', detail: 'Looks like a payment card number.' });
  if (MEDICAL_RE.test(text))
    add({ category: 'medical-information', detail: 'Looks like medical information.' });
  return { allowed: rejections.length === 0, rejections };
}

/* ── 3. The service: capture / recall / search / forget ────────────────────── */

const KIND_BY_TYPE: Record<ExecutiveMemoryType, MemoryKind> = {
  decision: 'decision',
  action: 'task',
  preference: 'note',
  project: 'context',
  conversation: 'conversation',
};

let auditSeq = 0;
function makeAudit(
  action: MemoryAuditAction,
  memoryId: string | null,
  at: string,
  detail: string,
  decision: MemoryDecision | null,
  rejections: MemoryRejection[],
): MemoryAuditEvent {
  return {
    id: `mem-audit-${at}-${(++auditSeq).toString(36)}`,
    action,
    memoryId,
    at,
    detail,
    decision,
    rejections,
  };
}

function endOfDay(nowIso: string): string {
  const d = new Date(nowIso);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function expiryFor(decision: MemoryDecision, now: string): string | null {
  if (decision === 'temporary') return new Date(Date.parse(now) + 1000 * 60 * 60 * 8).toISOString(); // ~session
  if (decision === 'today') return endOfDay(now);
  return null; // project / longterm are permanent
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function titleFor(type: ExecutiveMemoryType, question: string): string {
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return `${label}: ${truncate(question.trim(), 60)}`;
}

function toMemoryWriteInput(
  question: string,
  response: FounderResponse,
  c: MemoryClassification,
  conversationId: string | null,
  now: string,
): MemoryWriteInput {
  const project = extractProject(question);
  const worker = extractWorker(response);
  const connector = extractConnector(response);
  const scope = c.decision; // never 'ignore' here
  const status: ExecutiveMemoryStatus = c.type === 'decision' ? 'open' : 'resolved';
  const tags = ['exec', `type:${c.type}`, `scope:${scope}`];
  if (project) tags.push(`project:${project}`);
  if (worker) tags.push(`worker:${worker}`);
  if (connector) tags.push(`connector:${connector}`);
  const entityRefs = response.evidence.filter((e) => e.kind === 'entity').map((e) => e.id);

  return {
    kind: KIND_BY_TYPE[c.type],
    title: titleFor(c.type, question),
    content: question.trim(),
    entityRefs,
    tags,
    occurredAt: now,
    metadata: {
      exec: true,
      execType: c.type,
      scope,
      importance: c.importance,
      confidence: response.confidence,
      status,
      pinned: false,
      expiresAt: expiryFor(scope, now),
      sourceConversation: conversationId,
      project: project,
      worker: worker,
      connector: connector,
      intent: response.intent,
    },
  };
}

function asExecType(v: unknown): ExecutiveMemoryType {
  return v === 'decision' || v === 'action' || v === 'preference' || v === 'project'
    ? v
    : 'conversation';
}

function asScope(v: unknown): ExecutiveMemoryView['scope'] {
  return v === 'temporary' || v === 'project' || v === 'longterm' ? v : 'today';
}

/** Decode a stored MemoryItem into an executive view, or null if it isn't one. */
export function decodeMemoryView(item: MemoryItem): ExecutiveMemoryView | null {
  const m = item.metadata;
  if (m.exec !== true) return null;
  return {
    id: item.id,
    type: asExecType(m.execType),
    scope: asScope(m.scope),
    title: item.title,
    content: item.content,
    importance: typeof m.importance === 'number' ? m.importance : 0.5,
    confidence: typeof m.confidence === 'number' ? m.confidence : 0,
    project: typeof m.project === 'string' ? m.project : null,
    worker: typeof m.worker === 'string' ? m.worker : null,
    connectorId: typeof m.connector === 'string' ? m.connector : item.connectorId,
    status: m.status === 'resolved' ? 'resolved' : m.status === 'open' ? 'open' : 'resolved',
    pinned: m.pinned === true,
    occurredAt: item.occurredAt,
    createdAt: item.createdAt,
    expiresAt: typeof m.expiresAt === 'string' ? m.expiresAt : null,
    sourceConversation: typeof m.sourceConversation === 'string' ? m.sourceConversation : null,
    evidence: item.evidence,
  };
}

function isExpired(view: ExecutiveMemoryView, now: string): boolean {
  return view.expiresAt != null && Date.parse(view.expiresAt) <= Date.parse(now);
}

/**
 * Capture an executive exchange: classify → (ignore short-circuits) → screen for
 * secrets → store as an explicit AI Memory item. Audits the governance result.
 */
export function captureFounderMemory(
  deps: ConversationMemoryDeps,
  input: CaptureInput,
): MemoryCaptureResult {
  const now = input.now ?? deps.now?.() ?? new Date().toISOString();
  const classification = classifyMemory(input.question, input.response, now);

  if (classification.decision === 'ignore') {
    return { outcome: 'ignored', classification, memory: null, rejections: [] };
  }

  const screen = screenMemory(input.question);
  if (!screen.allowed) {
    deps.audit(
      makeAudit(
        'rejected',
        null,
        now,
        `Refused to store ${classification.type}: ${screen.rejections.map((r) => r.category).join(', ')}.`,
        classification.decision,
        screen.rejections,
      ),
    );
    return { outcome: 'rejected', classification, memory: null, rejections: screen.rejections };
  }

  const item = deps.remember(
    toMemoryWriteInput(
      input.question,
      input.response,
      classification,
      input.conversationId ?? null,
      now,
    ),
    now,
  );
  const view = decodeMemoryView(item);
  deps.audit(
    makeAudit(
      'created',
      item.id,
      now,
      `Stored ${classification.type} (${classification.decision}).`,
      classification.decision,
      [],
    ),
  );
  return { outcome: 'stored', classification, memory: view, rejections: [] };
}

function recallExecHits(
  deps: ConversationMemoryDeps,
  text: string | undefined,
  limit: number,
): ExecutiveMemoryView[] {
  const q: MemoryRecallQuery = { tag: 'exec', limit: Math.min(Math.max(limit * 4, 50), 300) };
  if (text) q.text = text;
  return deps
    .recall(q)
    .hits.map((h) => decodeMemoryView(h.item))
    .filter((v): v is ExecutiveMemoryView => v !== null);
}

/**
 * Retrieve only the memories relevant to the current question, for grounding an
 * answer. Audits a single 'used' event. (Founder AI also pulls AI Memory through
 * the Context Builder; this is the executive-scoped, audited complement.)
 */
export function recallForAnswer(
  deps: ConversationMemoryDeps,
  args: { question: string; limit?: number; now?: string },
): ExecutiveMemoryView[] {
  const now = args.now ?? deps.now?.() ?? new Date().toISOString();
  const limit = args.limit ?? 5;
  const views = recallExecHits(deps, args.question, limit)
    .filter((v) => !isExpired(v, now))
    .slice(0, limit);
  if (views.length > 0) {
    deps.audit(
      makeAudit(
        'used',
        null,
        now,
        `Recalled ${views.length} memor${views.length === 1 ? 'y' : 'ies'} for an answer.`,
        null,
        [],
      ),
    );
  }
  return views;
}

/** Search/browse executive memories for the Memory panel. No 'used' audit (browsing). */
export function searchExecutiveMemories(
  deps: ConversationMemoryDeps,
  query: ExecutiveMemoryQuery,
  now = new Date().toISOString(),
): ExecutiveMemoryView[] {
  const limit = query.limit ?? 20;
  let views = recallExecHits(deps, query.text, limit).filter((v) => !isExpired(v, now));

  if (query.decisionsOnly) views = views.filter((v) => v.type === 'decision');
  if (query.type) views = views.filter((v) => v.type === query.type);
  if (query.status) views = views.filter((v) => v.status === query.status);
  if (query.pinnedOnly) views = views.filter((v) => v.pinned);
  if (query.worker) views = views.filter((v) => v.worker === query.worker);
  if (query.connectorId) views = views.filter((v) => v.connectorId === query.connectorId);
  if (query.project) {
    const needle = query.project.toLowerCase();
    views = views.filter((v) => v.project != null && v.project.toLowerCase().includes(needle));
  }
  if (query.since) views = views.filter((v) => Date.parse(v.createdAt) >= Date.parse(query.since!));
  if (query.until) views = views.filter((v) => Date.parse(v.createdAt) <= Date.parse(query.until!));

  return views.slice(0, limit);
}

/** Forget an executive memory by id; audits 'forgotten'. */
export function forgetMemory(deps: ConversationMemoryDeps, id: string, now?: string): boolean {
  const ts = now ?? deps.now?.() ?? new Date().toISOString();
  const item = deps.get(id);
  const removed = deps.forget([id]) > 0;
  if (removed) {
    deps.audit(
      makeAudit('forgotten', id, ts, `Forgot memory${item ? `: ${item.title}` : ''}.`, null, []),
    );
  }
  return removed;
}

/** Pin or unpin a memory so it stays surfaced in the panel; audits 'pinned'. */
export function pinMemory(
  deps: ConversationMemoryDeps,
  id: string,
  pinned: boolean,
  now?: string,
): ExecutiveMemoryView | null {
  if (!deps.update) return null;
  const ts = now ?? deps.now?.() ?? new Date().toISOString();
  const item = deps.update(id, { metadata: { pinned } }, ts);
  if (!item) return null;
  const view = decodeMemoryView(item);
  if (!view) return null;
  deps.audit(makeAudit('pinned', id, ts, pinned ? 'Pinned memory.' : 'Unpinned memory.', null, []));
  return view;
}

/** Mark a decision open or resolved; audits 'updated'. */
export function setDecisionStatus(
  deps: ConversationMemoryDeps,
  id: string,
  status: ExecutiveMemoryStatus,
  now?: string,
): ExecutiveMemoryView | null {
  if (!deps.update) return null;
  const ts = now ?? deps.now?.() ?? new Date().toISOString();
  const item = deps.update(id, { metadata: { status } }, ts);
  if (!item) return null;
  const view = decodeMemoryView(item);
  if (!view) return null;
  deps.audit(makeAudit('updated', id, ts, `Marked decision ${status}.`, null, []));
  return view;
}
