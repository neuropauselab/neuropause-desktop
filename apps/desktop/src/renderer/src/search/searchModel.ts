/**
 * Phase 6 Stage 3 — Universal Search: the pure result model.
 *
 * One envelope (`UnifiedSearchItem`) for every hit from every existing index,
 * an explainable cross-source ranker ("Why this result?": relevance factors,
 * source, freshness, confidence), the Search Scope Selector registry (routes
 * queries across EXISTING indexes — it creates none), plan post-filters,
 * grouping, and search-history helpers.
 *
 * House `*Model.ts` convention: every export is a pure projection; no React,
 * no DOM, no IPC. All mappers take `unknown` and validate field-by-field —
 * malformed rows are dropped, never guessed (Stage 2 rule, carried forward).
 */
import type { EngineSourceKey, PipelineSourceKey, RecordKind, SearchPlan } from './queryPlanner';

/* ── the unified result envelope ─────────────────────────────────────────── */

export type SearchItemType =
  | 'entity'
  | 'graph'
  | 'memory'
  | 'timeline'
  | 'decision'
  | 'workflow'
  | 'connector'
  | 'workspace'
  | 'app'
  | 'section'
  | 'execution'
  | 'person'
  | 'business';

export interface ExplainFactor {
  label: string;
  detail?: string;
  /** Signed contribution to the final score (display only). */
  weight?: number;
}

/** The mandatory "Why this result?" payload on every hit. */
export interface SearchExplanation {
  factors: ExplainFactor[];
  /** Human source line, e.g. "AI Memory (lexical)" or "GitHub · Unified Data Model". */
  source: string;
  /** "updated 2 h ago" / "occurred 3 d ago" — null when the source has no timestamp. */
  freshness: string | null;
  /**
   * Confidence band where applicable (content relevance). Null for purely
   * navigational hits (sections, apps, workspaces) where confidence is not
   * meaningful — per the Stage 3 constraint ("where applicable").
   */
  confidence: 'high' | 'medium' | 'low' | null;
}

export interface UnifiedSearchItem {
  /** Globally unique across sources (`<source>:<id>`). */
  key: string;
  id: string;
  type: SearchItemType;
  /** Source-native kind for display ("document", "task", "invoice", …). */
  kind: string;
  title: string;
  summary: string | null;
  /** Machine source id ("engine:entity", "records:decisions", "modules:finance.invoice"…). */
  source: string;
  connectorId: string | null;
  /** Epoch ms, or null when the source carries no timestamp. */
  timestamp: number | null;
  /** Raw source-normalized relevance 0..1 (before blending). */
  baseScore: number;
  /** Final blended score 0..1 — filled by rankUnified. */
  score: number;
  explanation: SearchExplanation;
  /** Extra match text for phrase/person post-filters (author, actor, body). */
  matchText: string;
}

/* ── scope selector (routes across existing indexes; creates none) ───────── */

export type SearchScopeId = 'all' | 'content' | 'knowledge' | 'activity' | 'operations' | 'business' | 'people' | 'navigate';

export interface SearchScopeDef {
  id: SearchScopeId;
  label: string;
  description: string;
  sources: PipelineSourceKey[];
  engineSources?: EngineSourceKey[];
  recordKinds?: RecordKind[];
  entityKinds?: string[];
}

/** Every scope routes to existing services only (engine / records / semantic / modules). */
export const SEARCH_SCOPES: SearchScopeDef[] = [
  { id: 'all', label: 'Everything', description: 'All indexes: records, knowledge, activity, operations, business, navigation', sources: ['engine', 'records', 'semantic', 'modules'] },
  { id: 'content', label: 'Docs & messages', description: 'Synced documents, files, emails, messages, events (Unified Data Model)', sources: ['engine'], engineSources: ['entity'], entityKinds: ['document', 'file', 'attachment', 'message', 'conversation', 'calendar_event', 'event'] },
  { id: 'knowledge', label: 'Knowledge', description: 'Knowledge graph + AI memory (lexical and semantic)', sources: ['engine', 'semantic'], engineSources: ['graph', 'memory'] },
  { id: 'activity', label: 'Activity', description: 'Timeline events and AI execution sessions', sources: ['engine', 'records'], engineSources: ['timeline'], recordKinds: ['executions'] },
  { id: 'operations', label: 'Operations', description: 'Decisions, workflows, connectors, workspaces', sources: ['records'], recordKinds: ['decisions', 'workflows', 'connectors', 'workspaces'] },
  { id: 'business', label: 'Business', description: 'ERP records: invoices, orders, customers, leads… (module record store)', sources: ['modules'] },
  { id: 'people', label: 'People', description: 'Organization members and synced contacts', sources: ['engine', 'records'], engineSources: ['entity'], entityKinds: ['contact'], recordKinds: ['people'] },
  { id: 'navigate', label: 'Navigate', description: 'Sections and installable apps', sources: ['records'], recordKinds: ['sections', 'apps'] },
];

