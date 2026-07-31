/**
 * Phase 6 Stage 3 — Universal Search pipeline (pure orchestration; D-1).
 *
 * Runs a `ResolvedPlan` across the EXISTING services — the federated
 * Enterprise Search engine, the app-record list IPCs, backend semantic
 * memory, and the ERP module record search — with the Stage 2 isolation
 * contract: every source runs independently, a failed/hung/malformed source
 * degrades only itself to an explicit `unavailable(reason)`, results stream
 * per source as they settle, runs are cancelable, and a small LRU cache
 * serves repeat queries. No new index, no new IPC, no main-process code.
 *
 * All I/O goes through the injected `SearchIo`, so this file is fully
 * unit-testable under node with fakes.
 */
import type { PipelineSourceKey } from './queryPlanner';
import {
  fromApp,
  fromConnector,
  fromDecision,
  fromEngineHit,
  fromExecution,
  fromModuleRecord,
  fromPerson,
  fromSection,
  fromSemanticHit,
  fromWorkflow,
  fromWorkspace,
  type ResolvedPlan,
  type UnifiedSearchItem,
} from './searchModel';

/* ── source state (same honest 3-state shape as the Stage 2 feed) ────────── */

export type SearchSourceState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; at: number; note?: string }
  | { state: 'unavailable'; reason: string };

export type SearchAvailability = Record<PipelineSourceKey, SearchSourceState>;

export const PIPELINE_SOURCES: PipelineSourceKey[] = ['engine', 'records', 'semantic', 'modules'];

export function idleAvailability(): SearchAvailability {
  return { engine: { state: 'idle' }, records: { state: 'idle' }, semantic: { state: 'idle' }, modules: { state: 'idle' } };
}

export const DEFAULT_SEARCH_TIMEOUT_MS = 8_000;
const PER_SOURCE_LIMIT = 12;
const MODULE_FANOUT_CAP = 4;

/* ── injected I/O (bound to `ipc.*` by the host; faked in tests) ─────────── */

export interface SearchIo {
  enterpriseSearch(q: { text: string; sources?: string[]; limit?: number }): Promise<unknown>;
  unifiedSearch(q: { text: string; kinds?: string[]; connectorId?: string; limit?: number }): Promise<unknown>;
  semanticRecall(text: string, limit: number): Promise<unknown>;
  decisionsList(): Promise<unknown>;
  automationsList(): Promise<unknown>;
  connectorsList(): Promise<unknown>;
  workspaceContextsList(): Promise<unknown>;
  executeSessions(): Promise<unknown>;
  executeHistory(): Promise<unknown>;
  enterpriseOrg(): Promise<unknown>;
  modulesList(): Promise<unknown>;
  moduleSearch(moduleId: string, query: string, limit: number): Promise<unknown>;
  /** Synchronous local catalogs (renderer data; no I/O). */
  listApps(): unknown[];
  listSections(): unknown[];
}

/* ── plumbing (self-contained; no imports from other feature modules) ────── */

function failureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  const msg = raw.trim() || 'unknown error';
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

