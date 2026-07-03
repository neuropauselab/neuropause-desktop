import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemeSource } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

interface ThemeContextValue {
  source: ThemeSource;
  isDark: boolean;
  setSource: (source: ThemeSource) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = (): boolean =>
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function resolveDark(source: ThemeSource): boolean {
  if (source === 'system') return prefersDark();
  return source === 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [source, setSourceState] = useState<ThemeSource>('system');

  // Load the persisted source from the main process once on mount.
  useEffect(() => {
    let active = true;
    void ipc.app.getThemeSource().then((s) => {
      if (active) setSourceState(s);
    });
    const unsubscribe = ipc.app.onThemeChanged(({ source: next }) => setSourceState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Apply the resolved appearance to <html> and react to OS changes.
  const [isDark, setIsDark] = useState<boolean>(() => resolveDark('system'));

  useEffect(() => {
    const apply = (): void => {
      const dark = resolveDark(source);
      setIsDark(dark);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();

    if (source === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    return undefined;
  }, [source]);

  const setSource = useCallback((next: ThemeSource) => {
    setSourceState(next); // optimistic; main echoes via onThemeChanged
    void ipc.app.setThemeSource(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ source, isDark, setSource }),
    [source, isDark, setSource],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