export const SCOPE_BY_ID: Record<SearchScopeId, SearchScopeDef> = Object.fromEntries(
  SEARCH_SCOPES.map((s) => [s.id, s]),
) as Record<SearchScopeId, SearchScopeDef>;

/** The plan after the user's scope is applied: what actually runs, where. */
export interface ResolvedPlan {
  plan: SearchPlan;
  scope: SearchScopeId;
  sources: PipelineSourceKey[];
  engineSources: EngineSourceKey[] | null;
  entityKinds: string[] | null;
  recordKinds: RecordKind[] | null;
}

const intersect = <T>(a: T[] | null, b: T[] | null): T[] | null => {
  if (!a) return b;
  if (!b) return a;
  const set = new Set(b);
  const both = a.filter((x) => set.has(x));
  return both.length > 0 ? both : a; // an empty intersection falls back to the user's scope
};

/**
 * Combine the planner's routing with the user's scope. The SCOPE decides which
 * sources run (explicit user intent wins); the plan's filters narrow within
 * each source. In the 'all' scope, the planner's source routing only takes
 * over for pure record/module browses (no free text) — a query with real text
 * always searches every index, with the plan applied as filters, so "contract"
 * never silently skips records just because it also implies a document kind.
 */
export function applyScope(plan: SearchPlan, scope: SearchScopeId): ResolvedPlan {
  const def = SCOPE_BY_ID[scope] ?? SCOPE_BY_ID.all;
  const browseRouted = plan.text.length === 0 && plan.sources !== null;
  const sources = scope === 'all' && browseRouted && plan.sources ? plan.sources : def.sources;
  return {
    plan,
    scope: def.id,
    sources,
    engineSources: intersect(def.engineSources ?? null, plan.engineSources),
    entityKinds: intersect(def.entityKinds ?? null, plan.entityKinds),
    recordKinds: intersect(def.recordKinds ?? null, plan.recordKinds),
  };
}

/* ── display metadata per type ───────────────────────────────────────────── */

export const TYPE_META: Record<SearchItemType, { label: string; icon: string }> = {
  entity: { label: 'Docs & messages', icon: 'doc' },
  graph: { label: 'Knowledge graph', icon: 'grid' },
  memory: { label: 'AI memory', icon: 'memory' },
  timeline: { label: 'Timeline', icon: 'clock' },
  decision: { label: 'Decisions', icon: 'shield' },
  workflow: { label: 'Workflows', icon: 'bolt' },
  connector: { label: 'Connectors', icon: 'connectors' },
  workspace: { label: 'Workspaces', icon: 'workspace' },
  app: { label: 'Apps', icon: 'package' },
  section: { label: 'Sections', icon: 'grid' },
  execution: { label: 'AI sessions', icon: 'play' },
  person: { label: 'People', icon: 'user' },
  business: { label: 'Business records', icon: 'store' },
};

/* ── small pure helpers ──────────────────────────────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const parseTime = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
};
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Exact > prefix > substring > subsequence relevance for local record matching. 0 = no match. */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0.01; // browse mode: everything matches weakly (recency will order)
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.85;
  if (t.includes(q)) return 0.65;
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    ti = found + 1;
  }
  return 0.3;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "moments ago" / "3 h ago" / "5 d ago" — pure, injectable now. */
