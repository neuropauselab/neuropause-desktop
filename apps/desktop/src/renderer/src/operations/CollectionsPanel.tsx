import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { RegistryEntryDto } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { useShell } from '@renderer/state/ShellProvider';
import { useOperations } from './OperationsProvider';
import { OpsPanel } from './primitives';
import { glyphFor, toneFor } from './lib';

/**
 * A target a collection set can be synchronized to. Defined now so the sync
 * surface is typed and ready; cloud sync is intentionally not implemented yet.
 */
export interface CollectionSyncTarget {
  id: string;
  label: string;
  push(snapshot: CollectionsStore): Promise<void>;
  pull(): Promise<CollectionsStore>;
}

interface CollectionsStore {
  custom: { id: string; label: string }[];
  assignments: Record<string, string[]>;
  tags: Record<string, string[]>;
}

interface SmartDef {
  id: string;
  label: string;
  icon: IconName;
  match: (a: RegistryEntryDto) => boolean;
}

const SMART: SmartDef[] = [
  { id: 'favorites', label: 'Favorites', icon: 'star-fill', match: (a) => a.favorite },
  { id: 'pinned', label: 'Pinned', icon: 'pin', match: (a) => a.pinned },
  { id: 'agents', label: 'AI Agents', icon: 'sparkles', match: (a) => a.appType === 'ai_agent' },
  { id: 'mcp', label: 'MCP Servers', icon: 'server', match: (a) => a.appType === 'mcp_server' },
  { id: 'models', label: 'Local Models', icon: 'cpu', match: (a) => a.appType === 'native' },
];

const SEED: CollectionsStore = {
  custom: [
    { id: 'development', label: 'Development' },
    { id: 'research', label: 'Research' },
    { id: 'business', label: 'Business' },
    { id: 'marketing', label: 'Marketing' },
  ],
  assignments: {},
  tags: {},
};

