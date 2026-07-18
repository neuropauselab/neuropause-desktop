import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Kbd } from '@renderer/components/ui/controls';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import type { AppTone } from '@renderer/data/types';
import { CATALOG } from '@renderer/data/catalog';
import { useShell } from '@renderer/state/ShellProvider';
import { useTheme } from '@renderer/providers/ThemeProvider';
import { SECTIONS } from './sections';

type GroupKey = 'Navigation' | 'Apps' | 'Actions';

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

const GROUP_ORDER: GroupKey[] = ['Navigation', 'Apps', 'Actions'];

export function CommandPalette(): JSX.Element {
  const { commandOpen, setCommandOpen, setSection, openApp, toggleSidebar } = useShell();
  const { source, setSource } = useTheme();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = (): void => setCommandOpen(false);

  // Every command the palette can run.
  const commands = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = SECTIONS.map((s) => ({
      id: `nav:${s.id}`,
      group: 'Navigation',
      title: s.label,
      subtitle: 'Go to section',
      icon: s.icon,
      keywords: `go ${s.label}`,
      run: () => setSection(s.id),
    }));

    const apps: CommandItem[] = CATALOG.map((a) => ({
      id: `app:${a.id}`,
      group: 'Apps',
      title: a.name,
      subtitle: `Open in Workspace · ${a.category}`,
      glyph: { glyph: a.glyph, tone: a.tone },
      keywords: `${a.developer} ${a.category} open launch`,
      run: () => openApp(a.id, a.name),
    }));

    const nextAppearance = source === 'system' ? 'light' : source === 'light' ? 'dark' : 'system';
    const actions: CommandItem[] = [
      {
        id: 'act:appearance',
        group: 'Actions',
        title: `Switch appearance to ${nextAppearance}`,
        subtitle: 'Auto · Light · Dark',
        icon: nextAppearance === 'dark' ? 'moon' : nextAppearance === 'light' ? 'sun' : 'auto',
        keywords: 'theme dark light auto appearance',
        run: () => void setSource(nextAppearance),
      },
      {
        id: 'act:sidebar',
        group: 'Actions',
        title: 'Toggle sidebar',
        icon: 'sidebar',
        keywords: 'collapse expand sidebar',
        run: () => toggleSidebar(),
      },
    ];

    return [...nav, ...apps, ...actions];
  }, [setSection, openApp, toggleSidebar, source, setSource]);

  // Filter + group + rank.
  const groups = useMemo(() => {
    const out: { group: GroupKey; items: CommandItem[] }[] = [];
    for (const group of GROUP_ORDER) {
      const items = commands
        .filter((c) => c.group === group)
        .map((c) => ({ c, s: score(query, `${c.title} ${c.keywords ?? ''}`) }))
        .filter((x): x is { c: CommandItem; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c);
      if (items.length) out.push({ group, items });
    }
    return out;
  }, [commands, query]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Reset on open; keep selection in range as results change.
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

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

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
      if (item) {
        item.run();
        close();
      }
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
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            aria-hidden="true"
          />
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
                placeholder="Search apps, actions, and your work…"
                className="flex-1 bg-transparent text-md text-ink outline-none placeholder:text-faint"
                spellCheck={false}
                autoComplete="off"
              />
              <Kbd>esc</Kbd>
            </div>

            <div ref={listRef} className="max-h-[44vh] overflow-y-auto p-2">
              {flat.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-faint">
                  No matches for “{query}”.
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.group} className="mb-1.5 last:mb-0">
                    <div className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                      {g.group}
                    </div>
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
                          onClick={() => {
                            item.run();
                            close();
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                            active ? 'bg-accent/12' : 'hover:[background:var(--fill-1)]',
                          )}
                        >
                          {item.glyph ? (
                            <AppGlyph glyph={item.glyph.glyph} tone={item.glyph.tone} size={30} />
                          ) : (
                            <span
                              className={cn(
                                'flex h-[30px] w-[30px] items-center justify-center rounded-lg',
                                active ? 'text-accent' : 'text-muted',
                                '[background:var(--fill-1)]',
                              )}
                            >
                              {item.icon && <Icon name={item.icon} size={17} />}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-medium text-ink">
                              {item.title}
                            </span>
                            {item.subtitle && (
                              <span className="block truncate text-xs text-faint">
                                {item.subtitle}
                              </span>
                            )}
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
