import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { useShell } from '@renderer/state/ShellProvider';
import { SECTIONS, type SectionDef } from './sections';

const EXPANDED = 232;
const COLLAPSED = 68;

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
      <Icon
        name={section.icon}
        size={19}
        className={cn('relative z-10', active ? 'text-accent' : '')}
      />
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
    </button>
  );
}

export function Sidebar(): JSX.Element {
  const { sidebarCollapsed } = useShell();
  const primary = SECTIONS.filter((s) => s.placement === 'primary');
  const footer = SECTIONS.filter((s) => s.placement === 'footer');

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarCollapsed ? COLLAPSED : EXPANDED }}
      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      className="sidebar-material hairline-r flex shrink-0 flex-col overflow-hidden"
    >
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-3">
        {primary.map((s) => (
          <SidebarItem key={s.id} section={s} collapsed={sidebarCollapsed} />
        ))}
      </nav>
      <div className="px-3 pb-3">
        {footer.map((s) => (
          <SidebarItem key={s.id} section={s} collapsed={sidebarCollapsed} />
        ))}
      </div>
    </motion.aside>
  );
}
