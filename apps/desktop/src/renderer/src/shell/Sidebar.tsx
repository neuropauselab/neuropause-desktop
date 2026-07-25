import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import {
  useShell,
  SIDEBAR_COLLAPSED,
} from '@renderer/state/ShellProvider';
import { SECTIONS, type SectionDef } from './sections';

function SidebarItem({
  section,
  collapsed,
}: {
  section: SectionDef;
  collapsed: boolean;
}): JSX.Element {
  const { activeSection, setSection } = useShell();
  const active = activeSection === section.id;

  return (
    <button
      type="button"
      onClick={() => setSection(section.id)}
      title={collapsed ? section.label : undefined}
      aria-label={section.preview ? `${section.label} — Preview` : section.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 w-full items-center rounded-xl outline-none transition-colors focus-visible:shadow-focus',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        active ? 'text-accent' : 'text-muted hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={{ type: 'spring', stiffness: 560, damping: 38 }}
          className="absolute inset-0 rounded-xl bg-accent/12"
        />
      )}
      {!active && <span className="absolute inset-0 rounded-xl fill-hover" />}
      <Icon name={section.icon} size={19} className={cn('relative z-10', active ? 'text-accent' : '')} />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.12 }}
            className="relative z-10 whitespace-nowrap text-base font-medium"
          >
            {section.label}
          </motion.span>
        )}
      </AnimatePresence>
      {!collapsed && section.preview && (
        <span
          aria-hidden="true"
          className="relative z-10 ml-auto rounded-full border border-[var(--hairline)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint"
        >
          Preview
        </span>
      )}
    </button>
  );
}

export function Sidebar(): JSX.Element {
  const { sidebarCollapsed, sidebarWidth, setSidebarWidth } = useShell();
  const [resizing, setResizing] = useState(false);
  const primary = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
  const footer = SECTIONS.filter((s) => s.placement === 'footer' && !s.hidden);

  const startResize = (e: ReactPointerEvent): void => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: PointerEvent): void => setSidebarWidth(startW + (ev.clientX - startX));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      setResizing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED : sidebarWidth }}
      transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}
      className="sidebar-material hairline-r relative flex shrink-0 flex-col overflow-hidden"
      aria-label="Primary navigation"
    >
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-3" role="navigation">
        {primary.map((s) => (
          <SidebarItem key={s.id} section={s} collapsed={sidebarCollapsed} />
        ))}
      </nav>
      <div className="px-3 pb-3">
        {footer.map((s) => (
          <SidebarItem key={s.id} section={s} collapsed={sidebarCollapsed} />
        ))}
      </div>

      {/* Resize handle (expanded only). */}
      {!sidebarCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startResize}
          className="group absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize"
        >
          <span
            className={cn(
              'absolute inset-y-0 right-0 w-px transition-colors',
              resizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/40',
            )}
          />
        </div>
      )}
    </motion.aside>
  );
}