type Settled = { ok: true; value: unknown } | { ok: false; reason: string };
async function settle(p: Promise<unknown>, ms: number, label: string): Promise<Settled> {
  try {
    return { ok: true, value: await withTimeout(p, ms, label) };
  } catch (err) {
    return { ok: false, reason: `${label}: ${failureReason(err)}` };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export interface SourceOutcome {
  key: PipelineSourceKey;
  ok: boolean;
  items: UnifiedSearchItem[];
  reason: string | null;
  note: string | null;
  /** Wall-clock ms for this source (real, measured). */
  ms: number;
}

/* ── per-source runners ──────────────────────────────────────────────────── */

async function runEngine(rp: ResolvedPlan, io: SearchIo, timeoutMs: number): Promise<Omit<SourceOutcome, 'ms'>> {
  const text = rp.plan.text;
  if (!text) return { key: 'engine', ok: true, items: [], reason: null, note: 'skipped — no free text to search' };

  const wantsEntityFilters = (rp.entityKinds && rp.entityKinds.length > 0) || (rp.plan.connectorIds && rp.plan.connectorIds.length > 0);
  const engineSources = rp.engineSources ?? ['entity', 'graph', 'memory', 'timeline'];
  const calls: Array<Promise<Settled>> = [];

  // Filtered entity retrieval goes through unified.search (the only entry that
  // accepts kind/connector filters); the remaining sources go through the
  // federated engine with its `sources` filter. Both are existing IPC.
  const nonEntity = engineSources.filter((s) => s !== 'entity');
  const useUnifiedForEntity = wantsEntityFilters && engineSources.includes('entity');

  if (useUnifiedForEntity) {
    const primaryConnector = rp.plan.connectorIds?.[0];
    calls.push(
      settle(
        io.unifiedSearch({
          text,
          ...(rp.entityKinds ? { kinds: rp.entityKinds } : {}),
          ...(primaryConnector ? { connectorId: primaryConnector } : {}),
          limit: PER_SOURCE_LIMIT,
        }),
        timeoutMs,
        'unified search',
      ),
    );
  }
  const engineWanted = useUnifiedForEntity ? nonEntity : engineSources;
  if (engineWanted.length > 0) {
    calls.push(settle(io.enterpriseSearch({ text, sources: engineWanted, limit: PER_SOURCE_LIMIT }), timeoutMs, 'enterprise search'));
  }

  const settled = await Promise.all(calls);
  if (settled.length > 0 && settled.every((s) => !s.ok)) {
    return { key: 'engine', ok: false, items: [], reason: (settled.find((s) => !s.ok) as { reason: string }).reason, note: null };
  }

  const items: UnifiedSearchItem[] = [];
  const failures: string[] = [];
  for (const s of settled) {
    if (!s.ok) { failures.push(s.reason); continue; }
    if (isRecord(s.value) && Array.isArray(s.value.hits) && !Array.isArray((s.value as Record<string, unknown>).groups)) {
      // unified.search result: hits carry no source tag — wrap them as entity hits.
      for (const h of asArray(s.value.hits)) {
        if (!isRecord(h)) continue;
        const mapped = fromEngineHit({ ...h, source: 'entity', snippet: h.snippet ?? null, timestamp: null, url: null });
        if (mapped) items.push(mapped);
      }
    } else if (isRecord(s.value)) {
      for (const h of asArray(s.value.hits)) {
        const mapped = fromEngineHit(h);
        if (mapped) items.push(mapped);
      }
    }
  }
  return { key: 'engine', ok: true, items, reason: null, note: failures.length > 0 ? `partial — ${failures.join('; ')}` : null };
}

async function runRecords(rp: ResolvedPlan, io: SearchIo, timeoutMs: number): Promise<Omit<SourceOutcome, 'ms'>> {
  const query = rp.plan.text;
  const kinds = rp.recordKinds ?? ['decisions', 'workflows', 'connectors', 'workspaces', 'apps', 'sections', 'executions', 'people'];
  const items: UnifiedSearchItem[] = [];
  const failures: string[] = [];
  let anyOk = false;

  const jobs: Array<{ label: string; run: () => Promise<void> }> = [];

  const push = (item: UnifiedSearchItem | null): void => { if (item) items.push(item); };

  if (kinds.includes('decisions')) jobs.push({
    label: 'decisions',
    run: async () => {
      const r = await settle(io.decisionsList(), timeoutMs, 'decisions');
      if (!r.ok) { failures.push(r.reason); return; }
      anyOk = true;
      for (const d of asArray(isRecord(r.value) ? r.value.decisions : null)) push(fromDecision(d, query));
    },
  });
  if (kinds.includes('workflows')) jobs.push({
    label: 'workflows',
    run: async () => {
      const r = await settle(io.automationsList(), timeoutMs, 'workflows');
      if (!r.ok) { failures.push(r.reason); return; }
      anyOk = true;
      for (const w of asArray(isRecord(r.value) ? r.value.rules : null)) push(fromWorkflow(w, query));
    },
  });
  if (kinds.includes('connectors')) jobs.push({
    label: 'connectors',
    run: async () => {
      const r = await settle(io.connectorsList(), timeoutMs, 'connectors');
      if (!r.ok) { failures.push(r.reason); return; }
      anyOk = true;
      for (const c of asArray(r.value)) push(fromConnector(c, query));
    },
  });
  if (kinds.includes('workspaces')) jobs.push({
    label: 'workspaces',
    run: async () => {
      const r = await settle(io.workspaceContextsList(), timeoutMs, 'workspaces');
      if (!r.ok) { failures.push(r.reason); return; }
      anyOk = true;
      for (const w of asArray(isRecord(r.value) ? r.value.workspaces : null)) push(fromWorkspace(w, query));
    },
  });
  if (kinds.includes('executions')) jobs.push({
    label: 'sessions',
    run: async () => {
      const [live, past] = await Promise.all([
        settle(io.executeSessions(), timeoutMs, 'live sessions'),
        settle(io.executeHistory(), timeoutMs, 'session history'),
      ]);
      if (!live.ok && !past.ok) { failures.push(live.reason); return; }
      anyOk = true;
      const seen = new Set<string>();
      const collect = (v: unknown, field: string): void => {
        for (const s of asArray(isRecord(v) ? v[field] : null)) {
          const mapped = fromExecution(s, query);
          if (mapped && !seen.has(mapped.key)) { seen.add(mapped.key); items.push(mapped); }
        }
      };
      if (live.ok) collect(live.value, 'sessions');
      if (past.ok) collect(past.value, 'records');
      if (!live.ok) failures.push(live.reason);
      if (!past.ok) failures.push(past.reason);
    },
  });
  if (kinds.includes('people')) jobs.push({
    label: 'people',
    run: async () => {
      const r = await settle(io.enterpriseOrg(), timeoutMs, 'organization');
      if (!r.ok) { failures.push(r.reason); return; }
      anyOk = true;
      for (const u of asArray(isRecord(r.value) ? r.value.users : null)) push(fromPerson(u, query));
    },
  });
  if (kinds.includes('apps')) jobs.push({
    label: 'apps',
    run: async () => {
      anyOk = true;
      for (const a of io.listApps()) push(fromApp(a, query));
    },
  });
  if (kinds.includes('sections')) jobs.push({
    label: 'sections',
    run: async () => {
      anyOk = true;
      for (const s of io.listSections()) push(fromSection(s, query));
    },
  });

  await Promise.all(jobs.map((j) => j.run()));

  if (!anyOk && failures.length > 0) {
    return { key: 'records', ok: false, items: [], reason: failures[0] ?? 'records unavailable', note: null };
  }
  return { key: 'records', ok: true, items, reason: null, note: failures.length > 0 ? `partial — ${failures.join('; ')}` : null };
}

async function runSemantic(rp: ResolvedPlan, io: SearchIo, timeoutMs: number): Promise<Omit<SourceOutcome, 'ms'>> {
  const text = rp.plan.text;
  if (!text) return { key: 'semantic', ok: true, items: [], reason: null, note: 'skipped — no free text to search' };
  const r = await settle(io.semanticRecall(text, PER_SOURCE_LIMIT), timeoutMs, 'semantic search');
  if (!r.ok) {
    // Honest degradation with a helpful reason (e.g. "Sign in to use semantic search.").
    return { key: 'semantic', ok: false, items: [], reason: r.reason, note: null };
  }
  const items: UnifiedSearchItem[] = [];
  const retriever = isRecord(r.value) ? str(r.value.retriever, 'semantic') : 'semantic';
  for (const h of asArray(isRecord(r.value) ? r.value.hits : null)) {
    const mapped = fromSemanticHit(h, retriever);
    if (mapped) items.push(mapped);
  }
  return { key: 'semantic', ok: true, items, reason: null, note: `retriever: ${retriever}` };
}

async function runModules(rp: ResolvedPlan, io: SearchIo, timeoutMs: number): Promise<Omit<SourceOutcome, 'ms'>> {
  const listed = await settle(io.modulesList(), timeoutMs, 'module registry');
  if (!listed.ok) return { key: 'modules', ok: false, items: [], reason: listed.reason, note: null };

  interface ModuleLite { id: string; title: string; searchText: string }
  const modules: ModuleLite[] = [];
  for (const m of asArray(listed.value)) {
    if (!isRecord(m)) continue;
    const id = str(m.id);
    const title = str(m.title, id);
    if (!id) continue;
    modules.push({ id, title, searchText: `${title} ${str(m.singular)} ${str(m.plural)} ${id}`.toLowerCase() });
  }

  // Route by the planner's module terms; otherwise (Business scope) match the
  // free text against module names. Fan out to at most MODULE_FANOUT_CAP
  // modules — and SAY so when capped (no silent truncation).
  const terms = rp.plan.moduleTerms.length > 0 ? rp.plan.moduleTerms : rp.plan.text ? [rp.plan.text] : [];
  const targets = new Map<string, ModuleLite>();
  for (const term of terms) {
    const t = term.toLowerCase();
    for (const m of modules) if (m.searchText.includes(t)) targets.set(m.id, m);
  }
  if (targets.size === 0 && rp.scope === 'business') for (const m of modules) targets.set(m.id, m);

  const all = [...targets.values()];
  const capped = all.slice(0, MODULE_FANOUT_CAP);
  const searchText = rp.plan.text || rp.plan.moduleTerms.join(' ');
  const items: UnifiedSearchItem[] = [];
  const failures: string[] = [];

  await Promise.all(
    capped.map(async (m) => {
      const r = await settle(io.moduleSearch(m.id, searchText, PER_SOURCE_LIMIT), timeoutMs, `module ${m.title}`);
      if (!r.ok) { failures.push(r.reason); return; }
      for (const rec of asArray(r.value)) {
        const mapped = fromModuleRecord(rec, m.id, m.title);
        if (mapped) items.push(mapped);
      }
    }),
  );

  if (capped.length > 0 && failures.length === capped.length) {
    return { key: 'modules', ok: false, items: [], reason: failures[0] ?? 'module search unavailable', note: null };
  }
  const notes: string[] = [];
  if (all.length > capped.length) notes.push(`searched ${capped.length} of ${all.length} matching modules`);
  if (capped.length === 0) notes.push('no matching business modules');
  if (failures.length > 0) notes.push(`partial — ${failures.join('; ')}`);
  return { key: 'modules', ok: true, items, reason: null, note: notes.length > 0 ? notes.join(' · ') : null };
}

/* ── the run: independent sources, streamed settles, cancelable ──────────── */

export interface SearchRunUpdate {
  source: PipelineSourceKey;
  state: SearchSourceState;
  items: UnifiedSearchItem[];
}

export interface SearchRunResult {
  items: UnifiedSearchItem[];
  availability: SearchAvailability;
  /** Real measured per-source wall-clock ms. */
  timings: Partial<Record<PipelineSourceKey, number>>;
  totalMs: number;
  fromCache: boolean;
}

export interface SearchRunHandle {
  done: Promise<SearchRunResult>;
  cancel: () => void;
}

const RUNNERS: Record<PipelineSourceKey, (rp: ResolvedPlan, io: SearchIo, t: number) => Promise<Omit<SourceOutcome, 'ms'>>> = {
  engine: runEngine,
  records: runRecords,
  semantic: runSemantic,
  modules: runModules,
};

/** Cache key: the parts of a resolved plan that change what a run returns. */
export function planKey(rp: ResolvedPlan): string {
  const p = rp.plan;
  return JSON.stringify([rp.scope, rp.sources, rp.engineSources, rp.entityKinds, rp.recordKinds, p.text, p.phrases, p.connectorIds, p.since, p.until, p.person, p.flags, p.moduleTerms]);
}

interface CacheEntry { result: SearchRunResult; at: number }
const CACHE_CAP = 20;
export const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function clearSearchCache(): void {
  cache.clear();
}

function cacheGet(key: string, now: number): SearchRunResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.result;
}

function cacheSet(key: string, result: SearchRunResult, now: number): void {
  cache.set(key, { result, at: now });
  if (cache.size > CACHE_CAP) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/**
 * Run the resolved plan. Sources run in PARALLEL and settle independently;
 * `onUpdate` streams each source's items + state the moment it finishes.
 * Canceling stops all further updates (in-flight IPC settles harmlessly).
 */
export function runUnifiedSearch(
  rp: ResolvedPlan,
  io: SearchIo,
  opts: { timeoutMs?: number; onUpdate?: (u: SearchRunUpdate) => void; bypassCache?: boolean } = {},
): SearchRunHandle {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  let cancelled = false;
  const startedAt = Date.now();

  const key = planKey(rp);
  if (!opts.bypassCache) {
    const cached = cacheGet(key, startedAt);
    if (cached) {
      // Serve the cache synchronously-ish: one update per ready source.
      const done = Promise.resolve().then(() => {
        if (!cancelled && opts.onUpdate) {
          for (const source of rp.sources) {
            const state = cached.availability[source];
            opts.onUpdate({ source, state, items: cached.items.filter((i) => sourceOf(i) === source) });
          }
        }
        return { ...cached, fromCache: true };
      });
      return { done, cancel: () => { cancelled = true; } };
    }
  }

  const availability = idleAvailability();
  for (const source of rp.sources) availability[source] = { state: 'loading' };
  const timings: Partial<Record<PipelineSourceKey, number>> = {};
  const collected: UnifiedSearchItem[] = [];

  const runs = rp.sources.map(async (source) => {
    const t0 = Date.now();
    let outcome: Omit<SourceOutcome, 'ms'>;
    try {
      outcome = await RUNNERS[source](rp, io, timeoutMs);
    } catch (err) {
      outcome = { key: source, ok: false, items: [], reason: failureReason(err), note: null };
    }
    const ms = Date.now() - t0;
    timings[source] = ms;
    if (cancelled) return;
    const state: SearchSourceState = outcome.ok
      ? { state: 'ready', at: Date.now(), ...(outcome.note ? { note: outcome.note } : {}) }
      : { state: 'unavailable', reason: outcome.reason ?? 'unavailable' };
    availability[source] = state;
    collected.push(...outcome.items);
    opts.onUpdate?.({ source, state, items: outcome.items });
  });

  const done = Promise.all(runs).then((): SearchRunResult => {
    const result: SearchRunResult = {
      items: collected,
      availability,
      timings,
      totalMs: Date.now() - startedAt,
      fromCache: false,
    };
    if (!cancelled) cacheSet(key, result, Date.now());
    return result;
  });

  return { done, cancel: () => { cancelled = true; } };
}

function sourceOf(item: UnifiedSearchItem): PipelineSourceKey {
  if (item.source.startsWith('engine:')) return 'engine';
  if (item.source.startsWith('semantic')) return 'semantic';
  if (item.source.startsWith('modules:')) return 'modules';
  return 'records';
}