export function CollectionsPanel(): JSX.Element {
  const { setSection } = useShell();
  const { registry, setFlags } = useOperations();
  const [store, setStore] = useState<CollectionsStore>(() => prefs.read<CollectionsStore>(PrefKey.collections, SEED));
  const [selected, setSelected] = useState<string>('favorites');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [tagFor, setTagFor] = useState<string | null>(null);
  const [tagText, setTagText] = useState('');

  useEffect(() => {
    prefs.write(PrefKey.collections, store);
  }, [store]);

  const isSmart = SMART.some((s) => s.id === selected);
  const selectedLabel = isSmart
    ? (SMART.find((s) => s.id === selected)?.label ?? '')
    : (store.custom.find((c) => c.id === selected)?.label ?? '');

  const apps = useMemo(() => {
    let list: RegistryEntryDto[];
    const smart = SMART.find((s) => s.id === selected);
    if (smart) list = registry.filter(smart.match);
    else list = registry.filter((a) => store.assignments[selected]?.includes(a.slug));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || (store.tags[a.slug] ?? []).some((t) => t.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : (b.lastLaunchedAt ?? '').localeCompare(a.lastLaunchedAt ?? ''),
    );
  }, [registry, selected, store, query, sort]);

  const assignTo = (collectionId: string, slug: string): void => {
    if (collectionId === 'favorites') return void setFlags(slug, { favorite: true });
    if (collectionId === 'pinned') return void setFlags(slug, { pinned: true });
    if (SMART.some((s) => s.id === collectionId)) return; // type-based smart collections aren't manually assignable
    setStore((s) => {
      const current = s.assignments[collectionId] ?? [];
      if (current.includes(slug)) return s;
      return { ...s, assignments: { ...s.assignments, [collectionId]: [...current, slug] } };
    });
  };

  const removeFrom = (collectionId: string, slug: string): void => {
    if (collectionId === 'favorites') return void setFlags(slug, { favorite: false });
    if (collectionId === 'pinned') return void setFlags(slug, { pinned: false });
    setStore((s) => ({ ...s, assignments: { ...s.assignments, [collectionId]: (s.assignments[collectionId] ?? []).filter((x) => x !== slug) } }));
  };

  const createCollection = (): void => {
    const label = newName.trim();
    if (!label) return setCreating(false);
    const id = `c_${Date.now().toString(36)}`;
    setStore((s) => ({ ...s, custom: [...s.custom, { id, label }] }));
    setSelected(id);
    setNewName('');
    setCreating(false);
  };

  const deleteCollection = (id: string): void => {
    setStore((s) => {
      const { [id]: _drop, ...assignments } = s.assignments;
      return { ...s, custom: s.custom.filter((c) => c.id !== id), assignments };
    });
    if (selected === id) setSelected('favorites');
  };

  const addTag = (slug: string): void => {
    const t = tagText.trim().toLowerCase();
    if (t) setStore((s) => ({ ...s, tags: { ...s.tags, [slug]: Array.from(new Set([...(s.tags[slug] ?? []), t])) } }));
    setTagText('');
    setTagFor(null);
  };
  const removeTag = (slug: string, tag: string): void =>
    setStore((s) => ({ ...s, tags: { ...s.tags, [slug]: (s.tags[slug] ?? []).filter((x) => x !== tag) } }));

  const countFor = (def: SmartDef): number => registry.filter(def.match).length;
  const customCount = (id: string): number => store.assignments[id]?.length ?? 0;

  return (
    <OpsPanel
      title="Collections"
      subtitle="Organize your apps — drag onto a collection to add"
      actions={
        <button type="button" disabled title="Cloud sync — prepared, arrives with account sync" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-faint opacity-60">
          <Icon name="refresh" size={13} /> Cloud sync
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_1fr]">
        {/* Collection sidebar */}
        <div className="surface-raised rounded-2xl p-2 shadow-card">
          <div className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Smart</div>
          {SMART.map((s) => (
            <CollectionRow
              key={s.id}
              icon={s.icon}
              label={s.label}
              count={countFor(s)}
              active={selected === s.id}
              dropping={dropTarget === s.id}
              onSelect={() => setSelected(s.id)}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(s.id); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); const slug = e.dataTransfer.getData('text/slug'); if (slug) assignTo(s.id, slug); setDropTarget(null); }}
            />
          ))}

          <div className="flex items-center justify-between px-2 pb-1 pt-3">
            <span className="text-2xs font-semibold uppercase tracking-wider text-faint">Collections</span>
            <button type="button" aria-label="New collection" onClick={() => setCreating(true)} className="text-faint hover:text-ink"><Icon name="plus" size={14} /></button>
          </div>
          {store.custom.map((c) => (
            <CollectionRow
              key={c.id}
              icon="folder"
              label={c.label}
              count={customCount(c.id)}
              active={selected === c.id}
              dropping={dropTarget === c.id}
              onSelect={() => setSelected(c.id)}
              onDelete={() => deleteCollection(c.id)}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(c.id); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); const slug = e.dataTransfer.getData('text/slug'); if (slug) assignTo(c.id, slug); setDropTarget(null); }}
            />
          ))}
          {creating && (
            <div className="px-1 pt-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createCollection(); if (e.key === 'Escape') setCreating(false); }}
                onBlur={createCollection}
                placeholder="Collection name…"
                className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-faint focus:shadow-focus"
              />
            </div>
          )}
        </div>

        {/* App grid */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-1.5">
              <Icon name="search" size={15} className="text-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${selectedLabel}…`} className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint" />
            </div>
            <button type="button" onClick={() => setSort(sort === 'name' ? 'recent' : 'name')} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink">
              <Icon name="filter" size={13} /> {sort === 'name' ? 'Name' : 'Recent'}
            </button>
          </div>

          {apps.length === 0 ? (
            <div className="surface-raised rounded-2xl shadow-card">
              <EmptyState
                icon={isSmart ? 'grid' : 'folder'}
                title={registry.length === 0 ? 'No apps installed' : `${selectedLabel} is empty`}
                description={registry.length === 0 ? 'Install apps from the AI Store, then organize them into collections.' : isSmart ? 'Apps matching this collection will appear automatically.' : 'Drag an app from another collection here, or install more from the Store.'}
                action={registry.length === 0 ? <Button variant="secondary" icon="store" onClick={() => setSection('store')}>Open AI Store</Button> : undefined}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {apps.map((a) => (
                <div
                  key={a.slug}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/slug', a.slug)}
                  className="surface-raised group flex items-start gap-3 rounded-2xl p-3 shadow-card transition hover:shadow-focus"
                >
                  <span className="cursor-grab pt-0.5 text-faint opacity-0 transition group-hover:opacity-100"><Icon name="grip" size={14} /></span>
                  <AppGlyph glyph={glyphFor(a.name)} tone={toneFor(a.slug)} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {(store.tags[a.slug] ?? []).map((t) => (
                        <button key={t} type="button" onClick={() => removeTag(a.slug, t)} className="inline-flex items-center gap-0.5 rounded-full bg-accent/12 px-1.5 py-0.5 text-2xs text-accent" title="Remove tag">
                          <Icon name="tag" size={9} />{t}
                        </button>
                      ))}
                      {tagFor === a.slug ? (
                        <input
                          autoFocus
                          value={tagText}
                          onChange={(e) => setTagText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') addTag(a.slug); if (e.key === 'Escape') setTagFor(null); }}
                          onBlur={() => addTag(a.slug)}
                          placeholder="tag"
                          className="w-16 rounded-full border border-[var(--hairline)] bg-transparent px-1.5 py-0.5 text-2xs text-ink outline-none"
                        />
                      ) : (
                        <button type="button" onClick={() => { setTagFor(a.slug); setTagText(''); }} className="inline-flex items-center gap-0.5 rounded-full [background:var(--fill-2)] px-1.5 py-0.5 text-2xs text-faint hover:text-ink">
                          <Icon name="plus" size={9} /> tag
                        </button>
                      )}
                    </div>
                  </div>
                  <button type="button" aria-label="Remove from collection" onClick={() => removeFrom(selected, a.slug)} className="text-faint opacity-0 transition hover:text-syspink group-hover:opacity-100"><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </OpsPanel>
  );
}

function CollectionRow({
  icon, label, count, active, dropping, onSelect, onDelete, onDragOver, onDragLeave, onDrop,
}: {
  icon: IconName;
  label: string;
  count: number;
  active: boolean;
  dropping: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}): JSX.Element {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition',
        active ? 'bg-accent/12 text-ink' : 'text-muted hover:[background:var(--fill-1)]',
        dropping && 'ring-1 ring-accent',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <Icon name={icon} size={15} className={active ? 'text-accent' : 'text-faint'} />
        <span className="truncate text-sm font-medium">{label}</span>
      </button>
      <span className="tabular-nums text-2xs text-faint">{count}</span>
      {onDelete && (
        <button type="button" aria-label="Delete collection" onClick={onDelete} className="text-faint opacity-0 transition hover:text-syspink group-hover:opacity-100"><Icon name="close" size={12} /></button>
      )}
    </div>
  );
}
