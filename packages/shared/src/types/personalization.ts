/**
 * Enterprise Workspace Personalization — the deterministic core for the per-user productization layer:
 * Favorites (pinned surfaces / saved views / records), Recently-Opened, and Saved Views (a captured
 * {tab, query, filters} snapshot). Pure + deterministic (the clock is injected, never read here) so the
 * same operations run identically in the persisted backend store, the renderer, and the tests. It also
 * provides the command-palette filter/ranker used to surface these into the EXISTING command palette.
 *
 * This owns no I/O and duplicates nothing: the backend `personalizationStore` applies these operations to
 * a per-actor document persisted under userData, and the renderer applies the same normalization when it
 * reads the document back. All list operations dedupe by id, cap deterministically, and preserve order.
 */

/* ── item shapes ─────────────────────────────────────────────────────────────────── */

export interface FavoriteItem {
  id: string;
  /** What the favorite points at — an enterprise tab, a saved view, or (future) a record. */
  kind: string;
  label: string;
  /** The enterprise surface this navigates to. */
  tab: string;
  /** Optional search query to restore on navigation. */
  query?: string;
  addedAt: string;
}
export interface RecentItem {
  id: string;
  kind: string;
  label: string;
  tab: string;
  query?: string;
  visitedAt: string;
}
export interface SavedView {
  id: string;
  label: string;
  tab: string;
  query: string;
  /** Opaque per-surface filter snapshot (JSON string), restored by the owning panel. */
  filters: string;
  createdAt: string;
}
export interface PersonalizationState {
  favorites: FavoriteItem[];
  recents: RecentItem[];
  savedViews: SavedView[];
}

/* ── deterministic caps ──────────────────────────────────────────────────────────── */

export const FAVORITES_CAP = 100;
export const RECENTS_CAP = 25;
export const SAVED_VIEWS_CAP = 50;

/* ── coercion + normalization (safe to run over anything read from disk) ───────────── */

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const optStr = (v: unknown): string | undefined => { const s = str(v); return s === '' ? undefined : s; };

export function emptyPersonalizationState(): PersonalizationState {
  return { favorites: [], recents: [], savedViews: [] };
}

function normFavorite(v: unknown): FavoriteItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return { id, kind: str(o.kind) || 'surface', label: str(o.label) || id, tab: str(o.tab), query: optStr(o.query), addedAt: str(o.addedAt) };
}
function normRecent(v: unknown): RecentItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return { id, kind: str(o.kind) || 'surface', label: str(o.label) || id, tab: str(o.tab), query: optStr(o.query), visitedAt: str(o.visitedAt) };
}
function normView(v: unknown): SavedView | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const tab = str(o.tab);
  if (!id || !tab) return null;
  return { id, label: str(o.label) || id, tab, query: str(o.query), filters: str(o.filters), createdAt: str(o.createdAt) };
}
function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) { const k = key(it); if (k && !seen.has(k)) { seen.add(k); out.push(it); } }
  return out;
}

/** Coerce arbitrary (possibly persisted/partial) input into a valid, capped, deduped state. Pure. */
export function normalizePersonalizationState(raw: unknown): PersonalizationState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const favorites = dedupeBy((Array.isArray(o.favorites) ? o.favorites : []).map(normFavorite).filter((x): x is FavoriteItem => x !== null), (f) => f.id).slice(0, FAVORITES_CAP);
  const recents = dedupeBy((Array.isArray(o.recents) ? o.recents : []).map(normRecent).filter((x): x is RecentItem => x !== null), (r) => r.id).slice(0, RECENTS_CAP);
  const savedViews = dedupeBy((Array.isArray(o.savedViews) ? o.savedViews : []).map(normView).filter((x): x is SavedView => x !== null), (v) => v.id).slice(0, SAVED_VIEWS_CAP);
  return { favorites, recents, savedViews };
}

/* ── favorites ───────────────────────────────────────────────────────────────────── */

