/**
 * Phase 6 Stage 3 — search model tests. Locks: defensive mappers (malformed
 * rows dropped, never guessed), the scope selector's routing over existing
 * indexes, plan post-filters, the explainable ranker ("Why this result?" —
 * factors, source, freshness, confidence where applicable), grouping, view
 * filters, and history helpers.
 */
import { describe, expect, it } from 'vitest';
import { planSearch } from './queryPlanner';
import {
  SEARCH_SCOPES,
  SCOPE_BY_ID,
  applyPlanFilters,
  applyScope,
  applyViewFilters,
  freshnessLabel,
  fromConnector,
  fromDecision,
  fromEngineHit,
  fromModuleRecord,
  fromSection,
  fromSemanticHit,
  fromWorkflow,
  fromWorkspace,
  groupItems,
  matchScore,
  pushSearchHistory,
  rankUnified,
  readSearchHistory,
  SEARCH_HISTORY_CAP,
  type UnifiedSearchItem,
} from './searchModel';
import { SECTION_BY_ID } from '@renderer/shell/sections';

const NOW = Date.parse('2026-07-30T12:00:00Z');
const HOUR = 3_600_000;

const engineHit = (over: Record<string, unknown> = {}): unknown => ({
  source: 'entity',
  id: 'e1',
  kind: 'document',
  title: 'Q3 contract draft',
  snippet: 'the NeuroPause contract for Q3',
  score: 0.9,
  connectorId: 'google-drive',
  timestamp: '2026-07-30T10:00:00Z',
  url: null,
  ...over,
});

describe('scope selector — routes existing indexes only', () => {
  it('defines every scope with at least one pipeline source and no duplicates', () => {
    const ids = SEARCH_SCOPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEARCH_SCOPES) expect(s.sources.length).toBeGreaterThan(0);
  });
  it('"all" lets the planner narrow sources; explicit scopes override', () => {
    const plan = planSearch('show decisions', new Date(NOW));
    expect(applyScope(plan, 'all').sources).toEqual(['records']); // planner narrowed
    expect(applyScope(plan, 'content').sources).toEqual(['engine']); // user scope wins
  });
  it('intersects plan filters with scope filters', () => {
    const plan = planSearch('emails about pricing', new Date(NOW));
    const rp = applyScope(plan, 'content');
    expect(rp.entityKinds).toEqual(expect.arrayContaining(['message']));
    expect(rp.entityKinds).not.toContain('document'); // narrowed by the plan within the scope
  });
  it('an empty intersection falls back to the scope (never zero routing)', () => {
    const plan = planSearch('emails', new Date(NOW));
    const rp = applyScope(plan, 'people'); // people scope: contact kinds
    expect(rp.entityKinds && rp.entityKinds.length).toBeTruthy();
  });
  it('business scope routes only to the module record store', () => {
    expect(SCOPE_BY_ID.business.sources).toEqual(['modules']);
  });
});

describe('mappers are defensive', () => {
  it('maps a real engine hit with source attribution', () => {
    const item = fromEngineHit(engineHit());
    expect(item).toMatchObject({ type: 'entity', title: 'Q3 contract draft', connectorId: 'google-drive', source: 'engine:entity' });
    expect(item?.explanation.source).toContain('google-drive');
  });
  it('drops malformed engine hits', () => {
    expect(fromEngineHit(null)).toBeNull();
    expect(fromEngineHit({ id: '', title: 'x', source: 'entity' })).toBeNull();
    expect(fromEngineHit('junk')).toBeNull();
  });
  it('maps semantic memory hits with the retriever named in the source', () => {
    const item = fromSemanticHit({ item: { id: 'm1', title: 'K8s decision', content: 'we chose kubernetes', kind: 'decision', occurredAt: '2026-07-29T10:00:00Z', connectorId: null }, score: 0.8 }, 'qdrant');
    expect(item?.type).toBe('memory');
    expect(item?.explanation.source).toContain('qdrant');
  });
  it('maps decisions/workflows/connectors/workspaces/sections/modules and filters by query', () => {
    expect(fromDecision({ id: 'd1', title: 'Adopt Finance policy', description: 'quarterly', status: 'pending', createdAt: '2026-07-01T00:00:00Z' }, 'finance')?.type).toBe('decision');
    expect(fromDecision({ id: 'd1', title: 'Unrelated', description: '', status: 'pending' }, 'zzz-no-match')).toBeNull();
    expect(fromWorkflow({ id: 'w1', name: 'Slack alert', description: '', actions: [{ type: 'notify_slack' }], status: 'active' }, 'slack')?.type).toBe('workflow');
    expect(fromConnector({ id: 'github', name: 'GitHub', lifecycle: 'production', status: 'connected', health: 'healthy', accounts: [{}] }, 'github')?.type).toBe('connector');
    expect(fromConnector({ id: 'notion', name: 'Notion', lifecycle: 'preview' }, 'notion')).toBeNull(); // preview never fabricated
    expect(fromWorkspace({ id: 'ws1', name: 'Research', snapshot: { tabs: [{ title: 'Notes' }] } }, 'research')?.type).toBe('workspace');
    expect(fromSection({ id: 'memory', label: 'AI Memory' }, 'memory')?.type).toBe('section');
    expect(fromSection({ id: 'home', label: 'Home', hidden: true }, 'home')).toBeNull(); // hidden sections never leak
    expect(fromModuleRecord({ id: 'inv1', title: 'INV-0042', status: 'open', updatedAt: '2026-07-30T09:00:00Z' }, 'finance.invoice', 'Invoices')?.type).toBe('business');
  });
});

