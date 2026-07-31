/**
 * Phase 6 Stage 3 — deterministic natural-language query planner (D-2).
 *
 * Turns free text like "search gmail for the contract from last week" into a
 * structured `SearchPlan` that routes across EXISTING indexes only: which
 * pipeline sources to run, which engine sub-sources, which UDM entity kinds,
 * which connectors, which record feeds, which ERP modules, plus date bounds,
 * a person filter, quoted exact phrases, and status flags.
 *
 * PURE and offline: no LLM, no I/O, injectable clock (`now`) so every relative
 * date is unit-testable. Every extraction is recorded in `explain` — the UI
 * shows "Understood as: …" so query understanding is never a black box.
 * AI-assisted planning is deliberately deferred to Stage 4 (per D-2).
 */

/** The Stage 3 pipeline's source families (each routes to existing services). */
export type PipelineSourceKey = 'engine' | 'records' | 'semantic' | 'modules';

/** App-record feeds the `records` source can query (all existing list IPCs). */
export type RecordKind =
  | 'decisions'
  | 'workflows'
  | 'connectors'
  | 'workspaces'
  | 'apps'
  | 'sections'
  | 'executions'
  | 'people';

/** Engine sub-sources (mirrors the existing EnterpriseSearch source kinds). */
export type EngineSourceKey = 'entity' | 'graph' | 'memory' | 'timeline';

export interface SearchPlanFlags {
  failed?: boolean;
  unread?: boolean;
  /** "…assigned to me / my …" — recorded but not yet resolvable to an account (documented limitation). */
  mine?: boolean;
}

export interface SearchPlan {
  /** The original input, untouched. */
  raw: string;
  /** Residual free text used for retrieval (extractions removed, phrases kept as words). */
  text: string;
  /** Quoted exact phrases — every result must contain each one (post-filter). */
  phrases: string[];
  /** UDM entity kinds implied by the query, or null (no restriction). */
  entityKinds: string[] | null;
  /** Connector ids implied by the query (aliases expanded), or null. */
  connectorIds: string[] | null;
  /** Record feeds implied by the query, or null (scope decides). */
  recordKinds: RecordKind[] | null;
  /** Engine sub-sources implied by the query, or null (default set). */
  engineSources: EngineSourceKey[] | null;
  /** Pipeline sources the query itself demands, or null (scope decides). */
  sources: PipelineSourceKey[] | null;
  /** ERP module terms (e.g. "invoice") for the modules source. */
  moduleTerms: string[];
  /** Epoch-ms inclusive time bounds, or null. */
  since: number | null;
  until: number | null;
  /** A person name extracted from "involving/assigned to/with <name>". */
  person: string | null;
  flags: SearchPlanFlags;
  /** Human-readable summary of how the query was understood. */
  explain: string[];
}

/* ── vocabulary (routing only — never fabricates data) ───────────────────── */

/** Connector aliases → connector-id candidates (post-filtered against real hits). */
const CONNECTOR_ALIASES: Record<string, string[]> = {
  gmail: ['gmail', 'google-workspace', 'google'],
  'google drive': ['google-drive', 'google-workspace', 'google'],
  drive: ['google-drive', 'google-workspace'],
  calendar: ['google-calendar', 'google-workspace', 'microsoft-entra'],
  github: ['github'],
  slack: ['slack'],
  jira: ['jira', 'atlassian'],
  notion: ['notion'],
  linear: ['linear'],
  outlook: ['microsoft-entra', 'm365'],
  m365: ['microsoft-entra', 'm365'],
  microsoft: ['microsoft-entra', 'm365'],
  salesforce: ['salesforce'],
  hubspot: ['hubspot'],
  sap: ['sap'],
  servicenow: ['servicenow'],
  workday: ['workday'],
};

/** Content-kind terms → UDM entity kinds. */
const KIND_TERMS: Record<string, string[]> = {
  email: ['message', 'conversation'],
  emails: ['message', 'conversation'],
  mail: ['message', 'conversation'],
  message: ['message'],
  messages: ['message'],
  document: ['document', 'file'],
  documents: ['document', 'file'],
  doc: ['document'],
  docs: ['document'],
  file: ['file', 'attachment'],
  files: ['file', 'attachment'],
  contract: ['document', 'file'],
  contracts: ['document', 'file'],
  attachment: ['attachment'],
  attachments: ['attachment'],
  meeting: ['calendar_event', 'event'],
  meetings: ['calendar_event', 'event'],
  event: ['calendar_event', 'event'],
  events: ['calendar_event', 'event'],
  task: ['task'],
  tasks: ['task'],
  issue: ['task'],
  issues: ['task'],
  pr: ['task'],
  prs: ['task'],
  'pull request': ['task'],
  'pull requests': ['task'],
  project: ['project'],
  projects: ['project'],
  contact: ['contact'],
  contacts: ['contact'],
};