export function freshnessLabel(timestamp: number | null, now: number, verb = 'updated'): string | null {
  if (timestamp === null || timestamp <= 0) return null;
  const delta = Math.max(0, now - timestamp);
  if (delta < HOUR) return `${verb} moments ago`;
  if (delta < DAY) return `${verb} ${Math.round(delta / HOUR)} h ago`;
  if (delta < 60 * DAY) return `${verb} ${Math.round(delta / DAY)} d ago`;
  return `${verb} ${Math.round(delta / (30 * DAY))} mo ago`;
}

function confidenceBand(base: number, matchStrength: number): 'high' | 'medium' | 'low' {
  const blend = base * 0.7 + matchStrength * 0.3;
  if (blend >= 0.7) return 'high';
  if (blend >= 0.35) return 'medium';
  return 'low';
}

/** Navigational types where a relevance-confidence claim is not meaningful. */
const NAVIGATIONAL: ReadonlySet<SearchItemType> = new Set(['section', 'app', 'workspace']);

function baseExplanation(source: string): SearchExplanation {
  return { factors: [], source, freshness: null, confidence: null };
}

function makeItem(partial: Omit<UnifiedSearchItem, 'score'>): UnifiedSearchItem {
  return { ...partial, score: partial.baseScore };
}

/* ── mappers: every existing hit shape → the unified envelope ────────────── */

const ENGINE_TYPE: Record<string, SearchItemType> = { entity: 'entity', graph: 'graph', memory: 'memory', timeline: 'timeline' };
const ENGINE_SOURCE_LABEL: Record<string, string> = {
  entity: 'Unified Data Model',
  graph: 'Knowledge graph',
  memory: 'AI memory',
  timeline: 'Enterprise timeline',
  federation: 'Federation',
};

/** EnterpriseSearchHit (or federation) → item. */
export function fromEngineHit(raw: unknown): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const title = str(raw.title);
  const sourceKind = str(raw.source);
  if (!id || !title || !sourceKind) return null;
  const type = ENGINE_TYPE[sourceKind] ?? 'entity';
  const connectorId = typeof raw.connectorId === 'string' && raw.connectorId ? raw.connectorId : null;
  const srcLabel = ENGINE_SOURCE_LABEL[sourceKind] ?? sourceKind;
  return makeItem({
    key: `engine:${sourceKind}:${id}`,
    id,
    type,
    kind: str(raw.kind, sourceKind),
    title,
    summary: typeof raw.snippet === 'string' && raw.snippet ? raw.snippet : null,
    source: `engine:${sourceKind}`,
    connectorId,
    timestamp: parseTime(raw.timestamp),
    baseScore: clamp01(num(raw.score)),
    explanation: baseExplanation(connectorId ? `${connectorId} · ${srcLabel}` : srcLabel),
    matchText: `${title} ${str(raw.snippet)} ${str(raw.kind)}`,
  });
}

/** MemoryRecallResult hit (semantic retriever) → item. */
export function fromSemanticHit(raw: unknown, retriever: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const item = raw.item;
  if (!isRecord(item)) return null;
  const id = str(item.id);
  const title = str(item.title);
  if (!id || !title) return null;
  const content = str(item.content);
  return makeItem({
    key: `semantic:${id}`,
    id,
    type: 'memory',
    kind: str(item.kind, 'memory'),
    title,
    summary: content ? (content.length > 160 ? `${content.slice(0, 157)}…` : content) : null,
    source: 'semantic:memory',
    connectorId: typeof item.connectorId === 'string' && item.connectorId ? item.connectorId : null,
    timestamp: parseTime(item.occurredAt) ?? parseTime(item.updatedAt),
    baseScore: clamp01(num(raw.score)),
    explanation: baseExplanation(`AI memory (semantic · ${retriever})`),
    matchText: `${title} ${content}`,
  });
}

/** ExecutiveDecision → item (carries the decision's own 0..1 confidence). */
export function fromDecision(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const title = str(raw.title);
  if (!id || !title) return null;
  const description = str(raw.description);
  const text = `${title} ${description} ${str(raw.category)} ${str(raw.owner)}`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `decision:${id}`,
    id,
    type: 'decision',
    kind: str(raw.status, 'decision'),
    title,
    summary: description || null,
    source: 'records:decisions',
    connectorId: null,
    timestamp: parseTime(raw.updatedAt) ?? parseTime(raw.createdAt),
    baseScore: score,
    explanation: baseExplanation('Enterprise decisions'),
    matchText: text,
  });
}

