import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FavoriteItem, NpsOperationDto, PluginDto, RuntimeInstanceDto } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Kbd } from '@renderer/components/ui/controls';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import type { AppTone } from '@renderer/data/types';
import { CATALOG } from '@renderer/data/catalog';
import { ipc } from '@renderer/lib/ipc';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { useShell } from '@renderer/state/ShellProvider';
import { useTheme } from '@renderer/providers/ThemeProvider';
import { SECTIONS } from './sections';

type GroupKey = 'Recent' | 'Applications' | 'Plugins' | 'Sessions' | 'Downloads' | 'Go to' | 'Commands';

interface CommandItem {
  id: string;
  group: GroupKey;
  title: string;
  subtitle?: string;
  icon?: IconName;
  glyph?: { glyph: string; tone: AppTone };
  keywords?: string;
  run: () => void;
}

/** Subsequence/substring scorer; higher is better, null means no match. */
function score(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 1 : null;
}

const FILTER_ORDER: GroupKey[] = ['Applications', 'Plugins', 'Sessions', 'Downloads', 'Go to', 'Commands'];
const RUNNING: string[] = ['running', 'starting', 'suspended'];

/** Enterprise sub-tabs the palette can deep-link into (cross-module navigation). */
const ENTERPRISE_TABS: { id: string; title: string; icon: IconName; kw: string }[] = [
  { id: 'command', title: 'Command Center', icon: 'grid', kw: 'command home overview' },
  { id: 'executive', title: 'Executive Center', icon: 'sparkles', kw: 'executive kpis scorecard' },
  { id: 'decision', title: 'Decision Center', icon: 'shield', kw: 'decisions approvals governance' },
  { id: 'process', title: 'Process Explorer', icon: 'activity', kw: 'process mining cases' },
  { id: 'schedule', title: 'Production Schedule', icon: 'clock', kw: 'schedule aps gantt' },
  { id: 'execution', title: 'Operator Console', icon: 'activity', kw: 'mes execution shop floor' },
  { id: 'relationship', title: 'Relationship Intelligence', icon: 'connectors', kw: 'relationship graph entity' },
  { id: 'trust', title: 'Trust Center', icon: 'shield', kw: 'trust score reliability' },
  { id: 'personalize', title: 'Favorites & Saved Views', icon: 'star', kw: 'favorites recents saved views personalize workspace' },
  { id: 'search', title: 'Enterprise Search', icon: 'search', kw: 'search find records' },
  { id: 'modules', title: 'Enterprise Modules', icon: 'grid', kw: 'modules records erp crm sales' },
];

const initial2 = (s: string): string => s.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??';