// Gate 12 (round 57): `enterprise` + `marketplace` were demoted to the Advanced
// disclosure, justified as "placement only — still reachable via the command
// palette AND universal search." Universal search reaches a section through
// `fromSection`, which drops ONLY `hidden` (never `tier`/`preview`). Pin that
// against the REAL registry so a future tier/preview filter on the search mapper
// — which would silently break the demoted surfaces' reachability — fails here.
describe('Gate 12 — demoted preview sections stay reachable via universal search (real registry)', () => {
  it('advanced + preview sections (enterprise, marketplace) still map to a section hit', () => {
    const enterprise = SECTION_BY_ID.enterprise;
    const marketplace = SECTION_BY_ID.marketplace;
    // Guard the premise so this cannot pass vacuously if the registry changes.
    expect(enterprise.tier).toBe('advanced');
    expect(enterprise.preview).toBe(true);
    expect(marketplace.tier).toBe('advanced');
    expect(marketplace.preview).toBe(true);
    // The real defs flow through the real mapper to a real section hit.
    expect(fromSection(enterprise, enterprise.label)?.id).toBe('enterprise');
    expect(fromSection(enterprise, enterprise.label)?.type).toBe('section');
    expect(fromSection(marketplace, marketplace.label)?.id).toBe('marketplace');
  });

  it('a REAL hidden section is never a search target (negative control: control-plane)', () => {
    const cp = SECTION_BY_ID['control-plane'];
    expect(cp.hidden).toBe(true); // premise guard
    expect(fromSection(cp, cp.label)).toBeNull();
  });
});

describe('plan post-filters', () => {
  const items = [
    fromEngineHit(engineHit({ id: 'a', title: 'NeuroPause contract', timestamp: '2026-07-30T10:00:00Z' })),
    fromEngineHit(engineHit({ id: 'b', title: 'Old memo', timestamp: '2026-06-01T10:00:00Z', connectorId: 'slack' })),
  ].filter((i): i is UnifiedSearchItem => i !== null);

  it('applies since/until and reports what was dropped', () => {
    const plan = { ...planSearch('x', new Date(NOW)), since: NOW - 24 * HOUR, until: null };
    const out = applyPlanFilters(items, plan);
    expect(out.kept.map((i) => i.id)).toEqual(['a']);
    expect(out.dropped).toBe(1);
    expect(out.notes.join(' ')).toContain('time filter');
  });
  it('applies connector and phrase filters', () => {
    const plan = { ...planSearch('x', new Date(NOW)), connectorIds: ['google-drive'], phrases: ['NeuroPause'] };
    const out = applyPlanFilters(items, plan);
    expect(out.kept.map((i) => i.id)).toEqual(['a']);
  });
  it('person filter matches against the match text', () => {
    const plan = { ...planSearch('x', new Date(NOW)), person: 'memo' };
    expect(applyPlanFilters(items, plan).kept.map((i) => i.id)).toEqual(['b']);
  });
});