export function isFavorite(state: PersonalizationState, id: string): boolean {
  return state.favorites.some((f) => f.id === id);
}
export function addFavorite(state: PersonalizationState, fav: FavoriteItem): PersonalizationState {
  if (!fav.id) return state;
  const favorites = [fav, ...state.favorites.filter((f) => f.id !== fav.id)].slice(0, FAVORITES_CAP);
  return { ...state, favorites };
}
export function removeFavorite(state: PersonalizationState, id: string): PersonalizationState {
  return { ...state, favorites: state.favorites.filter((f) => f.id !== id) };
}
/** Toggle a favorite on/off deterministically (add carries its own timestamp). Pure. */
export function toggleFavorite(state: PersonalizationState, fav: FavoriteItem): PersonalizationState {
  return isFavorite(state, fav.id) ? removeFavorite(state, fav.id) : addFavorite(state, fav);
}

/* ── recently-opened ─────────────────────────────────────────────────────────────── */

/** Record a visit — most-recent-first, deduped by id, capped. Pure. */
export function pushRecent(state: PersonalizationState, item: RecentItem, cap: number = RECENTS_CAP): PersonalizationState {
  if (!item.id) return state;
  const recents = [item, ...state.recents.filter((r) => r.id !== item.id)].slice(0, cap);
  return { ...state, recents };
}
export function clearRecents(state: PersonalizationState): PersonalizationState {
  return { ...state, recents: [] };
}

/* ── saved views ─────────────────────────────────────────────────────────────────── */

/** Save (or replace, by id) a view — most-recent-first, capped. Pure. */
export function saveView(state: PersonalizationState, view: SavedView, cap: number = SAVED_VIEWS_CAP): PersonalizationState {
  if (!view.id || !view.tab) return state;
  const savedViews = [view, ...state.savedViews.filter((v) => v.id !== view.id)].slice(0, cap);
  return { ...state, savedViews };
}
export function deleteView(state: PersonalizationState, id: string): PersonalizationState {
  return { ...state, savedViews: state.savedViews.filter((v) => v.id !== id) };
}
export function renameView(state: PersonalizationState, id: string, label: string): PersonalizationState {
  const next = label.trim();
  if (!next) return state;
  return { ...state, savedViews: state.savedViews.map((v) => (v.id === id ? { ...v, label: next } : v)) };
}

/* ── command-palette filter + ranker (deterministic; surfaces personalization + nav) ── */

export interface CommandCandidate {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  group?: string;
  tab: string;
  query?: string;
}

/**
 * Deterministic command score: 0 = no match. Requires a subsequence match of the (lowercased) query in
 * the searchable text; rewards contiguous substrings, prefixes, and word-boundary starts. An empty query
 * yields a positive base score so the palette shows everything in its provided order.
 */
export function scoreCommand(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q === '') return 1;
  if (t === '') return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) {
    // Contiguous substring match: strong. Prefix / word-boundary bonuses.
    let score = 100 - Math.min(40, idx);
    if (idx === 0) score += 50;
    else if (t[idx - 1] === ' ' || t[idx - 1] === '-' || t[idx - 1] === '/') score += 25;
    score += Math.max(0, 20 - (t.length - q.length)); // reward tight matches
    return score;
  }
  // Subsequence fallback (fuzzy): every query char appears in order.
  let ti = 0;
  let matched = 0;
  let streak = 0;
  let bonus = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    let found = false;
    while (ti < t.length) {
      if (t[ti] === q[qi]) { matched += 1; streak += 1; bonus += streak; ti += 1; found = true; break; }
      streak = 0;
      ti += 1;
    }
    if (!found) return 0;
  }
  return matched === q.length ? 20 + bonus : 0;
}

/** Rank + filter command candidates for the palette. Empty query keeps input order; else score desc. Pure. */
export function rankCommandCandidates(query: string, candidates: CommandCandidate[], limit = 20): CommandCandidate[] {
  const q = query.trim();
  if (q === '') return candidates.slice(0, limit);
  const scored = candidates
    .map((c, i) => ({ c, i, s: scoreCommand(q, `${c.title} ${c.subtitle ?? ''} ${c.keywords ?? ''}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.c);
}
