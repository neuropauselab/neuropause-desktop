import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { prefs, PrefKey } from '@renderer/lib/preferences';

const MIN = 90;
const MAX = 150;
const STEP = 10;
const clamp = (n: number): number => Math.min(MAX, Math.max(MIN, Math.round(n)));

interface ScaleContextValue {
  scale: number;
  setScale: (value: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  min: number;
  max: number;
}

const ScaleContext = createContext<ScaleContextValue | null>(null);

/**
 * Adjustable UI scaling (90%–150%) for accessibility. Applies a root zoom and
 * persists the choice. Driven both by the Settings control and the View menu's
 * zoom commands, so the keyboard, menu, and settings all agree.
 */
export function ScaleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [scale, setScaleState] = useState<number>(() => clamp(prefs.read(PrefKey.uiScale, 100)));

  useEffect(() => {
    document.documentElement.style.setProperty('zoom', String(scale / 100));
    prefs.write(PrefKey.uiScale, scale);
  }, [scale]);

  const setScale = useCallback((value: number) => setScaleState(clamp(value)), []);
  const zoomIn = useCallback(() => setScaleState((s) => clamp(s + STEP)), []);
  const zoomOut = useCallback(() => setScaleState((s) => clamp(s - STEP)), []);
  const reset = useCallback(() => setScaleState(100), []);

  const value = useMemo<ScaleContextValue>(
    () => ({ scale, setScale, zoomIn, zoomOut, reset, min: MIN, max: MAX }),
    [scale, setScale, zoomIn, zoomOut, reset],
  );

  return <ScaleContext.Provider value={value}>{children}</ScaleContext.Provider>;
}

export function useScale(): ScaleContextValue {
  const ctx = useContext(ScaleContext);
  if (!ctx) throw new Error('useScale must be used within ScaleProvider');
  return ctx;
}