/** AutomationRule → item. */
export function fromWorkflow(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const description = str(raw.description);
  const actionTypes = asArray(raw.actions).map((a) => (isRecord(a) ? str(a.type) : '')).filter(Boolean).join(' ');
  const text = `${name} ${description} ${actionTypes}`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `workflow:${id}`,
    id,
    type: 'workflow',
    kind: str(raw.status, 'workflow'),
    title: name,
    summary: description || (actionTypes ? `actions: ${actionTypes}` : null),
    source: 'records:workflows',
    connectorId: null,
    timestamp: parseTime(raw.updatedAt) ?? parseTime(raw.createdAt),
    baseScore: score,
    explanation: baseExplanation('Automation workflows'),
    matchText: text,
  });
}

/** ConnectorDto → item (production lifecycle only; health surfaced in kind). */
export function fromConnector(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name, id);
  if (!id) return null;
  if (str(raw.lifecycle) === 'preview') return null;
  const status = str(raw.status, 'unknown');
  const health = str(raw.health, 'unknown');
  const text = `${name} ${id} ${status} ${health} connector`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  const lastSync = parseTime(raw.lastSyncAt);
  return makeItem({
    key: `connector:${id}`,
    id,
    type: 'connector',
    kind: `${status} · ${health}`,
    title: name,
    summary: `Connector · ${status} · health ${health}`,
    source: 'records:connectors',
    connectorId: id,
    timestamp: lastSync,
    baseScore: score,
    explanation: baseExplanation('Connector registry'),
    matchText: text,
  });
}

/** Stage 1 workspace-context record → item. */
export function fromWorkspace(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const snap = isRecord(raw.snapshot) ? raw.snapshot : null;
  const tabTitles = asArray(snap?.tabs).map((t) => (isRecord(t) ? str(t.title) : '')).filter(Boolean);
  const text = `${name} workspace ${tabTitles.join(' ')}`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `workspace:${id}`,
    id,
    type: 'workspace',
    kind: 'workspace',
    title: name,
    summary: tabTitles.length > 0 ? `${tabTitles.length} tab(s): ${tabTitles.slice(0, 3).join(', ')}` : 'Local workspace',
    source: 'records:workspaces',
    connectorId: null,
    timestamp: parseTime(raw.lastOpenedAt),
    baseScore: score,
    explanation: baseExplanation('Workspace contexts (Stage 1)'),
    matchText: text,
  });
}

/** Catalog app (renderer catalog) → item. */
export function fromApp(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const text = `${name} ${str(raw.category)} ${str(raw.developer)} ${str(raw.tagline)} app`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `app:${id}`,
    id,
    type: 'app',
    kind: str(raw.category, 'app'),
    title: name,
    summary: str(raw.tagline) || null,
    source: 'records:apps',
    connectorId: null,
    timestamp: null,
    baseScore: score,
    explanation: baseExplanation('App catalog'),
    matchText: text,
  });
}

/** Visible nav section → item. */
export function fromSection(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const label = str(raw.label);
  if (!id || !label || raw.hidden === true) return null;
  const text = `${label} ${id} section go to`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `section:${id}`,
    id,
    type: 'section',
    kind: 'section',
    title: label,
    summary: 'Go to section',
    source: 'records:sections',
    connectorId: null,
    timestamp: null,
    baseScore: score,
    explanation: baseExplanation('Navigation'),
    matchText: text,
  });
}

/** ExecutionSession → item. */
export function fromExecution(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const label = str(raw.label, id);
  if (!id) return null;
  const summary = str(raw.resultSummary);
  const text = `${label} ${str(raw.kind)} ${str(raw.state)} ${summary} session execution`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `execution:${id}`,
    id,
    type: 'execution',
    kind: str(raw.state, 'session'),
    title: label,
    summary: summary || `${str(raw.kind, 'execution')} · ${str(raw.state, 'unknown')}`,
    source: 'records:executions',
    connectorId: null,
    timestamp: parseTime(raw.completedAt) ?? parseTime(raw.startedAt),
    baseScore: score,
    explanation: baseExplanation('Execute engine sessions'),
    matchText: text,
  });
}

