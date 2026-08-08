import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import {
  useShell,
  SIDEBAR_COLLAPSED,
} from '@renderer/state/ShellProvider';
import {
  SECTIONS,
  SECTION_GROUPS,
  SECTION_GROUP_LABELS,
  type SectionDef,
  type SectionGroup,
} from './sections';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

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
      title={collapsed ? section.label : section.description}
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

function AdvancedNav({
  sections,
  open,
  onToggle,
  collapsed,
}: {
  sections: SectionDef[];
  open: boolean;
  onToggle: () => void;
  collapsed: boolean;
}): JSX.Element {
  return (
    <div role="group" aria-label="Advanced" className="mt-2 flex flex-col gap-0.5">
      {collapsed && <div aria-hidden="true" className="mx-2 my-1.5 h-px bg-[var(--hairline)]" />}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="sidebar-advanced-list"
        title={collapsed ? 'Advanced' : undefined}
        className={cn(
          'group relative flex h-9 w-full items-center rounded-xl text-muted outline-none transition-colors hover:text-ink focus-visible:shadow-focus',
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        )}
      >
        <span className="absolute inset-0 rounded-xl fill-hover" />
        <Icon name="layers" size={19} className="relative z-10" />
        {!collapsed && (
          <>
            <span className="relative z-10 whitespace-nowrap text-base font-medium">Advanced</span>
            <Icon
              name="arrow-right"
              size={14}
              className={cn('relative z-10 ml-auto transition-transform', open ? 'rotate-90' : '')}
            />
          </>
        )}
      </button>
      {open && (
        <div id="sidebar-advanced-list" className="flex flex-col gap-0.5">
          {sections.map((s) => (
            <SidebarItem key={s.id} section={s} collapsed={collapsed} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar(): JSX.Element {
  const { sidebarCollapsed, sidebarWidth, setSidebarWidth } = useShell();
  const [resizing, setResizing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const primary = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
  const footer = SECTIONS.filter((s) => s.placement === 'footer' && !s.hidden);
  // Phase 2 (progressive disclosure): the default sidebar shows the focused set;
  // `tier: 'advanced'` surfaces collapse behind the "Advanced" disclosure below. Pure
  // presentation — the command palette + universal search still expose EVERY section,
  // and the SECTIONS array order (and every nav lock over it) is untouched.
  const mainPrimary = primary.filter((s) => s.tier !== 'advanced');
  const advanced = primary.filter((s) => s.tier === 'advanced');
  // Phase 7 — grouped navigation: bucket the visible primaries into the stable
  // groups, preserving SECTIONS order within each.
  const grouped: { group: SectionGroup; sections: SectionDef[] }[] = SECTION_GROUPS.map((group) => ({
    group,
    sections: mainPrimary.filter((s) => (s.group ?? 'workspace') === group),
  })).filter((g) => g.sections.length > 0);

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
      <div className="px-3 pt-3">
        <WorkspaceSwitcher collapsed={sidebarCollapsed} />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pt-2" role="navigation">
        {grouped.map(({ group, sections }, index) => (
          <div key={group} role="group" aria-label={SECTION_GROUP_LABELS[group]} className="flex flex-col gap-0.5">
            {sidebarCollapsed ? (
              index > 0 && <div aria-hidden="true" className="mx-2 my-1.5 h-px bg-[var(--hairline)]" />
            ) : (
              <div
                className={cn(
                  'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint',
                  index === 0 ? 'pt-1' : 'pt-4',
                )}
              >
                {SECTION_GROUP_LABELS[group]}
              </div>
            )}
            {sections.map((s) => (
              <SidebarItem key={s.id} section={s} collapsed={sidebarCollapsed} />
            ))}
          </div>
        ))}
        {advanced.length > 0 && (
          <AdvancedNav
            sections={advanced}
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((v) => !v)}
            collapsed={sidebarCollapsed}
          />
        )}
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
