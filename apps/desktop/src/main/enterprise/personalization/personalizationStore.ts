/**
 * The Enterprise Personalization store — persists the per-user productization state (Favorites,
 * Recently-Opened, Saved Views) under userData. It reuses the deterministic personalization operations
 * from `@neuropause/shared` for every list mutation (dedupe / cap / order) and only adds real persistence:
 * the same atomic tmp-write + rename + debounced-drain pattern the Governance store uses. It is keyed by
 * the server-resolved actor id (never a renderer-supplied identity), so one user's state is isolated from
 * another's. Electron-free; the singleton lives in personalizationInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  clearRecents,
  deleteView,
  emptyPersonalizationState,
  normalizePersonalizationState,
  pushRecent,
  renameView,
  saveView,
  toggleFavorite,
  type FavoriteItem,
  type PersonalizationState,
  type RecentItem,
  type SavedView,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'enterprise-personalization',
  scope: 'USER',
  persistence: 'file',
  authority: 'USER',
  classification: 'USER_PREFERENCE',
  retention: "Dedupe and cap inside one actor's entry; a removal cannot reach another actor.",
  reason: "byActor is keyed on the signed-in email with NO tenant component — deliberately, because a person's pinned views follow them across organizations.",
});

const log = createLogger('enterprise-personalization');

interface PersonalizationFile {
  version: number;
  byActor: Record<string, PersonalizationState>;
}

/** A favorite / recent request from the renderer (id + display metadata; timestamps are stamped here). */
export interface PersonalizationItemInput {
  id: string;
  kind?: string;
  label?: string;
  tab: string;
  query?: string;
}
export interface SavedViewInput {
  id?: string;
  label: string;
  tab: string;
  query?: string;
  filters?: string;
}

export class PersonalizationStore extends EventEmitter {
  private byActor = new Map<string, PersonalizationState>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<PersonalizationFile>;
      const byActor = data.byActor && typeof data.byActor === 'object' ? data.byActor : {};
      for (const [actor, state] of Object.entries(byActor)) this.byActor.set(actor, normalizePersonalizationState(state));
    } catch {
      /* first run — empty */
    }
    this.loaded = true;
    log.info('Enterprise personalization ready', { actors: this.byActor.size });
  }

  private async persist(): Promise<void> {
    const file: PersonalizationFile = { version: 1, byActor: Object.fromEntries(this.byActor) };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Personalization persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /** The (normalized) personalization state for one actor — never null. */
  forActor(actorId: string): PersonalizationState {
    return this.byActor.get(actorId) ?? emptyPersonalizationState();
  }

  private apply(actorId: string, fn: (state: PersonalizationState) => PersonalizationState): PersonalizationState {
    const next = normalizePersonalizationState(fn(this.forActor(actorId)));
    this.byActor.set(actorId, next);
    this.schedulePersist();
    this.emit('changed', actorId);
    return next;
  }

  toggleFavorite(actorId: string, input: PersonalizationItemInput, now = new Date().toISOString()): PersonalizationState {
    const fav: FavoriteItem = { id: input.id, kind: input.kind || 'surface', label: input.label || input.id, tab: input.tab, query: input.query, addedAt: now };
    return this.apply(actorId, (s) => toggleFavorite(s, fav));
  }

  pushRecent(actorId: string, input: PersonalizationItemInput, now = new Date().toISOString()): PersonalizationState {
    const item: RecentItem = { id: input.id, kind: input.kind || 'surface', label: input.label || input.id, tab: input.tab, query: input.query, visitedAt: now };
    return this.apply(actorId, (s) => pushRecent(s, item));
  }

  clearRecents(actorId: string): PersonalizationState {
    return this.apply(actorId, (s) => clearRecents(s));
  }

  saveView(actorId: string, input: SavedViewInput, now = new Date().toISOString()): PersonalizationState {
    const view: SavedView = { id: input.id || `sv_${randomUUID()}`, label: input.label, tab: input.tab, query: input.query ?? '', filters: input.filters ?? '', createdAt: now };
    return this.apply(actorId, (s) => saveView(s, view));
  }

  deleteView(actorId: string, id: string): PersonalizationState {
    return this.apply(actorId, (s) => deleteView(s, id));
  }

  renameView(actorId: string, id: string, label: string): PersonalizationState {
    return this.apply(actorId, (s) => renameView(s, id, label));
  }
}