/** App-record terms → record feeds. */
const RECORD_TERMS: Record<string, RecordKind> = {
  decision: 'decisions',
  decisions: 'decisions',
  workflow: 'workflows',
  workflows: 'workflows',
  automation: 'workflows',
  automations: 'workflows',
  connector: 'connectors',
  connectors: 'connectors',
  integration: 'connectors',
  integrations: 'connectors',
  workspace: 'workspaces',
  workspaces: 'workspaces',
  app: 'apps',
  apps: 'apps',
  session: 'executions',
  sessions: 'executions',
  execution: 'executions',
  executions: 'executions',
  people: 'people',
  person: 'people',
};

/** ERP/business record terms → module search terms (matched against real module names). */
const MODULE_TERMS = [
  'invoice', 'invoices', 'payment', 'payments', 'quote', 'quotes', 'order', 'orders',
  'customer', 'customers', 'lead', 'leads', 'supplier', 'suppliers', 'purchase',
  'inventory', 'product', 'products', 'shipment', 'shipments',
];

const DAY_MS = 24 * 60 * 60 * 1000;

interface Extraction {
  /** The matched phrase; stripped from the residual text when `strip` is true. */
  match: string;
  /** Remove the match from the retrieval text (routing-only words) or keep it (subject words). */
  strip: boolean;
  note: string;
  apply: (plan: MutablePlan) => void;
}

/** Extracted terms that are ALSO the subject of the search — never stripped. */
const KEEP_IN_TEXT = new Set<string>([
  'contract', 'contracts', ...MODULE_TERMS,
]);

type MutablePlan = {
  entityKinds: Set<string>;
  connectorIds: Set<string>;
  recordKinds: Set<RecordKind>;
  engineSources: Set<EngineSourceKey>;
  sources: Set<PipelineSourceKey>;
  moduleTerms: Set<string>;
  since: number | null;
  until: number | null;
  person: string | null;
  flags: SearchPlanFlags;
};

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** Relative-date vocabulary → [since, until] epoch ms (inclusive). */
function dateRange(term: string, now: Date): { since: number | null; until: number | null } | null {
  const today = startOfDay(now);
  switch (term) {
    case 'today':
      return { since: today, until: null };
    case 'yesterday':
      return { since: today - DAY_MS, until: today - 1 };
    case 'this week':
      return { since: today - 6 * DAY_MS, until: null };
    case 'last week':
      return { since: today - 13 * DAY_MS, until: today - 6 * DAY_MS };
    case 'this month':
      return { since: today - 29 * DAY_MS, until: null };
    case 'last month':
      return { since: today - 59 * DAY_MS, until: today - 29 * DAY_MS };
    case 'recent':
    case 'recently':
      return { since: today - 6 * DAY_MS, until: null };
    default:
      return null;
  }
}

/** Escape a string for use inside a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Plan a natural-language query. Pure and deterministic; `now` is injectable
 * for tests. Unknown words simply stay in the retrieval text — the planner
 * only ever NARROWS routing, it never invents filters.
 */