/** OrgUser → item. */
export function fromPerson(raw: unknown, query: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const title = str(raw.title);
  const text = `${name} ${title} ${str(raw.email)} ${str(raw.kind)}`;
  const score = matchScore(query, text);
  if (score <= 0) return null;
  return makeItem({
    key: `person:${id}`,
    id,
    type: 'person',
    kind: str(raw.kind, 'person'),
    title: name,
    summary: title || null,
    source: 'records:people',
    connectorId: null,
    timestamp: null,
    baseScore: score,
    explanation: baseExplanation('Organization directory'),
    matchText: text,
  });
}

/** Enterprise module record (via the existing per-module search) → item. */
export function fromModuleRecord(raw: unknown, moduleId: string, moduleLabel: string): UnifiedSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const title = str(raw.title) || str(raw.name) || `${moduleLabel} ${id}`;
  const status = str(raw.status);
  const summaryBits = [moduleLabel, status].filter(Boolean).join(' · ');
  return makeItem({
    key: `module:${moduleId}:${id}`,
    id,
    type: 'business',
    kind: moduleLabel.toLowerCase(),
    title,
    summary: summaryBits || null,
    source: `modules:${moduleId}`,
    connectorId: null,
    timestamp: parseTime(raw.updatedAt) ?? parseTime(raw.createdAt),
    baseScore: 0.7, // served by the module store's own search; refined by ranking
    explanation: baseExplanation(`Business records · ${moduleLabel}`),
    matchText: `${title} ${status} ${moduleLabel}`,
  });
}

/* ── plan post-filters (dates, phrases, person, connectors, flags) ───────── */

export interface FilterOutcome {
  kept: UnifiedSearchItem[];
  dropped: number;
  notes: string[];
}

export function applyPlanFilters(items: UnifiedSearchItem[], plan: SearchPlan): FilterOutcome {
  const notes: string[] = [];
  let kept = items;

  if (plan.since !== null || plan.until !== null) {
    const before = kept.length;
    kept = kept.filter((i) => {
      if (i.timestamp === null) return i.type === 'section' || i.type === 'app'; // undated navigational items survive
      if (plan.since !== null && i.timestamp < plan.since) return false;
      if (plan.until !== null && i.timestamp > plan.until) return false;
      return true;
    });
    if (before !== kept.length) notes.push(`time filter removed ${before - kept.length}`);
  }

  if (plan.connectorIds && plan.connectorIds.length > 0) {
    const allow = new Set(plan.connectorIds);
    const before = kept.length;
    kept = kept.filter((i) => i.connectorId === null || allow.has(i.connectorId));
    if (before !== kept.length) notes.push(`connector filter removed ${before - kept.length}`);
  }

  for (const phrase of plan.phrases) {
    const needle = phrase.toLowerCase();
    const before = kept.length;
    kept = kept.filter((i) => i.matchText.toLowerCase().includes(needle));
    if (before !== kept.length) notes.push(`phrase “${phrase}” removed ${before - kept.length}`);
  }

  if (plan.person) {
    const who = plan.person.toLowerCase();
    const before = kept.length;
    kept = kept.filter((i) => i.matchText.toLowerCase().includes(who));
    if (before !== kept.length) notes.push(`person “${plan.person}” removed ${before - kept.length}`);
  }

  if (plan.flags.failed) {
    const before = kept.length;
    kept = kept.filter((i) => /fail|error|down|crash/i.test(`${i.kind} ${i.summary ?? ''} ${i.matchText}`));
    if (before !== kept.length) notes.push(`failed-only removed ${before - kept.length}`);
  }

  return { kept, dropped: items.length - kept.length, notes };
}

/* ── explainable cross-source ranking (Stage 3.8 + the added constraint) ── */

export interface RankContext {
  queryText: string;
  now: number;
  /** Keys of pinned/favorited results (boosted + explained). */
  pinnedKeys?: ReadonlySet<string>;
}

const RECENCY_HALF_LIFE_DAYS = 7;
const WEIGHTS = { base: 0.55, match: 0.2, recency: 0.15, pinned: 0.1 } as const;

