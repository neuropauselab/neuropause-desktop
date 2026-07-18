import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { getAppOrFallback } from '@renderer/data/catalog';
import type { WorkspaceTab } from '@renderer/state/ShellProvider';

/** The IDE-style tab strip. Tabs animate in/out and shift smoothly via layout. */
export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}): JSX.Element {
  const onTabKeyDown = (e: ReactKeyboardEvent, index: number): void => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(tabs[index].id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        onSelect(tabs[(index + 1) % tabs.length].id);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onSelect(tabs[(index - 1 + tabs.length) % tabs.length].id);
        break;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        onClose(tabs[index].id);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="hairline-b flex h-10 shrink-0 items-center gap-1 px-2"
      role="tablist"
      aria-label="Open apps"
    >
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        <AnimatePresence initial={false}>
          {tabs.map((tab, index) => {
            const app = getAppOrFallback(tab.appId);
            const active = tab.id === activeTabId;
            return (
              <motion.div
                key={tab.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                role="tab"
                aria-selected={active}
                aria-label={tab.title}
                tabIndex={active ? 0 : -1}
                className={cn(
                  'group flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-lg pl-2 pr-1.5 outline-none transition-colors focus-visible:shadow-focus',
                  active ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:[background:var(--fill-1)]',
                )}
              >
                <AppGlyph glyph={app.glyph} tone={app.tone} size={16} radius={5} />
                <span className="max-w-[160px] truncate text-sm font-medium">{tab.title}</span>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-md text-faint transition hover:[background:var(--fill-2)] hover:text-ink',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <Icon name="close" size={13} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <button
        type="button"
        aria-label="Open an app"
        title="Open an app (⌘T)"
        onClick={onNew}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted outline-none transition hover:text-ink fill-hover focus-visible:shadow-focus active:scale-95"
      >
        <Icon name="plus" size={17} />
      </button>
    </div>
  );
}