export function planSearch(raw: string, now: Date = new Date()): SearchPlan {
  const explain: string[] = [];
  const p: MutablePlan = {
    entityKinds: new Set(),
    connectorIds: new Set(),
    recordKinds: new Set(),
    engineSources: new Set(),
    sources: new Set(),
    moduleTerms: new Set(),
    since: null,
    until: null,
    person: null,
    flags: {},
  };

  let working = raw.trim();

  // 1) Quoted exact phrases.
  const phrases: string[] = [];
  working = working.replace(/["“”]([^"“”]{2,120})["“”]/g, (_m, phrase: string) => {
    phrases.push(phrase.trim());
    return ` ${phrase} `; // keep the words for retrieval; exactness enforced by post-filter
  });
  if (phrases.length > 0) explain.push(`exact phrase${phrases.length > 1 ? 's' : ''}: ${phrases.map((s) => `“${s}”`).join(', ')}`);

  // 2) Filler that adds nothing to retrieval ("find", "show me", "search for"…).
  working = working
    .replace(/\b(find|show|search|locate|list|get|open)\b(\s+(me|all|every|any))?\s*/gi, ' ')
    .replace(/\b(for|the|a|an|in|on|of|from|with|about|mentioning|containing|discussing|using|involving)\b/gi, (m) => ` ${m} `);

  const lower = () => working.toLowerCase();

  // 3) Relative dates (longest terms first so "last week" wins over "week").
  for (const term of ['last week', 'this week', 'last month', 'this month', 'yesterday', 'today', 'recently', 'recent']) {
    const at = lower().indexOf(term);
    if (at < 0) continue;
    // "today's" / "yesterday's" possessives too.
    const range = dateRange(term, now);
    if (!range) continue;
    p.since = range.since;
    p.until = range.until;
    explain.push(`time: ${term}`);
    working = working.replace(new RegExp(`${reEscape(term)}(?:'s|’s)?`, 'i'), ' ');
    break; // one time filter
  }

  const extractions: Extraction[] = [];

  // 4) Connector mentions (multi-word aliases first).
  const aliasKeys = Object.keys(CONNECTOR_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliasKeys) {
    if (!new RegExp(`\\b${reEscape(alias)}\\b`, 'i').test(working)) continue;
    extractions.push({
      match: alias,
      strip: true,
      note: `source: ${alias}`,
      apply: (plan) => {
        for (const id of CONNECTOR_ALIASES[alias] ?? []) plan.connectorIds.add(id);
        // Filters the entity retrieval; deliberately does NOT narrow the other
        // engine indexes — memory/timeline/graph still answer for the text.
        plan.sources.add('engine');
      },
    });
  }

  // 5) Content-kind terms (multi-word first: "pull requests").
  const kindKeys = Object.keys(KIND_TERMS).sort((a, b) => b.length - a.length);
  for (const term of kindKeys) {
    if (!new RegExp(`\\b${reEscape(term)}\\b`, 'i').test(working)) continue;
    extractions.push({
      match: term,
      strip: !KEEP_IN_TEXT.has(term),
      note: `kind: ${term}`,
      apply: (plan) => {
        for (const k of KIND_TERMS[term] ?? []) plan.entityKinds.add(k);
        // Kind terms filter entity retrieval without excluding the other indexes.
        plan.sources.add('engine');
      },
    });
  }

  // 6) App-record terms.
  for (const term of Object.keys(RECORD_TERMS)) {
    if (!new RegExp(`\\b${reEscape(term)}\\b`, 'i').test(working)) continue;
    const kind = RECORD_TERMS[term] as RecordKind;
    extractions.push({
      match: term,
      strip: true,
      note: `records: ${kind}`,
      apply: (plan) => {
        plan.recordKinds.add(kind);
        plan.sources.add('records');
      },
    });
  }

  // 7) ERP module terms ("invoices", "customers"…) — routed to the existing
  //    per-module record search, matched against real module names at run time.
  for (const term of MODULE_TERMS) {
    if (!new RegExp(`\\b${reEscape(term)}\\b`, 'i').test(working)) continue;
    const singular = term.endsWith('s') ? term.slice(0, -1) : term;
    extractions.push({
      match: term,
      strip: false, // module terms are also the retrieval subject
      note: `business records: ${singular}`,
      apply: (plan) => {
        plan.moduleTerms.add(singular);
        plan.sources.add('modules');
      },
    });
  }

  // 8) Status flags.
  if (/\bfail(ed|ing|ures?)?\b/i.test(working)) {
    extractions.push({ match: '', strip: false, note: 'status: failed', apply: (plan) => { plan.flags.failed = true; } });
  }
  if (/\bunread\b/i.test(working)) {
    extractions.push({ match: 'unread', strip: true, note: 'status: unread (best-effort)', apply: (plan) => { plan.flags.unread = true; } });
  }

  // 9) People: "assigned to X", "involving X", "with X", "by X" (capitalized name or 'me').
  const personMatch = working.match(/\b(?:assigned to|involving|owned by|by|with)\s+(me|[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/);
  if (personMatch) {
    const who = (personMatch[1] ?? '').trim();
    if (who.toLowerCase() === 'me') {
      p.flags.mine = true;
      explain.push("person: me (account resolution arrives in a later stage — showing all matches)");
    } else if (who) {
      p.person = who;
      explain.push(`person: ${who}`);
      working = working.replace(personMatch[0], ` ${who} `); // keep the name for retrieval
    }
  }

  // Apply extractions, note them, and strip routing-only words from the text.
  for (const ex of extractions) {
    ex.apply(p);
    explain.push(ex.note);
    if (ex.strip && ex.match) {
      working = working.replace(new RegExp(`\\b${reEscape(ex.match)}\\b`, 'gi'), ' ');
    }
  }

  // "memory/timeline/knowledge" hints narrow engine sources.
  if (/\b(memor(y|ies)|remember(ed)?)\b/i.test(raw)) { p.engineSources.add('memory'); p.sources.add('engine'); explain.push('index: AI memory'); }
  if (/\b(timeline|activity|events?)\b/i.test(raw)) { p.engineSources.add('timeline'); p.sources.add('engine'); explain.push('index: timeline'); }
  if (/\b(graph|related|relationship)\b/i.test(raw)) { p.engineSources.add('graph'); p.sources.add('engine'); explain.push('index: knowledge graph'); }

  // 10) Residual retrieval text — routing words removed, stopword-ish glue dropped.
  const text = working
    .replace(/\b(for|the|a|an|in|on|of|from|with|about|mentioning|containing|discussing|using|involving|me|my|all|every|any|assigned|to)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0 && (p.recordKinds.size > 0 || p.moduleTerms.size > 0)) {
    explain.push('browsing (no free text) — showing the most recent matches');
  }

  return {
    raw,
    text,
    phrases,
    entityKinds: p.entityKinds.size > 0 ? [...p.entityKinds] : null,
    connectorIds: p.connectorIds.size > 0 ? [...p.connectorIds] : null,
    recordKinds: p.recordKinds.size > 0 ? [...p.recordKinds] : null,
    engineSources: p.engineSources.size > 0 ? [...p.engineSources] : null,
    sources: p.sources.size > 0 ? [...p.sources] : null,
    moduleTerms: [...p.moduleTerms],
    since: p.since,
    until: p.until,
    person: p.person,
    flags: p.flags,
    explain,
  };
}