/**
 * Blend per-source relevance with match strength, recency, and pins into one
 * 0..1 score — and write every contribution into the item's explanation, so
 * the UI can always answer "Why this result?".
 */
export function rankUnified(items: UnifiedSearchItem[], ctx: RankContext): UnifiedSearchItem[] {
  const ranked = items.map((item) => {
    const factors: ExplainFactor[] = [...item.explanation.factors];

    const base = clamp01(item.baseScore) * WEIGHTS.base;
    factors.push({
      label: item.source.startsWith('engine:') || item.source.startsWith('semantic') ? 'Index relevance' : 'Match relevance',
      detail: `${Math.round(clamp01(item.baseScore) * 100)}% from ${item.explanation.source}`,
      weight: Math.round(base * 100) / 100,
    });

    const titleMatch = matchScore(ctx.queryText, item.title);
    const match = titleMatch * WEIGHTS.match;
    if (ctx.queryText.trim().length > 0 && titleMatch > 0) {
      factors.push({
        label: titleMatch === 1 ? 'Exact title match' : titleMatch >= 0.85 ? 'Title starts with your query' : titleMatch >= 0.65 ? 'Title contains your query' : 'Partial title match',
        weight: Math.round(match * 100) / 100,
      });
    }

    let recency = 0;
    if (item.timestamp !== null) {
      const ageDays = Math.max(0, ctx.now - item.timestamp) / DAY;
      recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS) * WEIGHTS.recency;
      factors.push({
        label: 'Recency',
        detail: freshnessLabel(item.timestamp, ctx.now) ?? undefined,
        weight: Math.round(recency * 100) / 100,
      });
    }

    let pinned = 0;
    if (ctx.pinnedKeys?.has(item.key)) {
      pinned = WEIGHTS.pinned;
      factors.push({ label: 'Pinned by you', weight: pinned });
    }

    const score = clamp01(base + match + recency + pinned);
    const confidence = NAVIGATIONAL.has(item.type) ? null : confidenceBand(item.baseScore, titleMatch);

    const explanation: SearchExplanation = {
      factors,
      source: item.explanation.source,
      freshness: freshnessLabel(item.timestamp, ctx.now),
      confidence,
    };
    return { ...item, score, explanation };
  });

  return ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/* ── grouping, filtering, sorting for the view ───────────────────────────── */

export interface SearchGroup {
  type: SearchItemType;
  label: string;
  icon: string;
  items: UnifiedSearchItem[];
}

export function groupItems(items: UnifiedSearchItem[]): SearchGroup[] {
  const byType = new Map<SearchItemType, UnifiedSearchItem[]>();
  for (const item of items) {
    const list = byType.get(item.type) ?? [];
    list.push(item);
    byType.set(item.type, list);
  }
  return [...byType.entries()]
    .map(([type, list]) => ({ type, label: TYPE_META[type].label, icon: TYPE_META[type].icon, items: list }))
    .sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0));
}

export type SearchSort = 'relevance' | 'newest';
export type SearchDateFilter = 'any' | '24h' | '7d' | '30d';

export function applyViewFilters(
  items: UnifiedSearchItem[],
  opts: { types?: ReadonlySet<SearchItemType> | null; date?: SearchDateFilter; sort?: SearchSort; now: number },
): UnifiedSearchItem[] {
  let out = items;
  if (opts.types && opts.types.size > 0) out = out.filter((i) => opts.types!.has(i.type));
  if (opts.date && opts.date !== 'any') {
    const span = opts.date === '24h' ? DAY : opts.date === '7d' ? 7 * DAY : 30 * DAY;
    out = out.filter((i) => i.timestamp !== null && opts.now - i.timestamp <= span);
  }
  if (opts.sort === 'newest') {
    out = [...out].sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1));
  }
  return out;
}

/* ── search history (prefs-backed; injectable reader, Stage 1 idiom) ─────── */

export type PrefReader = <T>(key: string, fallback: T) => T;

export const SEARCH_HISTORY_CAP = 20;

export function readSearchHistory(read: PrefReader): string[] {
  const raw = read<unknown>('searchHistory', []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, SEARCH_HISTORY_CAP);
}

export function pushSearchHistory(history: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return history;
  return [q, ...history.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, SEARCH_HISTORY_CAP);
}