export function CommandPalette(): JSX.Element {
  const { commandOpen, setCommandOpen, setSection, openApp, openOperations, openEnterprise, openConnectors, toggleSidebar } = useShell();
  const { source, setSource } = useTheme();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [live, setLive] = useState<{ plugins: PluginDto[]; instances: RuntimeInstanceDto[]; operations: NpsOperationDto[] }>({ plugins: [], instances: [], operations: [] });
  const [recents, setRecents] = useState<string[]>(() => prefs.read<string[]>(PrefKey.recentCommands, []));
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = (): void => setCommandOpen(false);
  const remember = (id: string): void =>
    setRecents((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 6);
      prefs.write(PrefKey.recentCommands, next);
      return next;
    });

  // Pull live plugins / sessions / downloads when the palette opens.
  useEffect(() => {
    if (!commandOpen) return;
    let active = true;
    void (async () => {
      const [plugins, instances, operations] = await Promise.all([
        ipc.plugins.list().catch(() => [] as PluginDto[]),
        ipc.runtime.list().catch(() => [] as RuntimeInstanceDto[]),
        ipc.nps.operations().catch(() => [] as NpsOperationDto[]),
      ]);
      if (active) setLive({ plugins, instances, operations });
      const pers = await ipc.enterprise.personalization.get().catch(() => null);
      if (active && pers) setFavorites(pers.favorites);
    })();
    return () => {
      active = false;
    };
  }, [commandOpen]);

  // Every command the palette can run, across all domains.
  const all = useMemo<CommandItem[]>(() => {
    const apps: CommandItem[] = CATALOG.map((a) => ({
      id: `app:${a.id}`,
      group: 'Applications',
      title: a.name,
      subtitle: `Open in Workspace · ${a.category}`,
      glyph: { glyph: a.glyph, tone: a.tone },
      keywords: `${a.developer} ${a.category} open launch app`,
      run: () => openApp(a.id, a.name),
    }));

    const plugins: CommandItem[] = live.plugins.map((p) => ({
      id: `plugin:${p.id}`,
      group: 'Plugins',
      title: p.name,
      subtitle: `${p.state} · plugin`,
      icon: 'puzzle',
      keywords: `plugin ${p.kind} ${p.author ?? ''} manage`,
      run: () => openOperations('plugins'),
    }));

    const sessions: CommandItem[] = live.instances
      .filter((i) => RUNNING.includes(i.status))
      .map((i) => ({
        id: `session:${i.instanceId}`,
        group: 'Sessions',
        title: i.appName,
        subtitle: `${i.status} · runtime session`,
        glyph: { glyph: initial2(i.appName), tone: 'blue' },
        keywords: `session running runtime ${i.appSlug}`,
        run: () => openApp(i.appSlug, i.appName),
      }));

    const downloads: CommandItem[] = live.operations.map((o) => ({
      id: `dl:${o.id}`,
      group: 'Downloads',
      title: o.appSlug,
      subtitle: `${o.status} · ${Math.round(o.progress * 100)}%`,
      icon: 'download',
      keywords: `download ${o.kind} transfer ${o.appSlug}`,
      run: () => openOperations('downloads'),
    }));

    // Only offer navigation to VISIBLE sections — a retired/hidden section must never appear as a
    // "Go to" command (a dead-end into a surface the sidebar deliberately hides).
    const sections: CommandItem[] = SECTIONS.filter((sct) => !sct.hidden).map((sct) => ({
      id: `nav:${sct.id}`,
      group: 'Go to',
      title: sct.label,
      subtitle: 'Go to section',
      icon: sct.icon,
      keywords: `go open ${sct.label}`,
      run: () => setSection(sct.id),
    }));

    const opsTabs: { tab: string; title: string; icon: IconName; kw: string }[] = [
      { tab: 'installed', title: 'Installed Apps', icon: 'package', kw: 'registry apps installed' },
      { tab: 'sessions', title: 'Runtime Sessions', icon: 'pulse', kw: 'runtime monitor processes' },
      { tab: 'plugins', title: 'Plugin Manager', icon: 'puzzle', kw: 'plugins extensions' },
      { tab: 'downloads', title: 'Download Center', icon: 'download', kw: 'downloads transfers queue' },
      { tab: 'updates', title: 'Update Center', icon: 'refresh', kw: 'updates upgrade channels' },
      { tab: 'permissions', title: 'Permission Center', icon: 'shield', kw: 'permissions capabilities security' },
      { tab: 'logs', title: 'Activity Log', icon: 'list', kw: 'logs activity events audit' },
      { tab: 'health', title: 'Health', icon: 'activity', kw: 'health diagnostics status' },
      { tab: 'collections', title: 'Collections', icon: 'grid', kw: 'collections favorites pinned tags' },
      { tab: 'diagnostics', title: 'Diagnostics Center', icon: 'beaker', kw: 'diagnostics health status metrics recovery export' },
    ];
    if (import.meta.env.DEV) {
      opsTabs.push({ tab: 'inspector', title: 'Event Inspector', icon: 'code', kw: 'developer events stream debug inspect bus' });
    }
    const ops: CommandItem[] = opsTabs.map((o) => ({
      id: `ops:${o.tab}`,
      group: 'Go to',
      title: o.title,
      subtitle: 'Operations',
      icon: o.icon,
      keywords: `operations ${o.kw}`,
      run: () => openOperations(o.tab),
    }));

    const nextAppearance = source === 'system' ? 'light' : source === 'light' ? 'dark' : 'system';
    const commands: CommandItem[] = [
      {
        id: 'act:appearance',
        group: 'Commands',
        title: `Switch appearance to ${nextAppearance}`,
        subtitle: 'Auto · Light · Dark',
        icon: nextAppearance === 'dark' ? 'moon' : nextAppearance === 'light' ? 'sun' : 'auto',
        keywords: 'theme dark light auto appearance settings',
        run: () => void setSource(nextAppearance),
      },
      {
        id: 'act:sidebar',
        group: 'Commands',
        title: 'Toggle sidebar',
        icon: 'sidebar',
        keywords: 'collapse expand sidebar',
        run: () => toggleSidebar(),
      },
      {
        id: 'act:settings',
        group: 'Commands',
        title: 'Open Settings',
        icon: 'settings',
        keywords: 'settings preferences configure',
        run: () => setSection('settings'),
      },
    ];

    const connectorsTabs: { tab: string; title: string; icon: IconName; kw: string }[] = [
      { tab: 'overview', title: 'Connector Center', icon: 'gauge', kw: 'connectors overview health integrations status' },
      { tab: 'connections', title: 'Manage Connections', icon: 'connectors', kw: 'connectors connect accounts inspect services oauth' },
      { tab: 'marketplace', title: 'Connector Marketplace', icon: 'store', kw: 'connectors marketplace install browse discover' },
    ];
    const conns: CommandItem[] = connectorsTabs.map((c) => ({
      id: `conn:${c.tab}`,
      group: 'Go to',
      title: c.title,
      subtitle: 'Connector Center',
      icon: c.icon,
      keywords: `connector center ${c.kw}`,
      run: () => openConnectors(c.tab),
    }));

    const entNav: CommandItem[] = ENTERPRISE_TABS.map((t) => ({
      id: `ent:${t.id}`,
      group: 'Go to',
      title: t.title,
      subtitle: 'Enterprise',
      icon: t.icon,
      keywords: `enterprise ${t.kw}`,
      run: () => openEnterprise(t.id),
    }));

    const entFavorites: CommandItem[] = favorites.map((f) => ({
      id: `fav:${f.id}`,
      group: 'Go to',
      title: f.label,
      subtitle: 'Favorite · Enterprise',
      icon: 'star-fill',
      keywords: `favorite pinned enterprise ${f.label} ${f.kind}`,
      run: () => openEnterprise(f.tab),
    }));

    return [...apps, ...plugins, ...sessions, ...downloads, ...sections, ...ops, ...conns, ...entNav, ...entFavorites, ...commands];
  }, [live, favorites, source, setSource, openApp, openOperations, openEnterprise, openConnectors, setSection, toggleSidebar]);

  // Empty query → Recent + navigation. Typing → fuzzy search across every domain.
  const groups = useMemo(() => {
    if (!query) {
      const out: { group: GroupKey; items: CommandItem[] }[] = [];
      const recentItems = recents.map((id) => all.find((c) => c.id === id)).filter((c): c is CommandItem => Boolean(c));
      if (recentItems.length) out.push({ group: 'Recent', items: recentItems });
      out.push({ group: 'Go to', items: all.filter((c) => c.group === 'Go to') });
      out.push({ group: 'Commands', items: all.filter((c) => c.group === 'Commands') });
      return out;
    }
    const out: { group: GroupKey; items: CommandItem[] }[] = [];
    for (const group of FILTER_ORDER) {
      const items = all
        .filter((c) => c.group === group)
        .map((c) => ({ c, s: score(query, `${c.title} ${c.keywords ?? ''}`) }))
        .filter((x): x is { c: CommandItem; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c);
      if (items.length) out.push({ group, items });
    }
    return out;
  }, [all, query, recents]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (commandOpen) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [commandOpen]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const exec = (item: CommandItem): void => {
    remember(item.id);
    item.run();
    close();
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) exec(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {commandOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={close}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
            className="glass-panel relative w-full max-w-[600px] overflow-hidden rounded-2xl shadow-glass"
          >
            <div className="flex items-center gap-2.5 px-4 py-3 hairline-b">
              <Icon name="search" size={18} className="text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps, plugins, sessions, commands…"
                className="flex-1 bg-transparent text-md text-ink outline-none placeholder:text-faint"
                spellCheck={false}
                autoComplete="off"
              />
              <Kbd>esc</Kbd>
            </div>

            <div ref={listRef} className="max-h-[44vh] overflow-y-auto p-2">
              {flat.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-faint">No matches for “{query}”.</div>
              ) : (
                groups.map((g) => (
                  <div key={g.group} className="mb-1.5 last:mb-0">
                    <div className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">{g.group}</div>
                    {g.items.map((item) => {
                      runningIndex += 1;
                      const index = runningIndex;
                      const active = index === activeIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-cmd-index={index}
                          onMouseMove={() => setActiveIndex(index)}
                          onClick={() => exec(item)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                            active ? 'bg-accent/12' : 'hover:[background:var(--fill-1)]',
                          )}
                        >
                          {item.glyph ? (
                            <AppGlyph glyph={item.glyph.glyph} tone={item.glyph.tone} size={30} />
                          ) : (
                            <span className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-lg', active ? 'text-accent' : 'text-muted', '[background:var(--fill-1)]')}>
                              {item.icon && <Icon name={item.icon} size={17} />}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-medium text-ink">{item.title}</span>
                            {item.subtitle && <span className="block truncate text-xs text-faint">{item.subtitle}</span>}
                          </span>
                          {active && <Icon name="arrow-right" size={16} className="text-accent" />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between px-3 py-2 hairline-t text-2xs text-faint">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>navigate</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd>
                <span>open</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
