import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from './Icon';

interface MenuCtx {
  close: () => void;
}
const MenuContext = createContext<MenuCtx>({ close: () => {} });

/**
 * A lightweight popover menu: a trigger plus a floating panel that closes on
 * outside-click, Escape, or item selection. Anchored below the trigger,
 * aligned to the chosen edge. Built without a popover dependency.
 */
export function Menu({
  trigger,
  children,
  align = 'end',
  width = 240,
  panelClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  panelClassName?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="app-no-drag relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 520, damping: 32 }}
            style={{ width }}
            className={cn(
              'glass-panel absolute z-50 mt-2 origin-top overflow-hidden rounded-xl p-1.5 shadow-pop',
              align === 'end' ? 'right-0' : 'left-0',
              panelClassName,
            )}
          >
            <MenuContext.Provider value={{ close: () => setOpen(false) }}>
              {children}
            </MenuContext.Provider>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  selected = false,
  tone = 'default',
  trailing,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  tone?: 'default' | 'danger';
  trailing?: ReactNode;
}): JSX.Element {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        close();
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-base outline-none transition fill-hover',
        tone === 'danger' ? 'text-syspink' : 'text-ink',
      )}
    >
      {icon && <Icon name={icon} size={16} className={tone === 'danger' ? '' : 'text-muted'} />}
      <span className="flex-1 truncate">{children}</span>
      {selected && <Icon name="check" size={15} className="text-accent" />}
      {trailing}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
      {children}
    </div>
  );
}

export function MenuSeparator(): JSX.Element {
  return <div className="my-1 h-px [background:var(--hairline)]" />;
}