describe('explainable ranking — "Why this result?"', () => {
  it('every ranked item carries factors, source, freshness, confidence', () => {
    const items = [fromEngineHit(engineHit())].filter((i): i is UnifiedSearchItem => i !== null);
    const [ranked] = rankUnified(items, { queryText: 'contract', now: NOW });
    expect(ranked).toBeDefined();
    expect(ranked!.explanation.factors.length).toBeGreaterThanOrEqual(2); // relevance + title/recency
    expect(ranked!.explanation.factors.map((f) => f.label).join(' ')).toMatch(/relevance/i);
    expect(ranked!.explanation.source).toContain('Unified Data Model');
    expect(ranked!.explanation.freshness).toMatch(/ago/);
    expect(ranked!.explanation.confidence).toBe('high');
    expect(ranked!.score).toBeGreaterThan(0);
    expect(ranked!.score).toBeLessThanOrEqual(1);
  });
  it('recency lifts newer items of equal relevance — and says so', () => {
    const fresh = fromEngineHit(engineHit({ id: 'new', title: 'contract now', timestamp: new Date(NOW - HOUR).toISOString(), score: 0.5 }));
    const stale = fromEngineHit(engineHit({ id: 'old', title: 'contract then', timestamp: '2026-05-01T00:00:00Z', score: 0.5 }));
    const ranked = rankUnified([stale!, fresh!], { queryText: 'contract', now: NOW });
    expect(ranked[0]!.id).toBe('new');
    expect(ranked[0]!.explanation.factors.some((f) => f.label === 'Recency')).toBe(true);
  });
  it('pinned results are boosted with an explicit factor', () => {
    const a = fromEngineHit(engineHit({ id: 'a', score: 0.5 }));
    const b = fromEngineHit(engineHit({ id: 'b', score: 0.5 }));
    const ranked = rankUnified([a!, b!], { queryText: 'contract', now: NOW, pinnedKeys: new Set([b!.key]) });
    expect(ranked[0]!.id).toBe('b');
    expect(ranked[0]!.explanation.factors.some((f) => f.label === 'Pinned by you')).toBe(true);
  });
  it('navigational hits (sections/apps) carry NO confidence claim (not applicable)', () => {
    const section = fromSection({ id: 'memory', label: 'AI Memory' }, 'memory');
    const [ranked] = rankUnified([section!], { queryText: 'memory', now: NOW });
    expect(ranked!.explanation.confidence).toBeNull();
  });
  it('undated items say so instead of faking freshness', () => {
    const section = fromSection({ id: 'memory', label: 'AI Memory' }, 'memory');
    const [ranked] = rankUnified([section!], { queryText: 'memory', now: NOW });
    expect(ranked!.explanation.freshness).toBeNull();
  });
});

describe('grouping, view filters, history, misc', () => {
  it('groups by type with the best group first', () => {
    const a = fromEngineHit(engineHit({ id: 'a', score: 0.9 }));
    const w = fromWorkflow({ id: 'w1', name: 'contract sync', description: '', actions: [], status: 'active' }, 'contract');
    const ranked = rankUnified([a!, w!], { queryText: 'contract', now: NOW });
    const groups = groupItems(ranked);
    expect(groups.length).toBe(2);
    expect(groups[0]!.items[0]!.score).toBeGreaterThanOrEqual(groups[1]!.items[0]!.score);
  });
  it('view filters narrow by type and date, and sort by newest', () => {
    const a = fromEngineHit(engineHit({ id: 'a', timestamp: new Date(NOW - HOUR).toISOString() }));
    const b = fromEngineHit(engineHit({ id: 'b', timestamp: '2026-06-01T00:00:00Z' }));
    const ranked = rankUnified([a!, b!], { queryText: 'contract', now: NOW });
    expect(applyViewFilters(ranked, { date: '7d', now: NOW }).map((i) => i.id)).toEqual(['a']);
    expect(applyViewFilters(ranked, { sort: 'newest', now: NOW })[0]!.id).toBe('a');
    expect(applyViewFilters(ranked, { types: new Set(['workflow']), now: NOW })).toEqual([]);
  });
  it('matchScore orders exact > prefix > substring > subsequence > none', () => {
    expect(matchScore('inv', 'inv')).toBeGreaterThan(matchScore('inv', 'invoice'));
    expect(matchScore('inv', 'invoice')).toBeGreaterThan(matchScore('inv', 'my invoice'));
    expect(matchScore('ivc', 'invoice')).toBeGreaterThan(0);
    expect(matchScore('xyz', 'invoice')).toBe(0);
  });
  it('freshnessLabel renders hours/days and null for missing timestamps', () => {
    expect(freshnessLabel(NOW - 2 * HOUR, NOW)).toContain('2 h ago');
    expect(freshnessLabel(NOW - 3 * 24 * HOUR, NOW)).toContain('3 d ago');
    expect(freshnessLabel(null, NOW)).toBeNull();
  });
  it('history dedupes case-insensitively, caps, and survives a corrupt pref', () => {
    let h = pushSearchHistory([], 'Contracts');
    h = pushSearchHistory(h, 'contracts');
    expect(h).toEqual(['contracts']);
    for (let i = 0; i < 30; i++) h = pushSearchHistory(h, `q${i}`);
    expect(h.length).toBe(SEARCH_HISTORY_CAP);
    expect(readSearchHistory(() => 'corrupt' as never)).toEqual([]);
    expect(readSearchHistory(() => ['a', 3, ''] as never)).toEqual(['a']);
  });
});
