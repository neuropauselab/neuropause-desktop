import { describe, expect, it } from 'vitest';
import {
  addFavorite,
  clearRecents,
  deleteView,
  emptyPersonalizationState,
  isFavorite,
  normalizePersonalizationState,
  pushRecent,
  rankCommandCandidates,
  removeFavorite,
  renameView,
  saveView,
  scoreCommand,
  toggleFavorite,
  type CommandCandidate,
  type FavoriteItem,
  type RecentItem,
  type SavedView,
} from '@neuropause/shared';

const fav = (id: string, over: Partial<FavoriteItem> = {}): FavoriteItem => ({ id, kind: 'surface', label: id, tab: 'executive', addedAt: '2026-07-10T00:00:00.000Z', ...over });
const recent = (id: string, visitedAt: string): RecentItem => ({ id, kind: 'surface', label: id, tab: 'trust', visitedAt });
const view = (id: string, over: Partial<SavedView> = {}): SavedView => ({ id, label: id, tab: 'relationship', query: '', filters: '', createdAt: '2026-07-10T00:00:00.000Z', ...over });

describe('Personalization — favorites', () => {
  it('toggles deterministically and dedupes by id', () => {
    let s = emptyPersonalizationState();
    s = toggleFavorite(s, fav('trust'));
    expect(isFavorite(s, 'trust')).toBe(true);
    expect(s.favorites).toHaveLength(1);
    // toggling again removes it
    s = toggleFavorite(s, fav('trust'));
    expect(isFavorite(s, 'trust')).toBe(false);
    // adding twice keeps one, most-recent first
    s = addFavorite(addFavorite(s, fav('a')), fav('b'));
    s = addFavorite(s, fav('a', { label: 'A2' }));
    expect(s.favorites.map((f) => f.id)).toEqual(['a', 'b']);
    expect(s.favorites[0].label).toBe('A2');
    s = removeFavorite(s, 'a');
    expect(s.favorites.map((f) => f.id)).toEqual(['b']);
  });
});

describe('Personalization — recents', () => {
  it('keeps most-recent-first, deduped, capped', () => {
    let s = emptyPersonalizationState();
    s = pushRecent(s, recent('a', '2026-07-01T00:00:00.000Z'));
    s = pushRecent(s, recent('b', '2026-07-02T00:00:00.000Z'));
    s = pushRecent(s, recent('a', '2026-07-03T00:00:00.000Z')); // re-visit a → moves to front, no dupe
    expect(s.recents.map((r) => r.id)).toEqual(['a', 'b']);
    // cap
    let capped = emptyPersonalizationState();
    for (let i = 0; i < 40; i += 1) capped = pushRecent(capped, recent(`r${i}`, `2026-07-10T00:00:${String(i).padStart(2, '0')}.000Z`), 25);
    expect(capped.recents).toHaveLength(25);
    expect(capped.recents[0].id).toBe('r39'); // newest first
    expect(clearRecents(capped).recents).toHaveLength(0);
  });
});

describe('Personalization — saved views', () => {
  it('saves, replaces by id, renames and deletes', () => {
    let s = emptyPersonalizationState();
    s = saveView(s, view('v1', { label: 'Late invoices', tab: 'trust', query: 'overdue' }));
    s = saveView(s, view('v2', { label: 'Critical machines' }));
    expect(s.savedViews.map((v) => v.id)).toEqual(['v2', 'v1']); // newest first
    // replace by id
    s = saveView(s, view('v1', { label: 'Late invoices v2', query: 'overdue' }));
    expect(s.savedViews.find((v) => v.id === 'v1')!.label).toBe('Late invoices v2');
    expect(s.savedViews).toHaveLength(2);
    s = renameView(s, 'v2', 'Down machines');
    expect(s.savedViews.find((v) => v.id === 'v2')!.label).toBe('Down machines');
    s = deleteView(s, 'v1');
    expect(s.savedViews.map((v) => v.id)).toEqual(['v2']);
  });
});

describe('Personalization — normalize (safe over persisted/garbage input)', () => {
  it('coerces, filters invalid, dedupes and caps', () => {
    const raw = {
      favorites: [{ id: 'a', label: 'A', tab: 'trust' }, { id: 'a', label: 'dup' }, { label: 'no-id' }, null, 42],
      recents: [{ id: 'r', tab: 'x', visitedAt: '2026-07-10' }],
      savedViews: [{ id: 'v', tab: 'trust' }, { id: 'no-tab' }],
      junk: true,
    };
    const s = normalizePersonalizationState(raw);
    expect(s.favorites.map((f) => f.id)).toEqual(['a']); // deduped, invalid dropped
    expect(s.favorites[0].kind).toBe('surface'); // defaulted
    expect(s.recents).toHaveLength(1);
    expect(s.savedViews.map((v) => v.id)).toEqual(['v']); // the one without a tab is dropped
    // fully garbage → empty, not a throw
    expect(normalizePersonalizationState(null)).toEqual(emptyPersonalizationState());
    expect(normalizePersonalizationState('nope')).toEqual(emptyPersonalizationState());
  });
});

describe('Personalization — command palette ranking', () => {
  it('scores substring, prefix and subsequence matches deterministically', () => {
    expect(scoreCommand('', 'anything')).toBe(1); // empty query = base
    expect(scoreCommand('trust', 'Trust Center')).toBeGreaterThan(scoreCommand('center', 'Trust Center')); // prefix beats mid
    expect(scoreCommand('tc', 'Trust Center')).toBeGreaterThan(0); // subsequence
    expect(scoreCommand('zzz', 'Trust Center')).toBe(0); // no match
  });

  it('ranks candidates, keeps input order on empty query', () => {
    const candidates: CommandCandidate[] = [
      { id: '1', title: 'Executive Center', tab: 'executive' },
      { id: '2', title: 'Trust Center', tab: 'trust', keywords: 'score' },
      { id: '3', title: 'Relationship Intelligence', tab: 'relationship' },
    ];
    expect(rankCommandCandidates('', candidates).map((c) => c.id)).toEqual(['1', '2', '3']);
    const trust = rankCommandCandidates('trust', candidates);
    expect(trust[0].id).toBe('2');
    expect(rankCommandCandidates('xyz', candidates)).toHaveLength(0);
    expect(rankCommandCandidates('center', candidates).map((c) => c.id)).toEqual(expect.arrayContaining(['1', '2']));
  });
});
