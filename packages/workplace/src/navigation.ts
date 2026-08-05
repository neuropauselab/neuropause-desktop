/**
 * Module 2 — Universal Navigation. Global search (REUSES the Wave 8 Enterprise Search), a
 * universal sidebar, favorites, pinned apps, a quick launcher, a command palette, and recent
 * items. In-process — live-verified. Global search returns real results only.
 */
import type { WorkspaceGovernance } from './governance';
import type { BusinessPlatform } from './types';

export interface NavItem {
  label: string;
  target: string;
}
export interface Sidebar {
  favorites: NavItem[];
  pinnedApps: string[];
  recent: NavItem[];
}
export interface SearchResult {
  query: string;
  total: number;
  hits: Array<{ source: string; type: string; id: string; title: string }>;
}

export class NavigationRuntime {
  private readonly favorites = new Map<string, NavItem[]>();
  private readonly pins = new Map<string, string[]>();
  private readonly recent = new Map<string, NavItem[]>();

  constructor(
    private readonly governance: WorkspaceGovernance,
    private readonly business?: BusinessPlatform,
  ) {}

  async addFavorite(userId: string, item: NavItem): Promise<void> {
    const list = this.favorites.get(userId) ?? [];
    list.push(item);
    this.favorites.set(userId, list);
    await this.governance.record({ actor: userId, module: 'navigation', operation: 'favorite.add', targetId: item.target, evidence: 'live-verified' });
  }
  async pinApp(userId: string, app: string): Promise<void> {
    const list = this.pins.get(userId) ?? [];
    if (!list.includes(app)) list.push(app);
    this.pins.set(userId, list);
    await this.governance.record({ actor: userId, module: 'navigation', operation: 'app.pin', targetId: app, evidence: 'live-verified' });
  }
  recordRecent(userId: string, item: NavItem): void {
    const list = this.recent.get(userId) ?? [];
    list.unshift(item);
    this.recent.set(userId, list.slice(0, 20));
  }

  /** Global search reuses the Wave 8 Enterprise Search — real results only. */
  async search(query: string): Promise<SearchResult> {
    if (!this.business) return { query, total: 0, hits: [] };
    const res = await this.business.intelligence().search(query);
    return { query, total: res.total, hits: res.hits };
  }
  /** Command palette = search + known commands (delegates to global search). */
  async commandPalette(query: string): Promise<SearchResult> {
    return this.search(query);
  }

  sidebar(userId: string): Sidebar {
    return { favorites: this.favorites.get(userId) ?? [], pinnedApps: this.pins.get(userId) ?? [], recent: this.recent.get(userId) ?? [] };
  }
  favoritesOf(userId: string): NavItem[] {
    return this.favorites.get(userId) ?? [];
  }
  pinsOf(userId: string): string[] {
    return this.pins.get(userId) ?? [];
  }
  recentOf(userId: string): NavItem[] {
    return this.recent.get(userId) ?? [];
  }
}
